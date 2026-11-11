import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { apply } from '../dist/index.js'
import { jsonRequest, makeAnswers, makeHost, makeProfileDir, removeDir, silenceConsole, stubDecisionsFetch } from './helpers.js'

silenceConsole()

const SECRET = 'sk-test-secret-value'
const BASE = 'http://127.0.0.1:3080/api/decision-review'

describe('Connection routes', () => {
  let profileDir
  let host
  let settingsFile

  beforeEach(() => {
    profileDir = makeProfileDir()
    settingsFile = path.join(profileDir, 'decision-review.settings.json')
    fs.writeFileSync(settingsFile, JSON.stringify({ apiKey: SECRET, model: 'model-a' }))
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
  })
  afterEach(() => {
    removeDir(profileDir)
    mock.restoreAll()
    silenceConsole()
  })

  const call = (route, request) => host.routes.get(`/api/decision-review/${route}`).fetch(request)
  const stored = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

  it('mounts only authenticated Connection routes, with writes limited to POST', () => {
    const mounted = Object.fromEntries([...host.routes].map(([routePath, route]) => [routePath, route.methods]))
    assert.deepEqual(mounted, {
      '/api/decision-review/config': ['GET'],
      '/api/decision-review/save': ['POST'],
      '/api/decision-review/stats': ['GET'],
      '/api/decision-review/test': ['POST'],
    })
    for (const route of host.routes.values()) assert.equal(route.requestBody, 'buffered')
  })

  it('never returns the stored API key', async () => {
    const response = await call('config', new Request(`${BASE}/config`))
    const text = await response.text()
    assert.ok(!text.includes(SECRET))
    const payload = JSON.parse(text)
    assert.equal(payload.settings.hasApiKey, true)
    assert.equal('apiKey' in payload.settings, false)
    assert.equal(payload.settings.model, 'model-a')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  })

  it('keeps the stored key when a save omits or blanks it', async () => {
    for (const update of [{ model: 'model-b' }, { model: 'model-c', apiKey: '' }]) {
      const response = await call('save', jsonRequest(`${BASE}/save`, { settings: update }))
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.equal(payload.settings.hasApiKey, true)
      assert.ok(!JSON.stringify(payload).includes(SECRET))
      assert.equal(stored().apiKey, SECRET)
    }
    assert.equal(stored().model, 'model-c')
  })

  it('replaces and clears the key on request', async () => {
    await call('save', jsonRequest(`${BASE}/save`, { settings: { apiKey: 'sk-new' } }))
    assert.equal(stored().apiKey, 'sk-new')
    const cleared = await (await call('save', jsonRequest(`${BASE}/save`, { settings: { clearApiKey: true } }))).json()
    assert.equal(stored().apiKey, '')
    assert.equal(cleared.settings.hasApiKey, false)
  })

  it('rejects a bad save with a 4xx and leaves the stored settings alone', async () => {
    const before = fs.readFileSync(settingsFile, 'utf8')
    const badRule = await call('save', jsonRequest(`${BASE}/save`, { settings: { rules: [{ verdict: 'permit', condition: 'x' }] } }))
    assert.equal(badRule.status, 400)
    assert.match((await badRule.json()).error, /rule 1/)
    const badTimeout = await call('save', jsonRequest(`${BASE}/save`, { settings: { timeoutMs: 5000.5 } }))
    assert.equal(badTimeout.status, 400)
    const noBody = await call('save', jsonRequest(`${BASE}/save`, {}))
    assert.equal(noBody.status, 400)
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), before)
  })

  it('rejects explicit invalid endpoints and model values without changing the saved route', async () => {
    const before = fs.readFileSync(settingsFile, 'utf8')
    const invalid = {
      endpoint: [null, false, 12, [], {}, ' ', '/v1/decisions', 'https:', 'http:///example.test', 'ftp://example.test', 'https://user:password@example.test'],
      model: [null, false, 12, [], {}, ' '],
    }
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        const response = await call('save', jsonRequest(`${BASE}/save`, { settings: { [field]: value } }))
        assert.equal(response.status, 400, `${field}: ${JSON.stringify(value)}`)
        assert.match((await response.json()).error, new RegExp(field))
      }
    }
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), before)
  })

  it('preserves the exact condition text in a save and a subsequent config read', async () => {
    const condition = '  deploys to production\n\n  with affected services listed\n '
    const rules = [{ condition, verdict: 'allow_if_requested' }]
    const response = await call('save', jsonRequest(`${BASE}/save`, { settings: { rules } }))
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).settings.rules, rules)
    assert.deepEqual(stored().rules, rules)
    const payload = await (await call('config', new Request(`${BASE}/config`))).json()
    assert.deepEqual(payload.settings.rules, rules)
  })

  it('requires a JSON body on writes', async () => {
    const plain = new Request(`${BASE}/save`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ settings: { model: 'x' } }) })
    assert.equal((await call('save', plain)).status, 415)
    const broken = new Request(`${BASE}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal((await call('save', broken)).status, 400)
    const oversized = jsonRequest(`${BASE}/save`, { settings: { model: 'x'.repeat(70000) } })
    assert.equal((await call('save', oversized)).status, 413)
    assert.equal(stored().model, 'model-a')
  })

  it('serves per-session stats and demands a session id', async () => {
    assert.equal((await call('stats', new Request(`${BASE}/stats`))).status, 400)
    const payload = await (await call('stats', new Request(`${BASE}/stats?session=session-abc`))).json()
    assert.equal(payload.reviewed, 0)
    assert.equal(payload.passRate, null)
  })

  describe('smoke test', () => {
    it('rejects unknown, repeated and empty scenario lists', async () => {
      for (const scenarios of [['typo'], ['allow', 'allow'], [], 'allow']) {
        const response = await call('test', jsonRequest(`${BASE}/test`, { scenarios }))
        assert.equal(response.status, 400, JSON.stringify(scenarios))
      }
    })

    it('runs all three scenarios against one settings snapshot even if a save lands mid-run', async () => {
      const calls = stubDecisionsFetch(async (_body, _init, count) => {
        if (count === 1) await call('save', jsonRequest(`${BASE}/save`, { settings: { model: 'model-after-save' } }))
        return makeAnswers()
      })
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, {}))).json()
      assert.equal(payload.results.length, 3)
      assert.deepEqual(calls.map((entry) => entry.body.model), ['model-a', 'model-a', 'model-a'])
      assert.equal(stored().model, 'model-after-save')
    })

    it('cancels the upstream requests when the caller goes away', async () => {
      const calls = stubDecisionsFetch(async () => makeAnswers())
      const caller = new AbortController()
      caller.abort()
      const aborted = new Request(`${BASE}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: caller.signal })
      await call('test', aborted)
      assert.ok(calls.length > 0)
      assert.ok(calls.every((entry) => entry.init.signal.aborted), 'every upstream request must carry the caller’s cancellation')
    })

    it('reports an upstream failure as a row instead of failing the whole run', async () => {
      mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 401 }))
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, { scenarios: ['allow'] }))).json()
      assert.equal(payload.results[0].ok, false)
      assert.match(payload.results[0].error, /HTTP 401/)
    })

    it('reports a denial basis without inviting the reader to approve the smoke-test action', async () => {
      stubDecisionsFetch(async () => makeAnswers({ risk: 'high' }))
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, { scenarios: ['exfil'] }))).json()
      const { composed } = payload.results[0]
      assert.equal(composed.decision, 'deny')
      assert.match(composed.display.en, /high risk/)
      assert.match(composed.display.zh, /高风险/)
      assert.doesNotMatch(composed.display.en, /asks you to confirm/)
      assert.doesNotMatch(composed.display.zh, /请你确认/)
    })
  })
})
