import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { apply } from '../index.js'
import { jsonRequest, makeExec, makeHost, makeProfileDir, makeSession, removeDir, silenceConsole } from './helpers.js'

silenceConsole()

describe('profile directory', () => {
  let hostProfile
  let envProfile
  const savedEnv = { dir: process.env.DSH_PROFILE_DIR, home: process.env.HOME }

  beforeEach(() => {
    hostProfile = makeProfileDir()
    envProfile = makeProfileDir()
  })
  afterEach(() => {
    removeDir(hostProfile)
    removeDir(envProfile)
    for (const [key, value] of [['DSH_PROFILE_DIR', savedEnv.dir], ['HOME', savedEnv.home]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    mock.restoreAll()
    silenceConsole()
  })

  async function saveModel(host) {
    apply(host.ctx)
    const route = host.routes.get('/api/decision-review/save')
    await route.fetch(jsonRequest('http://127.0.0.1/api/decision-review/save', { settings: { model: 'written-by-test' } }))
  }

  it('follows the host profile context rather than the desktop default', async () => {
    process.env.HOME = envProfile
    delete process.env.DSH_PROFILE_DIR
    await saveModel(makeHost({ profileContext: { name: 'custom', dir: hostProfile } }))
    assert.ok(fs.existsSync(path.join(hostProfile, 'decision-review.settings.json')))
    assert.equal(fs.existsSync(path.join(envProfile, '.dsh/profiles/desktop/decision-review.settings.json')), false)
  })

  it('uses DSH_PROFILE_DIR when the host offers no profile context', async () => {
    process.env.DSH_PROFILE_DIR = envProfile
    await saveModel(makeHost())
    assert.ok(fs.existsSync(path.join(envProfile, 'decision-review.settings.json')))
  })

  it('falls back to the legacy desktop profile under HOME', async () => {
    delete process.env.DSH_PROFILE_DIR
    process.env.HOME = envProfile
    const desktop = path.join(envProfile, '.dsh/profiles/desktop')
    fs.mkdirSync(desktop, { recursive: true })
    await saveModel(makeHost())
    assert.ok(fs.existsSync(path.join(desktop, 'decision-review.settings.json')))
  })
})

describe('Auto preset lifecycle', () => {
  let profileDir
  let host

  beforeEach(() => { profileDir = makeProfileDir() })
  afterEach(async () => {
    await host?.dispose()
    host = undefined
    removeDir(profileDir)
    mock.restoreAll()
    silenceConsole()
  })

  function mount(options = {}, beforeApply = () => {}) {
    host = makeHost({ profileContext: { name: 'test', dir: profileDir }, ...options })
    beforeApply(host.ctx)
    apply(host.ctx)
  }

  function sessionLog(id, header = { isSeeded: false }, events = []) {
    return {
      id, header, events,
      get seq() { return events.length },
      append(type, data) { events.push({ seq: this.seq, time: 0, type, data }) },
    }
  }

  const workspacePin = () => [
    { seq: 0, time: 0, type: 'permission/preset', data: { preset: 'workspace-write' } },
    { seq: 1, time: 0, type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { seq: 2, time: 0, type: 'approval/policy', data: { policy: 'ask' } },
  ]

  // rc.1 publishes a read-only Session, runs setup, then serially announces
  // the writable Agent. The permission service's prepended listener fills
  // absent permission facts; Auto and an explicit setup choice are retained.
  function mountCreation() {
    mount({
      setPreset(session, preset) {
        session.append('permission/preset', { preset })
        session.append('sandbox/mode', { mode: 'danger-full-access' })
      },
    }, (ctx) => {
      ctx.on('agent/created', ({ agent: { session } }) => {
        for (const { type, data } of workspacePin()) {
          if (!session.events.some((event) => event.type === type)) session.append(type, data)
        }
      }, { prepend: true })
    })
  }

  async function created(session, { source = 'startup', setup, signal } = {}) {
    const before = structuredClone(session.events)
    await host.emit('session/created', session)
    assert.deepEqual(session.events, before)
    setup?.(session)
    await host.emit('agent/created', { agent: { id: session.id, session }, source, signal })
  }

  it('selects Auto before the host default on a fresh main session without the query service', async () => {
    mountCreation()
    const session = sessionLog('fresh-main')
    await created(session)
    assert.deepEqual(host.presetCalls, [{ session, preset: 'auto' }])
    assert.deepEqual(session.events.map(({ type, data }) => [type, data]), [
      ['permission/preset', { preset: 'auto' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'ask' }],
    ])
  })

  it('preserves an explicit setup choice even if it matches the host default pin', async () => {
    mountCreation()
    const session = sessionLog('chosen-main')
    await created(session, {
      setup: (live) => { for (const { type, data } of workspacePin()) live.append(type, data) },
    })
    assert.deepEqual(session.events, workspacePin())
    assert.deepEqual(host.presetCalls, [])
  })

  it('keeps an empty restored session and a seeded startup at the host fallback', async () => {
    mountCreation()
    for (const source of ['resume', 'startup']) {
      const seed = { seq: 0, time: 0, type: 'session/end-seed', data: {} }
      const session = sessionLog(source, undefined, [seed])
      await created(session, { source })
      assert.deepEqual(session.events.map((event) => [event.type, event.data]), [
        [seed.type, seed.data], ...workspacePin().map((event) => [event.type, event.data]),
      ])
    }
    assert.deepEqual(host.presetCalls, [])
  })

  it('does not change permission for a child, a resumed Agent or an aborted creation', async () => {
    mountCreation()
    const abort = new AbortController()
    abort.abort()
    const cases = [
      [sessionLog('child', { origin: 'subagent', parentSession: 'p', isSeeded: false }), {}],
      [sessionLog('historical-fork', { parentSession: 'p', isSeeded: false }), {}],
      [sessionLog('inherited', { isSeeded: true }), {}],
      [sessionLog('resumed'), { source: 'resume' }],
      [sessionLog('aborted'), { signal: abort.signal }],
    ]
    for (const [session, options] of cases) await created(session, options)
    assert.deepEqual(host.presetCalls, [])
  })

  it('contributes localized descriptions for Auto and its confirmation', () => {
    mount()
    const { description, confirmationDescription } = host.autoPresentation
    for (const locale of ['en', 'zh']) {
      assert.ok(description[locale].length > 0)
      assert.match(confirmationDescription[locale], /Decisions/)
    }
    assert.match(confirmationDescription.en, /endpoint.*model/i)
    assert.match(confirmationDescription.en, /session.*(?:route|model)/i)
    assert.match(confirmationDescription.zh, /地址.*模型|端点.*模型/)
    assert.match(confirmationDescription.zh, /会话.*(?:路由|模型)/)
  })

  it('migrates only live Auto sessions before unregistering the integration on hot removal', async () => {
    const auto = sessionLog('auto')
    const childAuto = sessionLog('child-auto', { origin: 'subagent', parentSession: auto.id })
    const other = sessionLog('other')
    mount({
      sessions: [auto, other, childAuto],
      currentPreset: (session) => session === other ? 'workspace-write' : 'auto',
      setPreset: () => assert.equal(host.autoRegistered, true),
    })
    await host.dispose()
    assert.deepEqual(host.presetCalls, [auto, childAuto].map((session) => ({ session, preset: 'danger-full-access' })))
    assert.equal(host.autoRegistered, false)
    assert.equal(host.listeners.has('tools/pre-execute'), false)
    assert.equal(host.listeners.has('agent/created'), false)
    assert.equal(host.routes.size, 0)
  })

  it('preserves live Auto pins while the root is unloading', async () => {
    const auto = sessionLog('auto')
    mount({ sessions: [auto] })
    host.ctx.root.fiber.state = 5 // Cordis FiberState.UNLOADING
    await host.dispose()
    assert.deepEqual(host.presetCalls, [])
    assert.equal(host.autoRegistered, false)
  })

  it('cancels and drains a pending review before disposal returns', { timeout: 2000 }, async () => {
    mount()
    const started = Promise.withResolvers()
    mock.method(globalThis, 'fetch', (_url, { signal }) => {
      started.resolve(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    let downstream = false
    const review = host.listeners.get('tools/pre-execute')(makeExec(makeSession()), async () => {
      downstream = true
      return { kind: 'allow' }
    })
    const signal = await started.promise
    await host.dispose()
    assert.equal(signal.aborted, true)
    assert.deepEqual(await review, { kind: 'cancel' })
    assert.equal(downstream, false)
  })
})
