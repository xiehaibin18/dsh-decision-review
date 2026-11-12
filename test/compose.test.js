import { describe, expect, spyOn, test } from 'bun:test'
import { composeDecision, humanWhy, toComposeInput } from '../dist/index.js'
import { makeAnswers } from './fixtures.js'

const THRESHOLDS = { tConf: 0.75, tHighPred: 0.85, tMedPred: 0.5, tStrongPred: 0.8, tAuth: 0.7 }
const RULES = [{ condition: 'deploys to production', verdict: 'allow_if_requested' }]

function compose(answerOptions, rules = []) {
  return composeDecision(toComposeInput(makeAnswers(answerOptions)), { ...THRESHOLDS, rules })
}

describe('a matched deny rule', () => {
  const DENY_RULES = [{ condition: 'uploads credential files to an external host', verdict: 'deny' }]
  const matched = { choice: 'r0' }

  test('is a hard refusal on its own', () => {
    const decision = compose({ risk: 'low', rule: matched }, DENY_RULES)
    expect(decision.why.code).toBe('rule_deny')
    expect(decision.hardDeny).toStrictEqual({ rule: 0, condition: DENY_RULES[0].condition })
  })

  test.each([
    ['a high risk classification', { risk: 'high' }, 'high_class'],
    [
      'detected exfiltration',
      { risk: 'medium', overrides: { exfiltration: { type: 'predicate', probability: 0.99 } } },
      'exfiltration',
    ],
    ['a refused risk classification', { overrides: { risk_class: { type: 'refusal' } } }, 'refused_class'],
  ])('stays a hard refusal alongside %s', (_scenario, answers, why) => {
    const decision = compose({ ...answers, rule: matched }, DENY_RULES)
    expect(decision.why.code).toBe(why)
    expect(decision.hardDeny.rule).toBe(0)
    expect(decision.reason).toMatch(/operator rule r0 also denies/)
  })

  test.each([
    ['a low-confidence match', { choice: 'r0', confidence: 0.2 }, DENY_RULES],
    ['an ask rule', matched, [{ condition: 'x', verdict: 'ask' }]],
    ['no match', { choice: 'none' }, DENY_RULES],
  ])('does not bind for %s', (_scenario, rule, rules) => {
    expect(compose({ risk: 'high', rule }, rules).hardDeny).toBeUndefined()
  })
})

test('does not apply an allow rule when numeric-string confidence is below the threshold', () => {
  const rules = [{ condition: 'deploys to production', verdict: 'allow' }]
  const decision = compose({ risk: 'medium', rule: { choice: 'r0', confidence: '0.1' } }, rules)
  expect(decision).toMatchObject({ decision: 'deny', why: { code: 'authorization' } })
})

describe('allow_if_requested', () => {
  const matchedRule = { choice: 'r0' }
  const unrequested = { zh: /未见你明确要求/, en: /did not explicitly request/ }
  const unassessable = { zh: /无法评估你是否明确要求/, en: /could not be assessed/ }

  test.each([
    ['no authorization at medium risk', 'medium', { type: 'predicate', probability: 0 }, 0, unrequested],
    ['weak authorization at low risk', 'low', { type: 'predicate', probability: 0.1 }, 0.1, unrequested],
    ['a refused authorization assessment', 'medium', { type: 'refusal' }, null, unassessable],
  ])('sends the call to the user with %s', (_scenario, risk, authorization, value, message) => {
    const decision = compose({ risk, overrides: { explicit_authorization: authorization }, rule: matchedRule }, RULES)
    expect(decision).toMatchObject({ risk: 'medium', decision: 'deny', why: { code: 'rule_unrequested', value } })
    expect(humanWhy(decision.why, 'zh')).toMatch(message.zh)
    expect(humanWhy(decision.why, 'en')).toMatch(message.en)
  })

  test.each([
    ['at the threshold', 0.7],
    ['above the threshold', 0.9],
  ])('lets the normal flow decide with authorization %s', (_scenario, probability) => {
    const decision = compose(
      {
        risk: 'medium',
        overrides: { explicit_authorization: { type: 'predicate', probability } },
        rule: matchedRule,
      },
      RULES,
    )
    expect(decision).toStrictEqual({ risk: 'medium', decision: 'allow' })
  })

  test('cannot lift the exfiltration floor', () => {
    const decision = compose(
      {
        risk: 'low',
        overrides: {
          exfiltration: { type: 'predicate', probability: 0.95 },
          explicit_authorization: { type: 'predicate', probability: 1 },
        },
        rule: matchedRule,
      },
      RULES,
    )
    expect(decision.why.code).toBe('exfiltration')
  })
})

describe('refused predicates', () => {
  test('fail closed at medium risk even when authorization and confidence pass', () => {
    const decision = compose({
      risk: 'medium',
      overrides: {
        exfiltration: { type: 'refusal' },
        explicit_authorization: { type: 'predicate', probability: 0.95 },
      },
    })
    expect(decision.decision).toBe('deny')
    expect(decision.why).toStrictEqual({ code: 'refused_predicate', predicates: ['exfiltration'] })
    expect(humanWhy(decision.why, 'zh')).toMatch(/数据外传/)
  })

  test('still read as not-applicable at low risk with adequate confidence', () => {
    const info = spyOn(console, 'info').mockImplementation(() => {})
    try {
      const decision = compose({ risk: 'low', overrides: { exfiltration: { type: 'refusal' } } })
      expect(decision).toStrictEqual({ risk: 'low', decision: 'allow' })
    } finally {
      info.mockRestore()
    }
  })

  test.each([
    ['no operator rule match', {}],
    ['a refused operator rule answer', { operator_rule: { type: 'refusal' } }],
  ])('allow an authorized call with %s', (_scenario, overrides) => {
    const decision = compose(
      {
        risk: 'medium',
        overrides: { explicit_authorization: { type: 'predicate', probability: 0.95 }, ...overrides },
        rule: { choice: 'none' },
      },
      RULES,
    )
    expect(decision).toStrictEqual({ risk: 'medium', decision: 'allow' })
  })
})

describe('humanWhy', () => {
  test.each([
    ['an omitted reason', undefined, 'en', /did not approve/],
    ['a null reason', null, 'en', /did not approve/],
    ['an unknown reason', { code: 'nonexistent' }, 'zh', /未通过/],
  ])('falls back to a generic line for %s', (_scenario, why, locale, message) => {
    expect(humanWhy(why, locale)).toMatch(message)
  })

  test.each([
    ['weak authorization', { type: 'predicate', probability: 0.25 }],
    ['a refused authorization assessment', { type: 'refusal' }],
  ])('describes an authorization denial from %s without a leading risk predicate', (_scenario, authorization) => {
    const { why } = compose({ risk: 'medium', overrides: { explicit_authorization: authorization } })
    expect(why.pred).toBe('none')
    const english = humanWhy(why, 'en')
    const chinese = humanWhy(why, 'zh')
    expect(english).toMatch(/authorization.*classified as medium risk/)
    expect(chinese).toMatch(/明确授权.*中风险/)
    expect(`${english} ${chinese}`).not.toContain('undefined')
  })
})
