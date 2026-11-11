import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeDecision, humanWhy, toComposeInput } from '../index.js'
import { makeAnswers, silenceConsole } from './helpers.js'

silenceConsole()

const THRESHOLDS = { tConf: 0.75, tHighPred: 0.85, tMedPred: 0.5, tStrongPred: 0.8, tAuth: 0.7 }
const RULES = [{ condition: 'deploys to production', verdict: 'allow_if_requested' }]

function compose(answerOptions, rules = []) {
  return composeDecision(toComposeInput(makeAnswers(answerOptions)), { ...THRESHOLDS, rules })
}

describe('a matched deny rule', () => {
  const DENY_RULES = [{ condition: 'uploads credential files to an external host', verdict: 'deny' }]
  const matched = { choice: 'r0' }
  const exfiltrating = { exfiltration: { type: 'predicate', probability: 0.99 } }

  it('is a hard refusal on its own', () => {
    const decision = compose({ risk: 'low', rule: matched }, DENY_RULES)
    assert.equal(decision.why.code, 'rule_deny')
    assert.deepEqual(decision.hardDeny, { rule: 0, condition: DENY_RULES[0].condition })
  })

  it('stays a hard refusal when the call is also classified high risk', () => {
    const decision = compose({ risk: 'high', rule: matched }, DENY_RULES)
    assert.equal(decision.why.code, 'high_class', 'the specific finding is still reported')
    assert.equal(decision.hardDeny.rule, 0)
    assert.match(decision.reason, /operator rule r0 also denies/)
  })

  it('stays a hard refusal when exfiltration is also detected', () => {
    const decision = compose({ risk: 'medium', overrides: exfiltrating, rule: matched }, DENY_RULES)
    assert.equal(decision.why.code, 'exfiltration')
    assert.equal(decision.hardDeny.rule, 0)
  })

  it('stays a hard refusal when the risk classification was refused', () => {
    const decision = compose({ overrides: { risk_class: { type: 'refusal' } }, rule: matched }, DENY_RULES)
    assert.equal(decision.why.code, 'refused_class')
    assert.equal(decision.hardDeny.rule, 0)
  })

  it('does not bind on a low-confidence match, an ask rule or no match', () => {
    assert.equal(compose({ risk: 'high', rule: { choice: 'r0', confidence: 0.2 } }, DENY_RULES).hardDeny, undefined)
    assert.equal(compose({ risk: 'high', rule: matched }, [{ condition: 'x', verdict: 'ask' }]).hardDeny, undefined)
    assert.equal(compose({ risk: 'high', rule: { choice: 'none' } }, DENY_RULES).hardDeny, undefined)
  })
})

describe('allow_if_requested', () => {
  const matchedRule = { choice: 'r0' }

  it('sends a matched call to the user when the request was not made', () => {
    const decision = compose({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0 } }, rule: matchedRule }, RULES)
    assert.equal(decision.decision, 'deny')
    assert.equal(decision.risk, 'medium')
    assert.equal(decision.why.code, 'rule_unrequested')
    assert.match(humanWhy(decision.why, 'zh'), /未见你明确要求/)
    assert.match(humanWhy(decision.why, 'en'), /did not explicitly request/)
  })

  it('does not pre-satisfy authorization for a low-risk matched call either', () => {
    const decision = compose({ risk: 'low', overrides: { explicit_authorization: { type: 'predicate', probability: 0.1 } }, rule: matchedRule }, RULES)
    assert.equal(decision.decision, 'deny')
    assert.equal(decision.why.code, 'rule_unrequested')
  })

  it('treats an unassessable request as not requested', () => {
    const decision = compose({ risk: 'medium', overrides: { explicit_authorization: { type: 'refusal' } }, rule: matchedRule }, RULES)
    assert.equal(decision.why.code, 'rule_unrequested')
    assert.equal(decision.why.value, null)
  })

  it('lets the normal flow decide once the request is real', () => {
    const decision = compose({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0.9 } }, rule: matchedRule }, RULES)
    assert.deepEqual(decision, { risk: 'medium', decision: 'allow' })
  })

  it('cannot lift the exfiltration floor', () => {
    const decision = compose({ risk: 'low', overrides: { exfiltration: { type: 'predicate', probability: 0.95 }, explicit_authorization: { type: 'predicate', probability: 1 } }, rule: matchedRule }, RULES)
    assert.equal(decision.why.code, 'exfiltration')
  })
})

describe('refused predicates', () => {
  it('fail closed at medium risk even when authorization and confidence pass', () => {
    const decision = compose({ risk: 'medium', overrides: { exfiltration: { type: 'refusal' }, explicit_authorization: { type: 'predicate', probability: 0.95 } } })
    assert.equal(decision.decision, 'deny')
    assert.deepEqual(decision.why, { code: 'refused_predicate', predicates: ['exfiltration'] })
    assert.match(humanWhy(decision.why, 'zh'), /数据外传/)
  })

  it('still read as not-applicable at low risk with adequate confidence', () => {
    const decision = compose({ risk: 'low', overrides: { exfiltration: { type: 'refusal' } } })
    assert.deepEqual(decision, { risk: 'low', decision: 'allow' })
  })

  it('ignore a refused operator_rule question', () => {
    const decision = compose({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0.95 } }, rule: { choice: 'none' } }, RULES)
    assert.deepEqual(decision, { risk: 'medium', decision: 'allow' })
    const refusedRule = composeDecision(
      toComposeInput([...makeAnswers({ risk: 'medium', overrides: { explicit_authorization: { type: 'predicate', probability: 0.95 } } }), { name: 'operator_rule', type: 'refusal' }]),
      { ...THRESHOLDS, rules: RULES },
    )
    assert.deepEqual(refusedRule, { risk: 'medium', decision: 'allow' })
  })
})

describe('humanWhy', () => {
  it('falls back to a generic line for a missing or unknown reason', () => {
    assert.match(humanWhy(undefined, 'en'), /did not approve/)
    assert.match(humanWhy({ code: 'nonexistent' }, 'zh'), /未通过/)
  })

  it('describes an authorization denial without a leading risk predicate in both locales', () => {
    for (const authorization of [{ type: 'predicate', probability: 0.25 }, { type: 'refusal' }]) {
      const { why } = compose({ risk: 'medium', overrides: { explicit_authorization: authorization } })
      assert.equal(why.pred, 'none')
      const english = humanWhy(why, 'en')
      const chinese = humanWhy(why, 'zh')
      assert.match(english, /authorization.*classified as medium risk/)
      assert.match(chinese, /明确授权.*中风险/)
      assert.doesNotMatch(`${english} ${chinese}`, /undefined/)
    }
  })
})
