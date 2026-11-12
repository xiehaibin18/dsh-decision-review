import {
  RULE_MAX_CONDITION,
  RULE_MAX_COUNT,
  RULE_MAX_TOTAL,
  RULE_VERDICTS,
  type OperatorRule,
  type RuleVerdict,
} from '../shared/contracts.js'

export type DraftRule<V extends string = string> = { id: number; condition: string; verdict: V }
export type RuleChanges = Partial<Omit<DraftRule, 'id'>>

export function ruleData<V extends string>(rules: DraftRule<V>[]) {
  return rules.map(({ condition, verdict }) => ({ condition, verdict }))
}

export function draftRules(
  rules: OperatorRule[],
  nextId: { current: number },
  previous: DraftRule[] = [],
): DraftRule<RuleVerdict>[] {
  return (rules ?? []).map(({ condition, verdict }, i) => ({
    id: previous[i]?.id ?? nextId.current++,
    condition,
    verdict,
  }))
}

export function conditionProblem(condition: string) {
  if (condition.length > RULE_MAX_CONDITION) return 'rules.error.long'
  if (condition.trim() === '') return 'rules.error.required'
  return null
}

export function isRuleVerdict(verdict: string): verdict is RuleVerdict {
  return RULE_VERDICTS.some((knownVerdict) => knownVerdict === verdict)
}

export function validateRules(rules: DraftRule[]) {
  const total = rules.reduce((sum, rule) => sum + rule.condition.length, 0)
  const countInvalid = rules.length > RULE_MAX_COUNT
  const totalInvalid = total > RULE_MAX_TOTAL
  const summary = { total, countInvalid, totalInvalid }
  if (
    !countInvalid &&
    !totalInvalid &&
    rules.every(
      (rule): rule is DraftRule<RuleVerdict> =>
        isRuleVerdict(rule.verdict) && conditionProblem(rule.condition) === null,
    )
  ) {
    return { ...summary, valid: true as const, rules }
  }
  return { ...summary, valid: false as const }
}
