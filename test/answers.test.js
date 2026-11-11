import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateAnswers } from '../dist/index.js'
import { makeAnswers } from './helpers.js'

const RULES = [{ condition: 'deploys to production', verdict: 'ask' }]

function check(mutate, rules = []) {
  const answers = makeAnswers({ rule: rules.length > 0 ? { choice: 'none' } : undefined })
  return () => validateAnswers({ answers: mutate(answers) }, rules)
}

describe('validateAnswers', () => {
  it('accepts a complete answer list and refusals', () => {
    assert.equal(check((answers) => answers)().length, 7)
    assert.doesNotThrow(check((answers) => answers.map((a) => (a.name === 'exfiltration' ? { name: a.name, type: 'refusal' } : a))))
  })

  it('rejects a response without an answers list', () => {
    assert.throws(() => validateAnswers({}, []), /no answers list/)
    assert.throws(() => validateAnswers(null, []), /no answers list/)
  })

  it('rejects a missing predicate answer', () => {
    assert.throws(check((answers) => answers.filter((a) => a.name !== 'explicit_authorization')), /no answer for explicit_authorization/)
  })

  it('rejects a missing risk_class answer', () => {
    assert.throws(check((answers) => answers.filter((a) => a.name !== 'risk_class')), /no answer for risk_class/)
  })

  it('rejects a mistyped answer', () => {
    assert.throws(check((answers) => answers.map((a) => (a.name === 'exfiltration' ? { name: a.name, type: 'choice', choice: 'low', confidence: 1 } : a))), /expected a predicate answer/)
    assert.throws(check((answers) => answers.map((a) => (a.name === 'risk_class' ? { name: a.name, type: 'predicate', probability: 0 } : a))), /expected a choice answer/)
  })

  it('rejects an unknown risk class', () => {
    assert.throws(check((answers) => answers.map((a) => (a.name === 'risk_class' ? { ...a, choice: 'catastrophic' } : a))), /unknown choice/)
  })

  it('rejects out-of-range or missing numbers', () => {
    assert.throws(check((answers) => answers.map((a) => (a.name === 'exfiltration' ? { ...a, probability: 1.5 } : a))), /probability must be a number/)
    assert.throws(check((answers) => answers.map((a) => (a.name === 'exfiltration' ? { ...a, probability: '0.1' } : a))), /probability must be a number/)
    assert.throws(check((answers) => answers.map((a) => (a.name === 'risk_class' ? { name: a.name, type: 'choice', choice: 'low' } : a))), /confidence must be a number/)
  })

  it('rejects a duplicated answer', () => {
    assert.throws(check((answers) => [...answers, answers[1]]), /twice/)
  })

  it('requires the operator_rule answer only when rules exist, and checks its choice', () => {
    assert.throws(() => validateAnswers({ answers: makeAnswers() }, RULES), /no answer for operator_rule/)
    assert.throws(check((answers) => answers.map((a) => (a.name === 'operator_rule' ? { ...a, choice: 'r7' } : a)), RULES), /unknown choice/)
    assert.doesNotThrow(check((answers) => answers.map((a) => (a.name === 'operator_rule' ? { ...a, choice: 'r0' } : a)), RULES))
  })
})
