import type { ReviewStats, TestResult, TestScenarioName } from '../src/shared/contracts.js'
import { localizedWhy } from '../src/server/review-outcome.js'
import { normalizeSettings, type StoredSettings, type Settings } from '../src/server/settings.js'
import { composeDecision, type ComposeInput } from '../src/server/verdict.js'
import type { SceneId } from './scenes.js'

export const MULTILINE_RULE = '  仅运行本地测试\n\n  npm test -- --runInBand\n保留缩进与末尾换行。\n'

export function fixtureSettings(scene: SceneId): StoredSettings {
  const problems: string[] = []
  const settings = normalizeSettings(
    {
      engine: scene === 'session' || scene === 'invalid' ? 'session' : 'decisions',
      endpoint: scene === 'invalid' ? 'not-a-url' : 'https://reviewer.example.invalid/v1/decisions',
      model: scene === 'invalid' ? '' : 'synthetic-reviewer',
      apiKey: 'synthetic-preview-key',
      rules: scene === 'multiline' ? [{ condition: MULTILINE_RULE, verdict: 'ask' }] : [],
    },
    { problems },
  )
  return { settings, problems, damaged: false }
}

export function fixtureStats(scene: SceneId): ReviewStats {
  return scene === 'stats-empty'
    ? {
        reviewed: 0,
        autoAllowed: 0,
        asked: 0,
        finalDenied: 0,
        failed: 0,
        approvals: { asked: 0, allowed: 0, rejected: 0, cancelled: 0, unavailable: 0 },
        passRate: null,
      }
    : {
        reviewed: 12,
        autoAllowed: 8,
        asked: 2,
        finalDenied: 1,
        failed: 1,
        approvals: { asked: 2, allowed: 1, rejected: 1, cancelled: 0, unavailable: 0 },
        passRate: 67,
      }
}

/** Fixed synthetic findings exercise the real deterministic composer; no provider is contacted. */
export function fixtureTest(settings: Settings, name: TestScenarioName, mixed: boolean): TestResult {
  if (mixed && name === 'install') return { scenario: name, ok: false, ms: 45, error: 'Synthetic reviewer timeout' }
  const input: ComposeInput = {
    risk_class: {
      choice: name === 'allow' ? 'low' : name === 'exfil' ? 'high' : 'medium',
      confidence: 0.98,
      probabilities: {},
    },
    exfiltration: name === 'exfil' ? 0.99 : 0.01,
    irreversible_deletion: 0.01,
    production_effect: 0.01,
    security_change: name === 'install' ? 0.9 : 0.01,
    session_created_cleanup: 0.01,
    explicit_authorization: 0.1,
    ruleMatch: null,
    refused: [],
  }
  const composed = composeDecision(input, settings)
  return {
    scenario: name,
    ok: true,
    ms: 42,
    answers: {
      risk_class: { choice: input.risk_class.choice, confidence: 0.98 },
      exfiltration: { probability: input.exfiltration },
      security_change: { probability: input.security_change },
      explicit_authorization: { probability: input.explicit_authorization },
    },
    composed:
      composed.decision === 'deny'
        ? { ...composed, display: { en: localizedWhy(composed.why, 'en'), zh: localizedWhy(composed.why, 'zh') } }
        : composed,
  }
}
