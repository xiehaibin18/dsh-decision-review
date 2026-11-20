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
  /** Hold a review until the host actually enters `approval/request` for this call. */
  stage(sessionId: string, review: PendingReview): void
  /** Publish a previously staged review while `approval/request` is awaiting a decision. */
  activate(sessionId: string, callId: string): void
  /** Remove both staged and active entries for one tool call. */
  clear(sessionId: string, callId: string): void
  /** Read the currently active (awaiting-approval) review for one tool call, if any. */
  get(sessionId: string, callId: string): PendingReview | null
  clearAll(): void
}

function putEntry(bySession: Map<string, Map<string, PendingReview>>, sessionKey: string, review: PendingReview): void {
  let calls = bySession.get(sessionKey)
  if (!calls) {
    calls = new Map()
    bySession.set(sessionKey, calls)
  }
  calls.set(review.callId, review)
}

function deleteEntry(bySession: Map<string, Map<string, PendingReview>>, sessionKey: string, callId: string): void {
  const calls = bySession.get(sessionKey)
  if (!calls) return
  calls.delete(callId)
  if (calls.size === 0) bySession.delete(sessionKey)
}

/** Instance-owned in-memory store separating staged reviews from active approval waits. */
export function createPendingReviewStore(): PendingReviewStore {
  const stagedBySession = new Map<string, Map<string, PendingReview>>()
  const activeBySession = new Map<string, Map<string, PendingReview>>()

  return {
    stage(sessionId, review) {
      const key = normalizeSessionId(sessionId)
      deleteEntry(activeBySession, key, review.callId)
      putEntry(stagedBySession, key, review)
    },
    activate(sessionId, callId) {
      const key = normalizeSessionId(sessionId)
      const id = String(callId)
      const staged = stagedBySession.get(key)?.get(id)
      if (!staged) return
      deleteEntry(stagedBySession, key, id)
      putEntry(activeBySession, key, staged)
    },
    clear(sessionId, callId) {
      const key = normalizeSessionId(sessionId)
      const id = String(callId)
      deleteEntry(stagedBySession, key, id)
      deleteEntry(activeBySession, key, id)
    },
    get(sessionId, callId) {
      return activeBySession.get(normalizeSessionId(sessionId))?.get(String(callId)) ?? null
    },
    clearAll() {
      stagedBySession.clear()
      activeBySession.clear()
    },
  }
}
