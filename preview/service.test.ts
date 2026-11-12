import { afterEach, expect, test } from 'bun:test'
import { MULTILINE_RULE } from './fixtures.js'
import { createPreviewService } from './service.js'
import type { SceneId } from './scenes.js'

const services: ReturnType<typeof createPreviewService>[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

function harness() {
  const service = createPreviewService()
  services.push(service)
  async function request(path: string, method = 'GET', body?: object, signal?: AbortSignal) {
    return service.fetch(
      new Request(`http://localhost${path}`, {
        method,
        signal,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  }
  async function session(scene: SceneId) {
    const response = await request('/api/preview/sessions', 'POST', { scene })
    expect(response.status).toBe(201)
    const { id } = await response.json()
    const base = `/api/preview/sessions/${id}`
    return {
      request: (operation: string, body?: object, signal?: AbortSignal) =>
        request(`${base}/decision-review/${operation}`, body ? 'POST' : 'GET', body, signal),
      recover: () => request(`${base}/recover`, 'POST', {}),
      dispose: () => request(base, 'DELETE'),
    }
  }
  return { request, session }
}

test('fixtures use production normalization and keep write-only keys out of config/save', async () => {
  const { session } = harness()
  const fixture = await session('decisions')
  const before = await (await fixture.request('config')).json()
  expect(before.settings.hasApiKey).toBe(true)
  expect(before.settings.apiKey).toBeUndefined()
  const response = await fixture.request('save', { settings: { timeoutMs: '5001', apiKey: 'replacement-fixture-key' } })
  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).not.toContain('replacement-fixture-key')
  expect(JSON.parse(text).settings.timeoutMs).toBe(5001)
  const cleared = await (await fixture.request('save', { settings: { clearApiKey: true } })).json()
  expect(cleared.settings.hasApiKey).toBe(false)
})

test('failed strict validation leaves stored values unchanged and sessions stay isolated', async () => {
  const { session } = harness()
  const first = await session('decisions')
  const second = await session('session')
  const failed = await first.request('save', { settings: { timeoutMs: 'invalid', engine: 'session' } })
  expect(failed.status).toBe(400)
  expect((await failed.json()).error).toContain('timeoutMs')
  expect((await (await first.request('config')).json()).settings.engine).toBe('decisions')
  await first.request('save', { settings: { timeoutMs: 5500 } })
  expect((await (await second.request('config')).json()).settings.timeoutMs).toBe(60000)
})

test('invalid stored Decisions route remains repairable while Follow session is selected', async () => {
  const fixture = await harness().session('invalid')
  const config = await (await fixture.request('config')).json()
  expect(config.settings.engine).toBe('session')
  expect(config.settings.endpoint).toBe('')
  expect(config.settings.model).toBe('')
  expect(config.problems).toHaveLength(2)
  expect(config.runtime.paused).toBe(true)
  expect((await fixture.request('save', { settings: { timeoutMs: 6500 } })).status).toBe(400)
  expect((await fixture.request('test', {})).status).toBe(409)
  const saved = await fixture.request('save', {
    settings: { endpoint: 'https://example.invalid/decisions', model: 'synthetic' },
  })
  expect(saved.status).toBe(200)
  const fixed = await (await fixture.request('config')).json()
  expect(fixed.problems).toEqual([])
  expect(fixed.runtime.paused).toBe(false)
  expect(fixed.settings.engine).toBe('session')
})

test('multi-line rules round-trip exactly and blank rules still fail real validation', async () => {
  const fixture = await harness().session('multiline')
  const config = await (await fixture.request('config')).json()
  expect(config.settings.rules[0].condition).toBe(MULTILINE_RULE)
  const condition = `${MULTILINE_RULE}\n  additional line  `
  expect((await fixture.request('save', { settings: { rules: [{ condition, verdict: 'deny' }] } })).status).toBe(200)
  expect((await (await fixture.request('config')).json()).settings.rules).toEqual([{ condition, verdict: 'deny' }])
  expect((await fixture.request('save', { settings: { rules: [{ condition: '\n  ', verdict: 'ask' }] } })).status).toBe(
    400,
  )
})

test.each(['load-error', 'save-error', 'test-error', 'stats-error'] as const)(
  '%s recovers without replacing stored settings',
  async (scene) => {
    const fixture = await harness().session(scene)
    const route =
      scene === 'load-error'
        ? 'config'
        : scene === 'stats-error'
          ? 'stats?session=preview'
          : scene.replace('-error', '')
    const body =
      scene === 'save-error' ? { settings: { model: 'saved-fixture' } } : scene === 'test-error' ? {} : undefined
    expect((await fixture.request(route, body)).status).toBe(503)
    expect((await fixture.recover()).status).toBe(200)
    expect((await fixture.request(route, body)).status).toBe(200)
  },
)

test('synthetic test uses the real composer, validates scenario lists, and never fetches a provider', async () => {
  const fixture = await harness().session('test-mixed')
  const response = await fixture.request('test', {})
  expect(response.status).toBe(200)
  const { results } = await response.json()
  expect(results.map((result: { ok: boolean }) => result.ok)).toEqual([true, true, false])
  expect(results[0].composed.decision).toBe('allow')
  expect(results[1].composed.why.code).toBe('exfiltration')
  expect(results[1].composed.display.zh).toBeString()
  for (const scenarios of [null, [], ['allow', 'allow'], ['unknown']]) {
    expect((await fixture.request('test', { scenarios })).status).toBe(400)
  }
  await fixture.request('save', { settings: { tConf: 0.99 } })
  const threshold = await (await fixture.request('test', { scenarios: ['allow'] })).json()
  expect(threshold.results[0].composed.why.code).toBe('low_confidence')
})

test('disposing a scene cancels a delayed save; a fresh scene is untouched', async () => {
  const { session } = harness()
  const old = await session('slow')
  const pending = old.request('save', { settings: { model: 'stale-save' } })
  await old.dispose()
  expect((await pending).status).toBe(499)
  expect((await old.request('config')).status).toBe(404)
  const fresh = await session('decisions')
  expect((await (await fresh.request('config')).json()).settings.model).toBe('synthetic-reviewer')
})

test('request abort cancels a delayed operation and empty stats remain empty', async () => {
  const { session } = harness()
  const slow = await session('slow')
  const controller = new AbortController()
  const pending = slow.request('test', {}, controller.signal)
  controller.abort()
  expect((await pending).status).toBe(499)
  const empty = await session('stats-empty')
  const stats = await (await empty.request('stats?session=preview')).json()
  expect(stats.reviewed).toBe(0)
  expect(stats.passRate).toBeNull()
})

test('preview routes reject unknown scenes, cross-origin writes and wrong methods', async () => {
  const service = createPreviewService()
  services.push(service)
  expect((await service.fetch(new Request('http://localhost/api/preview/sessions'))).status).toBe(405)
  expect(
    (
      await service.fetch(
        new Request('http://localhost/api/preview/sessions', {
          method: 'POST',
          headers: { origin: 'https://example.invalid' },
        }),
      )
    ).status,
  ).toBe(403)
  const { request } = harness()
  expect((await request('/api/preview/sessions', 'POST', { scene: 'unknown' })).status).toBe(400)
})
