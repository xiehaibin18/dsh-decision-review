import { createHash } from 'node:crypto'

// Decisions writes at most the latest four explicit breakpoints. Offer a fresh
// tail and use the remaining slots for previously submitted matching prefixes.
const LIMIT = 4
const PROMOTION_GROWTH = 8
const PROBE_ATTEMPTS = 2
const PROBE_SEND_LIMIT = 3
const PROBE_MAX_IDLE_MS = 10 * 60_000

interface Boundary {
  index: number
  digest: string
  order: number
  submittedAt: number
}

type Part = { text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }

/** Owned by one plugin instance, session and settings generation. Retain only
 * fixed-size fingerprints, never the transcript or credentials. */
export class DecisionBreakpoints {
  private completed: Boundary[] = []
  private pending: Boundary[] = []
  private sequence = 0
  private lastSuccessfulOrder = 0
  private established?: Boundary
  private checkpoint?: { boundary: Boundary; successfulOffers: number }
  private trial?: {
    boundary: Boundary
    baseline: number
    attempts: number
    sent: number
    largestOfferedTail: number
    activeProbe?: number
  }
  private baseline = 0
  private growth = 0
  private largestTail = 0
  private lastSuccessAt = 0

  prepare(parts: Part[]) {
    const tail = parts.length - 1
    // Part zero is the environment, not a history boundary.
    const trial = this.trial
    const candidates = [...this.completed, ...this.pending]
    const comparable = [
      ...candidates,
      ...(this.checkpoint ? [this.checkpoint.boundary] : []),
      ...(trial ? [trial.boundary] : []),
    ]
    const hash = createHash('sha256')
    const matching: Boundary[] = []
    const order = ++this.sequence
    const submittedAt = Date.now()
    const digests = new Map<number, string>()
    const bytes: number[] = []
    let total = 0
    for (const [index, { text }] of parts.entries()) {
      total += Buffer.byteLength(text)
      bytes.push(total)
      if (tail < 1) continue
      // Length framing makes adjacent content blocks unambiguous.
      hash.update(String(text.length) + ':').update(text)
      if (index !== tail && !comparable.some((entry) => entry.index === index)) continue
      const digest = hash.copy().digest('hex')
      digests.set(index, digest)
      if (index === tail || comparable.some((entry) => entry.index === index && entry.digest === digest)) {
        matching.push({ index, digest, order, submittedAt })
      }
    }
    // Keep the anchor as the control and hold a newer candidate across a
    // controlled trial, or until its prefix changes. Fill remaining slots from the longest matching prefixes.
    const anchor = matching.find((entry) => entry.digest === this.established?.digest)
    const checkpoint = anchor && matching.find((entry) => entry.digest === this.checkpoint?.boundary.digest)
    const challenger = checkpoint && matching.find((entry) => entry.digest === trial?.boundary.digest)
    // Validate C without B immediately preceding it. Only an unsent longer
    // tail can accompany the probe, so it cannot itself explain a cache hit.
    const idleMs = this.lastSuccessAt ? submittedAt - this.lastSuccessAt : null
    const probe = Boolean(
      challenger &&
      trial &&
      trial.activeProbe === undefined &&
      trial.sent < PROBE_SEND_LIMIT &&
      idleMs !== null &&
      idleMs <= PROBE_MAX_IDLE_MS &&
      tail > trial.largestOfferedTail &&
      tail > challenger.index &&
      tail > this.largestTail &&
      !candidates.some((entry) => entry.index === tail && entry.digest === digests.get(tail)),
    )
    const fallback = anchor ?? matching.findLast((entry) => this.completed.some((old) => old.digest === entry.digest))
    const reserved = new Set([fallback, checkpoint, challenger].filter((entry) => entry !== undefined))
    const rolling = matching.filter((entry) => !reserved.has(entry)).slice(-(LIMIT - reserved.size))
    const selected = probe
      ? matching.filter((entry) => entry === anchor || entry === challenger || entry.index === tail)
      : [...reserved, ...rolling].sort((a, b) => a.index - b.index)
    for (const { index } of selected) parts[index].prompt_cache_breakpoint = { mode: 'explicit' }

    if (trial) {
      trial.largestOfferedTail = Math.max(trial.largestOfferedTail, tail)
      if (probe) {
        trial.activeProbe = order
        trial.sent++
      }
    }
    const proposed = selected[selected.length - 1]
    if (proposed) this.pending = [...this.pending, proposed].slice(-LIMIT)
    return {
      metadata: {
        order,
        policy: 'anchor-sparse-secondary-probe',
        phase: probe ? 'probe' : trial ? 'trial-hold' : 'steady',
        idleMs,
        challengerBlock: challenger?.index ?? null,
        probeBaselineTokens: trial?.baseline ?? null,
        probeSent: trial?.sent ?? null,
        probeAttempts: trial?.attempts ?? null,
        settledGrowthBeforeRequest: this.growth,
        anchorBlock: anchor?.index ?? null,
        checkpointBlock: checkpoint?.index ?? null,
        checkpointSuccessfulOffers: checkpoint ? this.checkpoint?.successfulOffers : null,
        historyBlocks: Math.max(0, tail),
        sharedTextBytes: total,
        candidates: candidates.map(({ index, order: priorOrder, digest, submittedAt: priorAt }, i) => ({
          block: index,
          order: priorOrder,
          ageMs: submittedAt - priorAt,
          state: i < this.completed.length ? 'settled' : 'in-flight',
          comparison: index > tail ? 'past-tail' : digest === digests.get(index) ? 'match' : 'prefix-changed',
        })),
        markers: selected.map(({ index }) => ({
          block: index,
          textBytes: bytes[index],
          tail: index === tail,
        })),
      },
      settle: (success: boolean, positiveWrite = false, readTokens: number | null = null) => {
        this.pending = this.pending.filter((entry) => entry !== proposed)
        if (trial?.activeProbe === order) delete trial.activeProbe
        if (!success || order <= this.lastSuccessfulOrder) {
          // A failed or superseded request may still have reached the backend.
          // Bound sends independently; never use its telemetry for promotion.
          if (probe && trial && this.trial === trial && trial.sent >= PROBE_SEND_LIMIT) {
            this.trial = undefined
            this.growth = 0
            return { transition: 'probe-budget-exhausted' }
          }
          return
        }
        // Success means these were offered, not necessarily written. Only the
        // newest successful submission may replace the current prefix set.
        // In particular, a late response cannot revive a rewritten anchor.
        this.lastSuccessfulOrder = order
        this.lastSuccessAt = Date.now()
        this.completed = selected
        // A positive aggregate write is evidence of cache activity, not
        // proof of an individual marker write unless this marker stood alone.
        // With no observed write, keep rolling rather than pinning tiny input.
        const stillOffered = selected.find((entry) => entry.digest === this.established?.digest)
        this.established = stillOffered ?? (positiveWrite ? proposed : undefined)
        const currentCheckpoint = this.checkpoint
        const anchorIndex = this.established?.index
        // A probe deliberately omits B; exact matching still protects it in
        // memory so rollback can restore it without reusing a changed prefix.
        const kept = matching.find(
          (entry) =>
            anchorIndex !== undefined &&
            entry.index > anchorIndex &&
            entry.digest === currentCheckpoint?.boundary.digest &&
            (probe || selected.includes(entry)),
        )
        const successfulOffers = kept && currentCheckpoint ? currentCheckpoint.successfulOffers + (probe ? 0 : 1) : 0
        this.checkpoint = kept ? { boundary: kept, successfulOffers } : undefined
        const grew = Boolean(proposed && proposed.index > this.largestTail)
        this.largestTail = kept ? Math.max(this.largestTail, proposed?.index ?? 0) : (proposed?.index ?? 0)
        let transition = 'none'
        if (!kept) {
          this.baseline = 0
          this.growth = 0
          this.trial = undefined
          if (positiveWrite && this.established && proposed && proposed.index > this.established.index) {
            this.checkpoint = { boundary: proposed, successfulOffers: 0 }
            transition = 'establish-secondary'
          } else if (currentCheckpoint) transition = 'reset'
        } else if (probe && trial && this.trial === trial && challenger) {
          if (readTokens !== null && readTokens > trial.baseline) {
            this.checkpoint = { boundary: challenger, successfulOffers: 1 }
            this.baseline = readTokens
            this.growth = 0
            this.trial = undefined
            transition = 'promote'
          } else if (trial.attempts + 1 >= PROBE_ATTEMPTS || trial.sent >= PROBE_SEND_LIMIT) {
            this.growth = 0
            this.trial = undefined
            transition = trial.attempts + 1 >= PROBE_ATTEMPTS ? 'rollback' : 'probe-budget-exhausted'
          } else {
            trial.attempts++
            transition = 'probe-no-uplift'
          }
        } else if (this.trial && !matching.some((entry) => entry.digest === this.trial?.boundary.digest)) {
          this.trial = undefined
          this.growth = 0
          transition = 'challenger-invalidated'
        } else if (!this.trial && !trial) {
          if (grew) this.growth = Math.min(this.growth + 1, PROMOTION_GROWTH)
          this.baseline = Math.max(this.baseline, readTokens ?? 0)
          if (
            this.growth >= PROMOTION_GROWTH &&
            this.baseline > 0 &&
            grew &&
            positiveWrite &&
            proposed &&
            proposed.index > kept.index
          ) {
            this.trial = {
              boundary: proposed,
              baseline: this.baseline,
              attempts: 0,
              sent: 0,
              largestOfferedTail: proposed.index,
            }
            transition = 'stage'
          }
        }
        return {
          transition,
          settledAnchorBlock: this.established?.index ?? null,
          settledCheckpointBlock: this.checkpoint?.boundary.index ?? null,
          settledCheckpointSuccessfulOffers: this.checkpoint?.successfulOffers ?? null,
        }
      },
    }
  }
}
