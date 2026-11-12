import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'
import {
  jsonRequest,
  makeAnswers,
  makeExec,
  makeHost,
  makeProfileDir,
  makeSession,
  removeDir,
  streamOf,
} from '../test/fixtures.js'

const PACKAGE = '@local/decision-review'
const API = 'http://decision-review.example.test/api/decision-review'
const ENDPOINT = 'https://provider.example.test/v1/decisions'
const KEY = 'node-probe-fixture-key'

assert.equal(process.release.name, 'node')
assert.equal(process.versions.bun, undefined)
assert.equal(process.permission.has('child'), false)
const entry = import.meta.resolve(PACKAGE)
assert.equal(entry, new URL('../node_modules/@local/decision-review/index.js', import.meta.url).href)

globalThis.fetch = async () => {
  throw new Error('Unexpected fetch during package load')
}
const server = await import(PACKAGE)
assert.equal(server.name, 'decision-review')
assert.ok(server.inject.includes('permissionPresets'))
await verifyClient()
await verifyServer()
console.info(`Node ${process.version}: installed exports, resources, client loader, and both review engines passed`)

async function verifyClient() {
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(await readExport(`/locale/${language}.json`))
    assert.ok(locale.meta.title && locale.meta.description)
  }
  assert.match(await readExport('/icon'), /<svg\b/)
  assert.match(await readFile(new URL('cordis.patch.yml', entry), 'utf8'), /name: '@local\/decision-review'/)

  let registration
  new Script(await readExport('/client')).runInNewContext({
    window: {
      __ModuleLoader__: {
        load(value) {
          assert.equal(registration, undefined)
          registration = value
        },
      },
    },
  })
  assert.equal(registration.id, PACKAGE)
  const requires = new Set()
  const client = registration.factory((name) => {
    assert.ok(['react', 'react/jsx-runtime'].includes(name), `Unexpected client dependency: ${name}`)
    requires.add(name)
    return {}
  })
  assert.ok(requires.has('react'))
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale'])
  const slots = []
  let localeRegistered = false
  const dispose = client.apply({
    locale: {
      register(namespace, messages) {
        assert.equal(namespace, 'decision-review')
        for (const language of ['en', 'zh']) assert.ok(messages[language]['panel.title'])
        localeRegistered = true
        return () => {
          localeRegistered = false
        }
      },
    },
    slots: {
      inject(_slot, setup) {
        return setup()
      },
      register({ name }, render) {
        assert.equal(typeof render, 'function')
        slots.push(name)
      },
    },
  })
  assert.equal(localeRegistered, true)
  assert.deepEqual(slots, ['plugins.row.config', 'conversation.composer.dock'])
  dispose()
  assert.equal(localeRegistered, false)
}

function readExport(subpath) {
  return readFile(new URL(import.meta.resolve(PACKAGE + subpath)), 'utf8')
}

async function verifyServer() {
  const profile = makeProfileDir()
  const settingsFile = join(profile, 'decision-review.settings.json')
  const trailFile = join(profile, 'decision-review.log.jsonl')
  const session = makeSession('node-probe')
  const pinned = makeSession('workspace-write')
  const fresh = { id: 'fresh', header: { origin: 'main' }, seq: 0 }
  const allow = async () => ({ kind: 'allow' })
  const calls = []
  let reply = async () => Response.json({ answers: makeAnswers() })
  globalThis.fetch = async (url, request) => {
    assert.equal(url, ENDPOINT)
    assert.equal(request.method, 'POST')
    assert.equal(new Headers(request.headers).get('authorization'), `Bearer ${KEY}`)
    assert.ok(request.signal instanceof AbortSignal)
    calls.push(JSON.parse(request.body))
    return reply(request.signal)
  }
  const streams = []
  const options = {
    profileContext: { name: 'node-probe', dir: profile },
    currentPreset: (current) => (current === session ? 'auto' : 'workspace-write'),
    sessions: [session, pinned, fresh],
    stream(request) {
      streams.push(request)
      return streamOf([
        { type: 'text-delta', index: 0, text: '{"risk":"medium","decision":"deny"}' },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    },
  }
  let host = makeHost(options)
  const preExecute = () => host.listeners.get('tools/pre-execute')
  const review = (current = session, next = allow) => preExecute()(makeExec(current), next)
  const api = async (route, body) => {
    const url = new URL(`${API}/${route}`)
    const request = body === undefined ? new Request(url) : jsonRequest(url, body)
    const response = await host.routes.get(url.pathname).fetch(request)
    const payload = await response.text()
    assert.equal(response.status, 200, `${request.method} ${route}: ${payload}`)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(!payload.includes(KEY))
    return JSON.parse(payload)
  }

  try {
    server.apply(host.ctx)
    assert.equal(host.autoRegistered, true)
    await host.emit('agent/created', { agent: { session: fresh }, source: 'startup' })
    assert.deepEqual(host.presetCalls, [{ session: fresh, preset: 'auto' }])

    const { settings } = await api('save', {
      settings: { endpoint: ENDPOINT, model: 'decisions-fixture', apiKey: KEY },
    })
    assert.equal(settings.hasApiKey, true)
    assert.equal(JSON.parse(await readFile(settingsFile, 'utf8')).apiKey, KEY)
    assert.equal((await stat(settingsFile)).mode & 0o777, 0o600)
    assert.deepEqual(await review(pinned), { kind: 'allow' })
    assert.equal(calls.length, 0)
    assert.deepEqual(await review(), { kind: 'allow' })
    const smoke = await api('test', { scenarios: ['allow'] })
    assert.equal(smoke.results[0].composed.decision, 'allow')
    assert.deepEqual(
      calls.map(({ model }) => model),
      ['decisions-fixture', 'decisions-fixture'],
    )

    await api('save', { settings: { engine: 'session' } })
    const asked = await review()
    assert.equal(asked.kind, 'ask')
    assert.match(asked.displayReason.en, /denied this call as medium risk/)
    assert.equal(streams.length, 1)
    assert.equal(streams[0].provider, 'fixture')
    assert.equal(streams[0].model, 'fixture')
    assert.equal(streams[0].purpose, 'auto-review')
    assert.equal(calls.length, 2)

    await host.dispose()
    assert.deepEqual(
      host.presetCalls.slice(1),
      [session, fresh].map((live) => ({ session: live, preset: 'danger-full-access' })),
    )
    assert.equal(host.autoRegistered, false)
    assert.equal(host.routes.size, 0)
    assert.equal(host.listeners.has('tools/pre-execute'), false)
    host = makeHost(options)
    server.apply(host.ctx)
    const config = await api('config')
    assert.equal(config.settings.engine, 'session')
    assert.equal(config.settings.hasApiKey, true)
    const stats = await api(`stats?session=session-${session.id}`)
    assert.equal(stats.reviewed, 2)
    assert.equal(stats.passRate, 50)
    const records = (await readFile(trailFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      records.map(({ engine, route }) => [engine, route]),
      [
        ['decisions', 'allow'],
        ['session', 'ask'],
      ],
    )
    assert.equal((await stat(trailFile)).mode & 0o777, 0o600)

    await api('save', { settings: { engine: 'decisions' } })
    const started = Promise.withResolvers()
    reply = (signal) => {
      signal.throwIfAborted()
      started.resolve(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    let downstream = false
    const pending = review(session, async () => {
      downstream = true
      return allow()
    })
    const signal = await started.promise
    await host.dispose()
    assert.equal(signal.aborted, true)
    assert.deepEqual(await pending, { kind: 'cancel' })
    assert.equal(downstream, false)
  } finally {
    await host.dispose()
    removeDir(profile)
  }
}
