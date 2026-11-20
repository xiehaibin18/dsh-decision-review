import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { PendingDecisionScores, PendingReview, PredicateName, ReviewDecision, Risk } from '../shared/contracts.js'
import { isRecord } from './json.js'
import { localizedWhy, summarizePendingAction } from './review-outcome.js'
import type { Settings } from './settings.js'

type DeniedReview = Extract<ReviewDecision, { decision: 'deny' }>

const PREDICATE_NAMES: readonly PredicateName[] = [
  'exfiltration',
  'irreversible_deletion',
  'production_effect',
  'security_change',
  'session_created_cleanup',
  'explicit_authorization',
]

function normalizeSessionId(sessionId: string): string {
  return String(sessionId).replace(/^session-/, '')
}

function isRisk(value: unknown): value is Risk {
  return value === 'low' || value === 'medium' || value === 'high'
}

export function extractDecisionScores(answers: unknown, settings: Settings): PendingDecisionScores | null {
  if (!Array.isArray(answers)) return null
  const byName = new Map<string, Record<string, unknown>>()
  const refused: string[] = []
  for (const item of answers) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.type !== 'string') continue
    byName.set(item.name, item)
    if (item.type === 'refusal' && item.name !== 'operator_rule') refused.push(item.name)
  }
  const riskEntry = byName.get('risk_class')
  const riskClass =
    riskEntry?.type === 'choice' && isRisk(riskEntry.choice) && typeof riskEntry.confidence === 'number'
      ? { choice: riskEntry.choice, confidence: riskEntry.confidence }
      : null
  const predicates = Object.fromEntries(
    PREDICATE_NAMES.map((name) => {
      const entry = byName.get(name)
      const value = entry?.type === 'predicate' && typeof entry.probability === 'number' ? entry.probability : null
      return [name, value]
    }),
  ) as Record<PredicateName, number | null>
  return {
    riskClass,
    predicates,
    refused,
    thresholds: {
      tConf: settings.tConf,
      tHighPred: settings.tHighPred,
      tMedPred: settings.tMedPred,
      tStrongPred: settings.tStrongPred,
      tAuth: settings.tAuth,
    },
  }
}

export function buildPendingReview(
  exec: ToolExecution,
  decision: DeniedReview,
  answers: unknown,
  settings: Settings,
): PendingReview {
  return {
    callId: String(exec.callId),
    tool: exec.name,
    isPtcInner: exec.parent !== undefined,
    engine: settings.engine,
    risk: decision.risk,
    why: decision.why,
    display: {
      en: localizedWhy(decision.why, 'en'),
      zh: localizedWhy(decision.why, 'zh'),
    },
    action: summarizePendingAction(exec),
    scores: settings.engine === 'decisions' ? extractDecisionScores(answers, settings) : null,
    createdAt: Date.now(),
  }
}

export interface PendingReviewStore {
  set(sessionId: string, review: PendingReview): void
  clear(sessionId: string, callId?: string): void
  get(sessionId: string, callId: string): PendingReview | null
  clearAll(): void
}

/** Instance-owned in-memory store of currently pending human-approval reviews, keyed by (session, callId). */
export function createPendingReviewStore(): PendingReviewStore {
  const bySession = new Map<string, Map<string, PendingReview>>()

  return {
    set(sessionId, review) {
      const key = normalizeSessionId(sessionId)
      let calls = bySession.get(key)
      if (!calls) {
        calls = new Map()
        bySession.set(key, calls)
      }
      calls.set(review.callId, review)
    },
    clear(sessionId, callId) {
      const key = normalizeSessionId(sessionId)
      if (callId === undefined) {
        bySession.delete(key)
        return
      }
      const calls = bySession.get(key)
      if (!calls) return
      calls.delete(String(callId))
      if (calls.size === 0) bySession.delete(key)
    },
    get(sessionId, callId) {
      return bySession.get(normalizeSessionId(sessionId))?.get(String(callId)) ?? null
    },
    clearAll() {
      bySession.clear()
    },
  }
}
