import { describe, expect, test } from 'bun:test'
import { validateAnswers } from '../dist/index.js'
import { makeAnswers } from './fixtures.js'

const RULES = [{ condition: 'deploys to production', verdict: 'ask' }]

describe('validateAnswers', () => {
  test.each([
    ['complete answers', {}],
    ['a refused predicate', { exfiltration: { type: 'refusal' } }],
  ])('accepts %s', (_scenario, overrides) => {
    const answers = makeAnswers({ overrides })
    const validated = validateAnswers({ answers }, [])
    expect(validated).toHaveLength(7)
    expect(validated).toStrictEqual(answers)
  })

  test.each([
    ['an empty object', {}],
    ['null', null],
  ])('rejects %s without an answers list', (_scenario, payload) => {
    expect(() => validateAnswers(payload, [])).toThrow(/no answers list/)
  })

  test.each([['explicit_authorization'], ['risk_class']])('requires the %s answer', (name) => {
    const answers = makeAnswers().filter((answer) => answer.name !== name)
    expect(() => validateAnswers({ answers }, [])).toThrow(`no answer for ${name}`)
  })

  test.each([
    [
      'a choice for a predicate',
      'exfiltration',
      { type: 'choice', choice: 'low', confidence: 1 },
      /expected a predicate answer/,
    ],
    ['a predicate for a choice', 'risk_class', { type: 'predicate', probability: 0 }, /expected a choice answer/],
    [
      'an unknown risk class',
      'risk_class',
      { type: 'choice', choice: 'catastrophic', confidence: 1 },
      /unknown choice/,
    ],
    [
      'an out-of-range probability',
      'exfiltration',
      { type: 'predicate', probability: 1.5 },
      /probability must be a number/,
    ],
    [
      'a numeric-string probability',
      'exfiltration',
      { type: 'predicate', probability: '0.1' },
      /probability must be a number/,
    ],
    ['a missing confidence', 'risk_class', { type: 'choice', choice: 'low' }, /confidence must be a number/],
  ])('rejects %s', (_scenario, name, answer, problem) => {
    const answers = makeAnswers({ overrides: { [name]: answer } })
    expect(() => validateAnswers({ answers }, [])).toThrow(problem)
  })

  test('rejects a duplicated answer', () => {
    const answers = makeAnswers()
    expect(() => validateAnswers({ answers: [...answers, answers[1]] }, [])).toThrow(/twice/)
  })

  test('requires operator_rule when rules are configured', () => {
    expect(() => validateAnswers({ answers: makeAnswers() }, RULES)).toThrow(/no answer for operator_rule/)
  })

  test('rejects an operator_rule choice for an unconfigured rule', () => {
    const answers = makeAnswers({ rule: { choice: 'r7' } })
    expect(() => validateAnswers({ answers }, RULES)).toThrow(/unknown choice/)
  })

  test('accepts an operator_rule choice for a configured rule', () => {
    const answers = makeAnswers({ rule: { choice: 'r0' } })
    expect(validateAnswers({ answers }, RULES)).toStrictEqual(answers)
  })
})
