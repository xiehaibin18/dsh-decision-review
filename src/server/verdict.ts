import type {
  MediumRiskPredicate,
  OperatorRule,
  PredicateName,
  ReviewDecision,
  Risk,
  Threshold,
} from '../shared/contracts.js'

interface RiskClassification {
  choice: Risk
  confidence: number
  probabilities: Record<string, unknown>
}

export type ComposeInput = {
  ruleMatch: { value: unknown; confidence: unknown } | null
  refused: readonly string[]
} & ({ risk_class: null } | ({ risk_class: RiskClassification } & Record<PredicateName, number | null>))

type ComposeThresholds = Readonly<Record<Threshold, number>> & { rules?: readonly OperatorRule[] }
type StrongestPredicate = readonly [MediumRiskPredicate | 'none', number]

/**
 * Deterministic policy composition v0.5. Illegal combinations (high+allow)
 * are unrepresentable here by construction. Escalation rule v0.2 guards
 * against single-predicate over-generalization: a medium predicate escalates
 * on its own only at the strong threshold, otherwise it needs low choice
 * confidence as a second signal. A refused predicate composes as null (it
 * never escalates) and, at low risk with adequate confidence, reads as
 * "not applicable to this call"; at medium risk any refused predicate fails
 * closed. Each deny carries a structured `why`; it is the single source for
 * both the raw model-facing reason and the localized card copy.
 */
export function composeDecision(a: ComposeInput, t: ComposeThresholds): ReviewDecision {
  const matched = matchedRule(a, t)
  const decision = composeVerdict(a, t, matched)
  if (decision.decision !== 'deny' || matched === null || matched.rule.verdict !== 'deny') return decision
  // A matched `deny` rule is the operator's hard refusal. The risk floors in
  // composeVerdict may report a more specific reason first, but they must not
  // swallow the rule: `hardDeny` is a separate marker that the approval
  // routing reads, so no combination of findings can turn it into a card the
  // user could approve.
  const hardDeny = { rule: matched.index, condition: matched.condition }
  if (decision.why?.code === 'rule_deny') return { ...decision, hardDeny }
  return { ...decision, reason: `${decision.reason}; operator rule r${matched.index} also denies this call`, hardDeny }
}

/** The operator rule a confident `operator_rule` answer selects, or null. */
function matchedRule(a: ComposeInput, t: ComposeThresholds) {
  const match = a.ruleMatch
  if (!match || typeof match.value !== 'string' || match.value === 'none') return null
  const confidence = Number(match.confidence ?? 1)
  if (confidence < t.tConf) return null
  const index = Number(match.value.slice(1))
  const rule = Array.isArray(t.rules) ? t.rules[index] : undefined
  if (!rule) return null
  const condition = rule.condition.length > 120 ? `${rule.condition.slice(0, 120)}…` : rule.condition
  return { index, rule, condition }
}

function composeVerdict(
  a: ComposeInput,
  t: ComposeThresholds,
  matched: ReturnType<typeof matchedRule>,
): ReviewDecision {
  if (!a.risk_class) {
    return {
      risk: 'high',
      decision: 'deny',
      reason: 'reviewer refused the risk classification',
      why: { code: 'refused_class' },
    }
  }
  if (a.exfiltration !== null && a.exfiltration >= t.tHighPred) {
    return {
      risk: 'high',
      decision: 'deny',
      reason: `exfiltration=${a.exfiltration} >= ${t.tHighPred}`,
      why: { code: 'exfiltration', value: a.exfiltration, threshold: t.tHighPred },
    }
  }
  if (a.risk_class.choice === 'high') {
    return {
      risk: 'high',
      decision: 'deny',
      reason: `risk_class=high (confidence ${a.risk_class.confidence})`,
      why: { code: 'high_class', confidence: a.risk_class.confidence },
    }
  }
  // Operator rules: a confident operator_rule match applies the operator's
  // stored verdict deterministically. allow returns outright; allow_if_requested
  // requires the real explicit-authorization answer to pass (otherwise the
  // call goes to the user) and then falls through to the normal flow; ask and
  // deny return the operator's fixed verdicts. The exfiltration and
  // high-class floors above are not overridable by rules.
  if (matched !== null) {
    const { index, rule, condition } = matched
    if (rule.verdict === 'deny') {
      return {
        risk: 'high',
        decision: 'deny',
        reason: `operator rule r${index} denies this call`,
        why: { code: 'rule_deny', rule: index, condition },
      }
    }
    if (rule.verdict === 'ask') {
      return {
        risk: 'medium',
        decision: 'deny',
        reason: `operator rule r${index} requires user adjudication`,
        why: { code: 'rule_ask', rule: index, condition },
      }
    }
    if (rule.verdict === 'allow') {
      return {
        risk: 'low',
        decision: 'allow',
        reason: `operator rule r${index} authorizes this call`,
        why: { code: 'rule_allow', rule: index, condition },
      }
    }
    if (a.explicit_authorization === null || a.explicit_authorization < t.tAuth) {
      return {
        risk: 'medium',
        decision: 'deny',
        reason: `operator rule r${index} allows this call only when requested; explicit_authorization=${a.explicit_authorization} < ${t.tAuth}`,
        why: { code: 'rule_unrequested', rule: index, condition, value: a.explicit_authorization, threshold: t.tAuth },
      }
    }
  }
  const med: readonly MediumRiskPredicate[] = ['irreversible_deletion', 'production_effect', 'security_change']
  const strongest = med.reduce<StrongestPredicate>(
    (best, name) => {
      const value = a[name]
      return value !== null && value > best[1] ? [name, value] : best
    },
    ['none', 0],
  )
  const lowConfidence = a.risk_class.confidence < t.tConf
  const saysMedium = strongest[1] >= t.tStrongPred || (strongest[1] >= t.tMedPred && lowConfidence)
  if (a.risk_class.choice === 'low' && saysMedium) {
    return {
      risk: 'medium',
      decision: 'deny',
      reason: `unresolved conflict: risk_class=low (${a.risk_class.confidence}) vs ${strongest[0]}=${strongest[1]}`,
      why: { code: 'conflict', confidence: a.risk_class.confidence, pred: strongest[0], value: strongest[1] },
    }
  }
  const risk = a.risk_class.choice === 'medium' || saysMedium ? 'medium' : 'low'
  // The operator_rule question is a routing aid, not a predicate about the call.
  const refusedPredicates = (a.refused ?? []).filter((question) => question !== 'operator_rule')
  if (risk === 'low') {
    if (a.risk_class.confidence < t.tConf) {
      return {
        risk: 'low',
        decision: 'deny',
        reason: `low classification confidence ${a.risk_class.confidence} < ${t.tConf}`,
        why: { code: 'low_confidence', value: a.risk_class.confidence, threshold: t.tConf },
      }
    }
    // Refusal downgrade: at low risk with adequate confidence a refused
    // predicate means "not applicable to this call", not "unanswerable" —
    // calibrated on 15/15 user-approved refusal asks (2026-11-10). Medium and
    // high classes or low confidence still fail closed above; escalation
    // already ignores refused predicates because they compose as null.
    if (refusedPredicates.length > 0) {
      console.info(
        `[decision-review] refusal treated as not-applicable (low, conf ${a.risk_class.confidence}): ${refusedPredicates.join(', ')}`,
      )
    }
    return { risk: 'low', decision: 'allow' }
  }
  if (a.explicit_authorization === null || a.explicit_authorization < t.tAuth) {
    return {
      risk: 'medium',
      decision: 'deny',
      reason: `explicit_authorization=${a.explicit_authorization} < ${t.tAuth} (strongest ${strongest[0]}=${strongest[1]})`,
      why: {
        code: 'authorization',
        value: a.explicit_authorization,
        threshold: t.tAuth,
        pred: strongest[0],
        predValue: strongest[1],
      },
    }
  }
  if (refusedPredicates.length > 0) {
    return {
      risk: 'medium',
      decision: 'deny',
      reason: `reviewer refused to assess: ${refusedPredicates.join(', ')}`,
      why: { code: 'refused_predicate', predicates: refusedPredicates },
    }
  }
  if (a.risk_class.confidence < t.tConf) {
    return {
      risk: 'medium',
      decision: 'deny',
      reason: `authorized but classification confidence ${a.risk_class.confidence} < ${t.tConf}`,
      why: { code: 'authorized_low_confidence', value: a.risk_class.confidence, threshold: t.tConf },
    }
  }
  return { risk: 'medium', decision: 'allow' }
}
