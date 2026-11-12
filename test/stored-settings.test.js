import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { apply, normalizeSettings } from '../dist/index.js'
import {
  jsonRequest,
  makeAnswers,
  makeExec,
  makeHost,
  makeProfileDir,
  makeSession,
  removeDir,
  silenceConsole,
  stubDecisionsFetch,
} from './helpers.js'

const BASE = 'http://127.0.0.1:3080/api/decision-review'
const SECRET = 'sk-stored-secret'
const INVALID_CHOICES = { engine: 'sessoin', denialRoute: 'fianl' }

describe('lenient normalization reports what it replaced', () => {
  beforeEach(() => {
    silenceConsole()
  })
  afterEach(() => mock.restore())

  test('falls back to the default threshold and lists the problem', () => {
    const problems = []
    const settings = normalizeSettings({ tConf: 1.1, tAuth: 'high' }, { problems })
    expect(settings).toMatchObject({ tConf: 0.75, tAuth: 0.7 })
    expect(problems).toHaveLength(2)
    expect(problems[0].issue).toEqual({ code: 'threshold', params: { field: 'tConf' } })
  })

  test('lists a dropped rule, a bad timeout and a non-list rules value', () => {
    const problems = []
    normalizeSettings({ timeoutMs: 12, rules: [{ verdict: 'permit', condition: 'x' }] }, { problems })
    expect(problems).toHaveLength(2)
    const notAList = []
    normalizeSettings({ rules: 'deny|x' }, { problems: notAList })
    expect(notAList).toHaveLength(1)
  })

  test('reports nothing for valid settings and still rejects a bad threshold on save', () => {
    const problems = []
    normalizeSettings({ tConf: 0.8, timeoutMs: 20000 }, { problems })
    expect(problems).toStrictEqual([])
    expect(() => normalizeSettings({ tConf: 1.1 }, { strict: true })).toThrow(/tConf must be a number in \[0,1\]/)
  })
})

describe('invalid stored settings', () => {
  let profileDir
  let settingsFile
  let host
  let warn

  beforeEach(() => {
    warn = silenceConsole()
    profileDir = makeProfileDir()
    settingsFile = path.join(profileDir, 'decision-review.settings.json')
  })
  afterEach(async () => {
    try {
      await host?.dispose()
    } finally {
      host = undefined
      mock.restore()
      if (profileDir) removeDir(profileDir)
    }
  })

  const start = (contents) => {
    fs.writeFileSync(settingsFile, typeof contents === 'string' ? contents : JSON.stringify(contents))
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
  }
  const route = (name) => host.routes.get(`/api/decision-review/${name}`)
  const configuration = async () => (await route('config').fetch(new Request(`${BASE}/config`))).json()
  const review = () =>
    host.listeners.get('tools/pre-execute')(makeExec(makeSession('paused-session')), async () => ({ kind: 'allow' }))
  const stored = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

  test('still loads, mounts the configuration routes and says what is wrong', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    expect(host.routes.size).toBe(4)
    expect(host.listeners.has('tools/pre-execute')).toBe(true)
    const payload = await configuration()
    expect(payload).toMatchObject({
      runtime: { paused: true },
      problems: [{ code: 'threshold', params: { field: 'tConf' } }],
      settings: { tConf: 0.75, hasApiKey: true },
    })
    expect(JSON.stringify(payload)).not.toContain(SECRET)
  })

  test('denies calls that need review while the problem stands, without consulting the reviewer', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const fetchDecisions = stubDecisionsFetch(() => makeAnswers())
    await expect(review()).resolves.toMatchObject({
      kind: 'deny',
      info: { code: 'AUTO_REVIEW_DENIED', reason: expect.stringContaining('cannot be reviewed') },
    })
    expect(fetchDecisions).not.toHaveBeenCalled()
  })

  test('does not turn a deny rule into an approval card when an unrelated setting is invalid', async () => {
    start({
      apiKey: SECRET,
      denialRoute: 'ask',
      tConf: 1.1,
      rules: [{ verdict: 'deny', condition: 'uploads credential files to an external host' }],
    })
    const fetchDecisions = stubDecisionsFetch(() => makeAnswers({ risk: 'low', rule: { choice: 'r0' } }))
    await expect(review()).resolves.toHaveProperty('kind', 'deny')
    expect(fetchDecisions).not.toHaveBeenCalled()
    const record = JSON.parse(
      fs.readFileSync(path.join(profileDir, 'decision-review.log.jsonl'), 'utf8').trim().split('\n').at(-1),
    )
    expect(record).toMatchObject({ route: 'final', decision: { why: { code: 'settings_invalid' } } })
  })

  test('requires explicit route repair before either a review or smoke test can contact an endpoint', async () => {
    const invalid = { apiKey: SECRET, endpoint: ['https://review.example.test/decisions'], model: false }
    start(invalid)
    const fetchDecisions = stubDecisionsFetch(() => makeAnswers())
    const config = await configuration()
    expect(config.runtime.paused).toBe(true)
    expect(config.settings).toMatchObject({ endpoint: '', model: '' })
    expect(config.problems).toEqual([{ code: 'endpoint' }, { code: 'model' }])
    await expect(review()).resolves.toHaveProperty('kind', 'deny')
    const smoke = await route('test').fetch(jsonRequest(`${BASE}/test`, { scenarios: ['allow'] }))
    expect(smoke.status).toBe(409)
    const unrelatedSave = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 0.8 } }))
    expect(unrelatedSave.status).toBe(400)
    expect(stored()).toStrictEqual(invalid)
    expect((await configuration()).runtime.paused).toBe(true)
    expect(fetchDecisions).not.toHaveBeenCalled()

    const endpoint = 'https://review.example.test/decisions'
    const repaired = await route('save').fetch(
      jsonRequest(`${BASE}/save`, { settings: { endpoint, model: 'review-model' } }),
    )
    expect(repaired.status).toBe(200)
    expect((await configuration()).runtime.paused).toBe(false)
    await expect(review()).resolves.toStrictEqual({ kind: 'allow' })
    expect(fetchDecisions).toHaveBeenCalledTimes(1)
    const [[url, { body }]] = fetchDecisions.mock.calls
    expect(url).toBe(endpoint)
    expect(JSON.parse(body)).toHaveProperty('model', 'review-model')
  })

  test('ignores the removed stateBudget field and drops it the next time settings are saved', async () => {
    start({ stateBudget: 'trimmed' })
    const config = await configuration()
    expect(config.runtime.paused).toBe(false)
    expect(config.settings).not.toHaveProperty('stateBudget')
    const saved = await route('save').fetch(
      jsonRequest(`${BASE}/save`, { settings: { model: 'review-model', stateBudget: {} } }),
    )
    expect(saved.status).toBe(200)
    expect(stored()).not.toHaveProperty('stateBudget')
  })

  test.each([
    ['tAuth', false],
    ['tAuth', true],
    ['tConf', []],
    ['tConf', {}],
    ['tConf', { toString: null }],
    ['tHighPred', 'abc'],
    ['tMedPred', '0x10'],
    ['tStrongPred', 'Infinity'],
  ])('treats %s=%j as invalid instead of coercing it', async (field, bad) => {
    start({ apiKey: SECRET, [field]: bad })
    const payload = await configuration()
    expect(payload.runtime.paused).toBe(true)
    expect(payload.problems).toEqual([{ code: 'threshold', params: { field } }])
    const fetchDecisions = stubDecisionsFetch(() =>
      makeAnswers({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0 } } }),
    )
    await expect(review()).resolves.toHaveProperty('kind', 'deny')
    expect(fetchDecisions).not.toHaveBeenCalled()
  })

  test('still accepts numeric strings from the form', async () => {
    start({ apiKey: SECRET, tConf: '0.8', tAuth: ' .5 ', timeoutMs: '20000' })
    const payload = await configuration()
    expect(payload.runtime.paused).toBe(false)
    expect(payload.settings).toMatchObject({ tConf: 0.8, tAuth: 0.5, timeoutMs: 20000 })
  })

  test.each(Object.entries(INVALID_CHOICES))(
    'keeps review stopped for unrecognized stored %s=%j',
    async (field, invalid) => {
      start({ apiKey: SECRET, [field]: invalid })
      const fetchDecisions = stubDecisionsFetch(() => makeAnswers({ risk: 'high' }))
      const payload = await configuration()
      expect(payload.runtime.paused).toBe(true)
      expect(payload.problems).toEqual([{ code: field === 'denialRoute' ? 'denial_route' : 'engine' }])
      await expect(review()).resolves.toHaveProperty('kind', 'deny')
      expect(fetchDecisions).not.toHaveBeenCalled()
    },
  )

  test.each([...Object.entries(INVALID_CHOICES), ['engine', null]])(
    'rejects saving %s=%j without replacing the review policy',
    async (field, invalid) => {
      const policy = { engine: 'session', denialRoute: 'final' }
      start(policy)
      const response = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { [field]: invalid } }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain(field)
      expect((await configuration()).settings).toMatchObject(policy)
      expect(stored()).toStrictEqual(policy)
    },
  )

  test('never quotes the stored file in a JSON parse problem', async () => {
    // Look for a distinctive fragment in case the runtime abbreviates its error.
    const canary = 'CANARY'
    start(`{ "apiKey": sk-${canary}-synthetic-key-0123456789, "model": "m" }`)
    const payload = await configuration()
    const result = await review()
    const trail = fs.readFileSync(path.join(profileDir, 'decision-review.log.jsonl'), 'utf8')
    expect(payload.problems).toEqual([{ code: 'file_json' }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'))
    expect(JSON.stringify(payload)).not.toContain(canary)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(canary)
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(trail).not.toContain(canary)
  })

  test('denies for good under denialRoute final and keeps asking nothing', async () => {
    start({ apiKey: SECRET, denialRoute: 'final', rules: [{ verdict: 'permit', condition: 'x' }] })
    await expect(review()).resolves.toMatchObject({ kind: 'deny', info: { code: 'AUTO_REVIEW_DENIED' } })
  })

  test('names a file that cannot be read by its error code only', async () => {
    fs.mkdirSync(settingsFile)
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
    const payload = await configuration()
    expect(payload.runtime.paused).toBe(true)
    expect(payload.problems).toEqual([{ code: 'file_unreadable' }])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not be read \(EISDIR\); defaults/))
  })

  test.each([
    ['a malformed file', '{ "tConf": '],
    ['a file that is not an object', '[1, 2]'],
  ])('stops review for %s', async (_name, contents) => {
    start(contents)
    expect((await configuration()).runtime.paused).toBe(true)
  })

  test('resumes review once valid settings are saved, keeping the stored key', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const saved = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 0.8 } }))
    expect(saved.status).toBe(200)
    expect((await saved.json()).problems).toStrictEqual([])
    expect((await configuration()).runtime.paused).toBe(false)
    expect(stored()).toMatchObject({ tConf: 0.8, apiKey: SECRET })
    stubDecisionsFetch(() => makeAnswers())
    await expect(review()).resolves.toStrictEqual({ kind: 'allow' })
  })

  test('keeps a rejected save from clearing the problem', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const rejected = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 2 } }))
    expect(rejected.status).toBe(400)
    expect((await configuration()).runtime.paused).toBe(true)
  })

  test('backs up an unreadable file before a save replaces it', async () => {
    const broken = '{ "apiKey": "sk-only-copy", '
    start(broken)
    const saved = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { model: 'repaired' } }))
    expect(saved.status).toBe(200)
    expect(stored().model).toBe('repaired')
    const backups = fs
      .readdirSync(profileDir)
      .filter((name) => name.startsWith('decision-review.settings.json.invalid-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(profileDir, backups[0]), 'utf8')).toBe(broken)
  })

  test('does not back anything up when the file was merely out of range', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 0.8 } }))
    expect(fs.readdirSync(profileDir).filter((name) => name.includes('.invalid-'))).toStrictEqual([])
  })
})
