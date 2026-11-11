/** Settings and JSON messages exchanged between the plugin host and its configuration UI. */

export const API_BASE = '/api/decision-review'
export const RULE_VERDICTS = ['allow', 'allow_if_requested', 'ask', 'deny'] as const
export const RULE_MAX_COUNT = 20
export const RULE_MAX_CONDITION = 400
export const RULE_MAX_TOTAL = 2000
export const THRESHOLDS = ['tConf', 'tHighPred', 'tMedPred', 'tStrongPred', 'tAuth'] as const
export const TEST_SCENARIO_NAMES = ['allow', 'exfil', 'install'] as const

export type ReviewEngine = 'decisions' | 'session'
export type DenialRoute = 'ask' | 'final'
export type RuleVerdict = (typeof RULE_VERDICTS)[number]
export type Threshold = (typeof THRESHOLDS)[number]
export type TestScenarioName = (typeof TEST_SCENARIO_NAMES)[number]
export type Risk = 'low' | 'medium' | 'high'

export interface OperatorRule {
  condition: string
  verdict: RuleVerdict
}

export interface ReviewSettings extends Record<Threshold, number> {
  engine: ReviewEngine
  endpoint: string
  model: string
  timeoutMs: number
  denialRoute: DenialRoute
  rules: OperatorRule[]
}

export interface PublicSettings extends ReviewSettings {
  hasApiKey: boolean
}

export type SettingsUpdate = Partial<Omit<ReviewSettings, Threshold | 'timeoutMs'>> &
  Partial<Record<Threshold | 'timeoutMs', number | string>> & {
    apiKey?: string
    clearApiKey?: boolean
  }

export interface ReviewRuntime {
  engine: ReviewEngine
  accepting: boolean
  active: number
  paused: boolean
}

export interface ConfigResponse {
  settings: PublicSettings
  problems: string[]
  runtime: ReviewRuntime
}

export interface SaveResponse {
  ok: true
  settings: PublicSettings
  problems: string[]
}

export interface ReviewStats {
  reviewed: number
  autoAllowed: number
  asked: number
  finalDenied: number
  failed: number
  approvals: { asked: number; allowed: number; rejected: number; cancelled: number; unavailable: number }
  passRate: number | null
}

export type MediumRiskPredicate = 'irreversible_deletion' | 'production_effect' | 'security_change'
export type PredicateName = MediumRiskPredicate | 'exfiltration' | 'session_created_cleanup' | 'explicit_authorization'

export type RuleExplanation<Code extends string> = { code: Code; rule: number; condition: string }

export type DenialExplanation =
  | { code: 'refused_class' }
  | { code: 'exfiltration'; value: number; threshold: number }
  | { code: 'low_confidence'; value: number; threshold: number }
  | { code: 'authorized_low_confidence'; value: number; threshold: number }
  | { code: 'high_class'; confidence: number }
  | { code: 'conflict'; confidence: number; pred: MediumRiskPredicate | 'none'; value: number }
  | {
      code: 'authorization'
      value: number | null
      threshold: number
      pred: MediumRiskPredicate | 'none'
      predValue: number
    }
  | { code: 'refused_predicate'; predicates: string[] }
  | RuleExplanation<'rule_ask'>
  | RuleExplanation<'rule_deny'>
  | (RuleExplanation<'rule_unrequested'> & { value: number | null; threshold: number })
  | { code: 'session_denied'; risk: 'medium' | 'high'; reason?: string }
  | { code: 'settings_invalid'; problems: string[] }

export type ReviewDecision =
  | { risk: 'low' | 'medium'; decision: 'allow'; reason?: string; why?: RuleExplanation<'rule_allow'> }
  | {
      risk: Risk
      decision: 'deny'
      reason: string
      why: DenialExplanation
      hardDeny?: { rule: number; condition: string }
      final?: true
    }

export type TestAnswer = { choice: unknown; confidence: unknown } | { probability: unknown } | { refusal: true }

export type TestResult =
  | {
      scenario: TestScenarioName
      ok: true
      ms: number
      answers: Record<string, TestAnswer>
      composed: ReviewDecision & { display?: { en: string; zh: string } }
      usage?: unknown
    }
  | { scenario: TestScenarioName; ok: false; ms: number; error: string }

export interface TestResponse {
  ok: true
  results: TestResult[]
}
