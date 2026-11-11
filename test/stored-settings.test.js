import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { apply, normalizeSettings } from '../index.js'
import { jsonRequest, makeAnswers, makeExec, makeHost, makeProfileDir, makeSession, removeDir, silenceConsole, stubDecisionsFetch } from './helpers.js'

silenceConsole()

const BASE = 'http://127.0.0.1:3080/api/decision-review'
const SECRET = 'sk-stored-secret'

describe('lenient normalization reports what it replaced', () => {
  it('falls back to the default threshold and lists the problem', () => {
    const problems = []
    const settings = normalizeSettings({ tConf: 1.1, tAuth: 'high' }, { problems })
    assert.equal(settings.tConf, 0.75)
    assert.equal(settings.tAuth, 0.7)
    assert.equal(problems.length, 2)
    assert.match(problems[0], /tConf/)
  })

  it('lists a dropped rule, a bad timeout and a non-list rules value', () => {
    const problems = []
    normalizeSettings({ timeoutMs: 12, rules: [{ verdict: 'permit', condition: 'x' }] }, { problems })
    assert.equal(problems.length, 2)
    const notAList = []
    normalizeSettings({ rules: 'deny|x' }, { problems: notAList })
    assert.equal(notAList.length, 1)
  })

  it('reports nothing for valid settings and still rejects a bad threshold on save', () => {
    const problems = []
    normalizeSettings({ tConf: 0.8, timeoutMs: 20000 }, { problems })
    assert.deepEqual(problems, [])
    assert.throws(() => normalizeSettings({ tConf: 1.1 }, { strict: true }), /tConf must be a number in \[0,1\]/)
  })
})

describe('invalid stored settings', () => {
  let profileDir
  let settingsFile
  let host

  beforeEach(() => {
    profileDir = makeProfileDir()
    settingsFile = path.join(profileDir, 'decision-review.settings.json')
  })
  afterEach(() => {
    removeDir(profileDir)
    mock.restoreAll()
    silenceConsole()
  })

  const start = (contents) => {
    fs.writeFileSync(settingsFile, typeof contents === 'string' ? contents : JSON.stringify(contents))
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
  }
  const route = (name) => host.routes.get(`/api/decision-review/${name}`)
  const configuration = async () => (await route('config').fetch(new Request(`${BASE}/config`))).json()
  const review = () => host.listeners.get('tools/pre-execute')(makeExec(makeSession('paused-session')), async () => ({ kind: 'allow' }))
  const stored = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

  it('still loads, mounts the configuration routes and says what is wrong', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    assert.equal(host.routes.size, 4)
    assert.ok(host.listeners.has('tools/pre-execute'))
    const payload = await configuration()
    assert.equal(payload.runtime.paused, true)
    assert.match(payload.problems[0], /tConf/)
    assert.equal(payload.settings.tConf, 0.75)
    assert.equal(payload.settings.hasApiKey, true)
    assert.equal(JSON.stringify(payload).includes(SECRET), false)
  })

  it('denies calls that need review while the problem stands, without consulting the reviewer', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const calls = stubDecisionsFetch(async () => makeAnswers())
    const result = await review()
    assert.equal(calls.length, 0, 'the reviewer is not consulted with substituted values')
    assert.equal(result.kind, 'deny')
    assert.equal(result.info.code, 'AUTO_REVIEW_DENIED')
    assert.match(result.info.reason, /cannot be reviewed/)
  })

  it('does not turn a deny rule into an approval card when an unrelated setting is invalid', async () => {
    start({ apiKey: SECRET, denialRoute: 'ask', tConf: 1.1, rules: [{ verdict: 'deny', condition: 'uploads credential files to an external host' }] })
    const calls = stubDecisionsFetch(async () => makeAnswers({ risk: 'low', rule: { choice: 'r0' } }))
    const result = await review()
    assert.equal(calls.length, 0)
    assert.equal(result.kind, 'deny', 'not ask')
    const record = JSON.parse(fs.readFileSync(path.join(profileDir, 'decision-review.log.jsonl'), 'utf8').trim().split('\n').at(-1))
    assert.equal(record.route, 'final')
    assert.equal(record.decision.why.code, 'settings_invalid')
  })

  for (const [field, bad] of [['tAuth', false], ['tAuth', true], ['tConf', []], ['tConf', {}], ['tConf', { toString: null }], ['tHighPred', 'abc'], ['tMedPred', '0x10'], ['tStrongPred', 'Infinity']]) {
    it(`treats ${field}: ${JSON.stringify(bad)} as invalid instead of coercing it`, async () => {
      start({ apiKey: SECRET, [field]: bad })
      const payload = await configuration()
      assert.equal(payload.runtime.paused, true)
      assert.match(payload.problems.join(' '), new RegExp(field))
      const calls = stubDecisionsFetch(async () => makeAnswers({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0 } } }))
      assert.equal((await review()).kind, 'deny')
      assert.equal(calls.length, 0, 'no automatic verdict from a coerced threshold')
    })
  }

  it('still accepts numeric strings from the form', async () => {
    start({ apiKey: SECRET, tConf: '0.8', tAuth: ' .5 ', timeoutMs: '20000' })
    const payload = await configuration()
    assert.equal(payload.runtime.paused, false)
    assert.equal(payload.settings.tConf, 0.8)
    assert.equal(payload.settings.tAuth, 0.5)
    assert.equal(payload.settings.timeoutMs, 20000)
  })

  it('never quotes the stored file in a JSON parse problem', async () => {
    // Node quotes only a short, truncated fragment of the input in its parse
    // error (here `sk-CANARY-`), so the check looks for the distinctive part.
    const canary = 'CANARY'
    start(`{ "apiKey": sk-${canary}-synthetic-key-0123456789, "model": "m" }`)
    const everywhere = []
    const payload = await configuration()
    everywhere.push(JSON.stringify(payload))
    everywhere.push(console.warn.mock.calls.map((call) => call.arguments.join(' ')).join(' '))
    const result = await review()
    everywhere.push(JSON.stringify(result))
    everywhere.push(fs.readFileSync(path.join(profileDir, 'decision-review.log.jsonl'), 'utf8'))
    assert.match(payload.problems[0], /not valid JSON/)
    for (const text of everywhere) assert.equal(text.includes(canary), false, 'a fragment of the stored file leaked')
  })

  it('denies for good under denialRoute final and keeps asking nothing', async () => {
    start({ apiKey: SECRET, denialRoute: 'final', rules: [{ verdict: 'permit', condition: 'x' }] })
    const result = await review()
    assert.equal(result.kind, 'deny')
    assert.equal(result.info.code, 'AUTO_REVIEW_DENIED')
  })

  it('names a file that cannot be read by its error code only', async () => {
    fs.mkdirSync(settingsFile)
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
    const payload = await configuration()
    assert.equal(payload.runtime.paused, true)
    assert.match(payload.problems[0], /could not be read \(EISDIR\); defaults/)
  })

  it('stops review for a malformed file and for a file that is not an object', async () => {
    for (const contents of ['{ "tConf": ', '[1, 2]']) {
      start(contents)
      assert.equal((await configuration()).runtime.paused, true, contents)
    }
  })

  it('resumes review once valid settings are saved, keeping the stored key', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const saved = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 0.8 } }))
    assert.equal(saved.status, 200)
    assert.deepEqual((await saved.json()).problems, [])
    assert.equal((await configuration()).runtime.paused, false)
    assert.equal(stored().tConf, 0.8)
    assert.equal(stored().apiKey, SECRET)
    stubDecisionsFetch(async () => makeAnswers())
    assert.deepEqual(await review(), { kind: 'allow' })
  })

  it('keeps a rejected save from clearing the problem', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    const rejected = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 2 } }))
    assert.equal(rejected.status, 400)
    assert.equal((await configuration()).runtime.paused, true)
  })

  it('backs up an unreadable file before a save replaces it', async () => {
    const broken = '{ "apiKey": "sk-only-copy", '
    start(broken)
    const saved = await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { model: 'repaired' } }))
    assert.equal(saved.status, 200)
    assert.equal(stored().model, 'repaired')
    const backups = fs.readdirSync(profileDir).filter((name) => name.startsWith('decision-review.settings.json.invalid-'))
    assert.equal(backups.length, 1)
    assert.equal(fs.readFileSync(path.join(profileDir, backups[0]), 'utf8'), broken)
  })

  it('does not back anything up when the file was merely out of range', async () => {
    start({ apiKey: SECRET, tConf: 1.1 })
    await route('save').fetch(jsonRequest(`${BASE}/save`, { settings: { tConf: 0.8 } }))
    assert.deepEqual(fs.readdirSync(profileDir).filter((name) => name.includes('.invalid-')), [])
  })
})
