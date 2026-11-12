import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { normalizeSettings } from '../dist/index.js'

let warn
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('timeoutMs', () => {
  test.each([
    ['an omitted value', {}, 60000],
    ['an empty string', { timeoutMs: '' }, 60000],
    ['an integer string', { timeoutMs: '15000' }, 15000],
    ['the minimum', { timeoutMs: 5000 }, 5000],
    ['the maximum', { timeoutMs: 600000 }, 600000],
  ])('normalizes %s when saving', (_scenario, raw, expected) => {
    expect(normalizeSettings(raw, { strict: true }).timeoutMs).toBe(expected)
  })

  test.each([
    ['a fractional number', 5000.5],
    ['a number below the minimum', 4999],
    ['a number above the maximum', 600001],
    ['an oversized number', 5000000000],
    ['a nonnumeric string', 'abc'],
  ])('rejects %s when saving', (_scenario, timeoutMs) => {
    expect(() => normalizeSettings({ timeoutMs }, { strict: true })).toThrow(/timeoutMs must be an integer/)
  })

  test.each([
    ['a fractional number', 5000.5],
    ['an oversized number', 5000000000],
  ])('defaults when reading %s from storage', (_scenario, timeoutMs) => {
    expect(normalizeSettings({ timeoutMs }).timeoutMs).toBe(60000)
  })

  test.each([
    ['false', false],
    ['true', true],
    ['an array', []],
    ['an object', {}],
    ['an object with a non-callable toString', { toString: null }],
    ['a hexadecimal string', '0x4000'],
  ])('does not coerce %s into a timeout', (_scenario, timeoutMs) => {
    expect(() => normalizeSettings({ timeoutMs }, { strict: true })).toThrow(/timeoutMs must be an integer/)
    const problems = []
    expect(normalizeSettings({ timeoutMs }, { problems }).timeoutMs).toBe(60000)
    expect(problems).toHaveLength(1)
  })
})

describe('thresholds', () => {
  test('accept numeric boundaries, decimals and scientific notation together', () => {
    const settings = normalizeSettings(
      { tConf: 0, tHighPred: 1, tMedPred: '0.25', tStrongPred: ' .5 ', tAuth: '1e-1' },
      { strict: true },
    )
    expect(settings).toMatchObject({ tConf: 0, tHighPred: 1, tMedPred: 0.25, tStrongPred: 0.5, tAuth: 0.1 })
  })

  test.each([
    ['false', false],
    ['true', true],
    ['an empty array', []],
    ['a numeric array', [0.5]],
    ['an object', {}],
    ['an object with a non-callable toString', { toString: null }],
    ['a nonnumeric string', 'abc'],
    ['a hexadecimal string', '0x10'],
    ['the string Infinity', 'Infinity'],
    ['the string NaN', 'NaN'],
    ['a number above the maximum', 1.1],
    ['a number below the minimum', -0.1],
  ])('reject %s when saving', (_scenario, tAuth) => {
    expect(() => normalizeSettings({ tAuth }, { strict: true })).toThrow(/tAuth must be a number in \[0,1\]/)
  })

  test.each([
    ['false', false],
    ['an empty array', []],
    ['an object with a non-callable toString', { toString: null }],
    ['a nonnumeric string', 'abc'],
  ])('report %s in storage and keep the default', (_scenario, tAuth) => {
    const problems = []
    expect(normalizeSettings({ tAuth }, { problems }).tAuth).toBe(0.7)
    expect(problems).toHaveLength(1)
    expect(problems[0].detail).not.toContain('abc')
  })
})

describe('rules', () => {
  test.each([
    ['an empty condition', [{ verdict: 'deny', condition: '' }], /rule 1.*non-empty condition/],
    ['an unknown verdict', [{ verdict: 'permit', condition: 'x' }], /rule 1.*known verdict/],
    ['a non-list value', 'deny|x', /must be a list/],
    ['a whitespace-only condition', [{ verdict: 'deny', condition: ' \n ' }], /non-empty condition/],
  ])('reject %s when saving', (_scenario, rules, problem) => {
    expect(() => normalizeSettings({ rules }, { strict: true })).toThrow(problem)
  })

  test.each([
    [
      'the rule count limit',
      Array.from({ length: 21 }, (_, index) => ({ verdict: 'ask', condition: `rule ${index}` })),
      /20-rule limit/,
    ],
    ['the per-condition limit', [{ verdict: 'ask', condition: 'x'.repeat(401) }], /longer than 400/],
    [
      'the total condition limit',
      Array.from({ length: 6 }, () => ({ verdict: 'ask', condition: 'x'.repeat(400) })),
      /2000 characters in total/,
    ],
    [
      'the per-condition limit counting surrounding whitespace',
      [{ verdict: 'deny', condition: ` ${'a'.repeat(399)} ` }],
      /longer than 400/,
    ],
  ])('reject a list exceeding %s when saving', (_scenario, rules, problem) => {
    expect(() => normalizeSettings({ rules }, { strict: true })).toThrow(problem)
  })

  test('drop a bad stored rule and report the problem', () => {
    const problems = []
    const settings = normalizeSettings(
      {
        rules: [
          { verdict: 'permit', condition: 'x' },
          { verdict: 'ask', condition: 'ok' },
        ],
      },
      { problems },
    )
    expect(settings.rules).toStrictEqual([{ condition: 'ok', verdict: 'ask' }])
    expect(problems).toHaveLength(1)
    expect(problems[0].detail).toMatch(/stored rule 1 was dropped/)
  })
})

describe('Decisions route fields', () => {
  test('use the default endpoint and model when both fields are omitted', () => {
    const settings = normalizeSettings({}, { strict: true })
    expect(settings).toMatchObject({ endpoint: 'https://api.openai.com/v1/decisions', model: 'gpt-6-luna' })
  })

  test('trim and accept a custom HTTP endpoint and model', () => {
    const settings = normalizeSettings(
      { endpoint: ' http://localhost:4000/review?route=local ', model: ' review/model-2 ' },
      { strict: true },
    )
    expect(settings).toMatchObject({ endpoint: 'http://localhost:4000/review?route=local', model: 'review/model-2' })
  })
})
