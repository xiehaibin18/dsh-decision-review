import fs from 'node:fs'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ReviewDecision, ReviewEngine, ReviewStats } from '../shared/contracts.js'
import { isRecord } from './json.js'

export type ReviewRoute = 'allow' | 'ask' | 'final' | 'fail'

type TrailEntry =
  | {
      event: 'review'
      session: string
      route: ReviewRoute
      engine?: ReviewEngine
      tool?: string
      callId?: string
      ms?: number
      decision?: ReviewDecision
      answers?: unknown
      usage?: unknown
      downstream?: string
      error?: string
    }
  | {
      event: 'approval'
      session: string
      tool?: string
      callId?: string
      outcome: ApprovalOutcome
    }

type SessionBucket = Omit<ReviewStats, 'passRate'>

const LOG_FILE = 'decision-review.log.jsonl'
const LOG_ROTATE_BYTES = 8 * 1024 * 1024

function newSessionBucket(): SessionBucket {
  return {
    reviewed: 0,
    autoAllowed: 0,
    asked: 0,
    finalDenied: 0,
    failed: 0,
    approvals: { asked: 0, allowed: 0, rejected: 0, cancelled: 0, unavailable: 0 },
  }
}

/** Profile-local JSONL trail of review and approval records, plus the
 * per-session fold served to the composer dock chip.
 *
 * record() appends one line; the file rotates at 8 MB keeping one predecessor,
 * and telemetry must never break or delay a review. stats() folds the
 * predecessor and the live file (so a rotation does not zero the counts of
 * sessions whose records sit in the predecessor), cached by both files'
 * identity so dock polling stays cheap. passRate is the reviewer's own
 * auto-pass share over reviewed calls — asks, final denials, and reviewer
 * failures count against it, while the human's allowed-once answers never do.
 * Session ids normalize to bare uuids: clients pass `session-<uuid>`, trails
 * store the bare form. */
export function createReviewTrail(profileDirectory: string) {
  const path = `${profileDirectory}/${LOG_FILE}`
  const predecessor = `${path}.1`
  let cache = { signature: '', fold: new Map<string, SessionBucket>() }

  function record(entry: TrailEntry): void {
    try {
      if (fs.existsSync(path) && fs.statSync(path).size > LOG_ROTATE_BYTES) fs.renameSync(path, predecessor)
      fs.appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 })
    } catch {
      /* telemetry is best-effort */
    }
  }

  function fileSignature(file: string): string {
    try {
      const stat = fs.statSync(file)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return 'absent'
    }
  }

  function foldFile(file: string, fold: Map<string, SessionBucket>): void {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    for (const line of text.split('\n')) {
      if (!line) continue
      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue // a torn tail line from a crash must not break the fold
      }
      if (!isRecord(entry) || typeof entry.session !== 'string') continue
      const key = entry.session.replace(/^session-/, '')
      const bucket = fold.get(key) ?? newSessionBucket()
      if (entry.event === 'review') {
        bucket.reviewed += 1
        if (entry.route === 'allow') bucket.autoAllowed += 1
        else if (entry.route === 'ask') bucket.asked += 1
        else if (entry.route === 'final') bucket.finalDenied += 1
        else if (entry.route === 'fail') bucket.failed += 1
      } else if (entry.event === 'approval') {
        bucket.approvals.asked += 1
        if (entry.outcome === 'allowed-once') bucket.approvals.allowed += 1
        else if (entry.outcome === 'rejected') bucket.approvals.rejected += 1
        else if (entry.outcome === 'cancelled') bucket.approvals.cancelled += 1
        else bucket.approvals.unavailable += 1
      } else continue
      fold.set(key, bucket)
    }
  }

  function stats(rawSessionId: string): ReviewStats {
    const sessionId = String(rawSessionId).replace(/^session-/, '')
    const signature = `${fileSignature(predecessor)}|${fileSignature(path)}`
    if (signature !== cache.signature) {
      const fold = new Map<string, SessionBucket>()
      foldFile(predecessor, fold)
      foldFile(path, fold)
      cache = { signature, fold }
    }
    const bucket = cache.fold.get(sessionId) ?? newSessionBucket()
    const passRate = bucket.reviewed > 0 ? Math.round((100 * bucket.autoAllowed) / bucket.reviewed) : null
    return { ...bucket, passRate }
  }

  return { record, stats }
}
