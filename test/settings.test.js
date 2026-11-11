import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeSettings } from '../index.js'
import { silenceConsole } from './helpers.js'

silenceConsole()

describe('timeoutMs', () => {
  it('defaults when empty and accepts integers in range', () => {
    assert.equal(normalizeSettings({}).timeoutMs, 60000)
    assert.equal(normalizeSettings({ timeoutMs: '' }, { strict: true }).timeoutMs, 60000)
    assert.equal(normalizeSettings({ timeoutMs: '15000' }, { strict: true }).timeoutMs, 15000)
  })

  it('rejects fractional, tiny and oversized values when saving', () => {
    for (const bad of [5000.5, 4999, 600001, 5000000000, 'abc']) {
      assert.throws(() => normalizeSettings({ timeoutMs: bad }, { strict: true }), /timeoutMs must be an integer/, String(bad))
    }
  })

  it('falls back to the default when reading a stored bad value', () => {
    for (const bad of [5000.5, 5000000000]) assert.equal(normalizeSettings({ timeoutMs: bad }).timeoutMs, 60000)
  })

  it('does not coerce other types into a timeout', () => {
    for (const bad of [false, true, [], {}, { toString: null }, '0x4000']) {
      assert.throws(() => normalizeSettings({ timeoutMs: bad }, { strict: true }), /timeoutMs must be an integer/, JSON.stringify(bad))
      const problems = []
      assert.equal(normalizeSettings({ timeoutMs: bad }, { problems }).timeoutMs, 60000)
      assert.equal(problems.length, 1)
    }
  })
})

describe('thresholds', () => {
  it('accept finite numbers in range and plain decimal strings', () => {
    const settings = normalizeSettings({ tConf: 0, tHighPred: 1, tMedPred: '0.25', tStrongPred: ' .5 ', tAuth: '1e-1' }, { strict: true })
    assert.deepEqual([settings.tConf, settings.tHighPred, settings.tMedPred, settings.tStrongPred, settings.tAuth], [0, 1, 0.25, 0.5, 0.1])
  })

  it('reject other types instead of coercing them, even when saving', () => {
    for (const bad of [false, true, [], [0.5], {}, { toString: null }, 'abc', '0x10', 'Infinity', 'NaN', 1.1, -0.1]) {
      assert.throws(() => normalizeSettings({ tAuth: bad }, { strict: true }), /tAuth must be a number in \[0,1\]/, JSON.stringify(bad))
    }
  })

  it('report a stored value of the wrong type and keep the default, without throwing', () => {
    for (const bad of [false, [], { toString: null }, 'abc']) {
      const problems = []
      assert.equal(normalizeSettings({ tAuth: bad }, { problems }).tAuth, 0.7)
      assert.equal(problems.length, 1)
      assert.equal(problems[0].includes('abc'), false, 'the stored value is not echoed')
    }
  })
})

describe('rules', () => {
  it('reject malformed rules when saving instead of dropping them', () => {
    assert.throws(() => normalizeSettings({ rules: [{ verdict: 'deny', condition: '' }] }, { strict: true }), /rule 1/)
    assert.throws(() => normalizeSettings({ rules: [{ verdict: 'permit', condition: 'x' }] }, { strict: true }), /rule 1/)
    assert.throws(() => normalizeSettings({ rules: 'deny|x' }, { strict: true }), /must be a list/)
  })

  it('enforce the count and size caps when saving', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ verdict: 'ask', condition: `rule ${index}` }))
    assert.throws(() => normalizeSettings({ rules: many }, { strict: true }), /20-rule limit/)
    assert.throws(() => normalizeSettings({ rules: [{ verdict: 'ask', condition: 'x'.repeat(401) }] }, { strict: true }), /longer than 400/)
    const wide = Array.from({ length: 6 }, () => ({ verdict: 'ask', condition: 'x'.repeat(400) }))
    assert.throws(() => normalizeSettings({ rules: wide }, { strict: true }), /2000 characters in total/)
  })

  it('counts all condition characters, including leading and trailing whitespace', () => {
    const condition = ` ${'a'.repeat(399)} `
    assert.throws(() => normalizeSettings({ rules: [{ verdict: 'deny', condition }] }, { strict: true }), /longer than 400/)
    assert.throws(() => normalizeSettings({ rules: [{ verdict: 'deny', condition: ' \n ' }] }, { strict: true }), /non-empty condition/)
  })

  it('drop a bad stored rule with a warning instead of keeping the plugin from loading', () => {
    const settings = normalizeSettings({ rules: [{ verdict: 'permit', condition: 'x' }, { verdict: 'ask', condition: 'ok' }] })
    assert.deepEqual(settings.rules, [{ condition: 'ok', verdict: 'ask' }])
  })
})

describe('Decisions route fields', () => {
  it('uses the defaults only for omitted fields and accepts a custom HTTP route and model', () => {
    const defaults = normalizeSettings({}, { strict: true })
    assert.equal(defaults.endpoint, 'https://api.openai.com/v1/decisions')
    assert.equal(defaults.model, 'gpt-6-luna')
    const custom = normalizeSettings({ endpoint: ' http://localhost:4000/review?route=local ', model: ' review/model-2 ' }, { strict: true })
    assert.equal(custom.endpoint, 'http://localhost:4000/review?route=local')
    assert.equal(custom.model, 'review/model-2')
  })
})
