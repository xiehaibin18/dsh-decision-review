import { createHash } from 'node:crypto'

// Decisions writes at most the latest four explicit breakpoints. Offer a fresh
// tail and use the remaining slots for previously submitted matching prefixes.
const LIMIT = 4

interface Boundary {
  index: number
  digest: string
  order: number
}

type Part = { text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }

/** Owned by one plugin instance, session and settings generation. Retain only
 * fixed-size fingerprints, never the transcript or credentials. */
export class DecisionBreakpoints {
  private completed: Boundary[] = []
  private pending: Boundary[] = []
  private sequence = 0

  prepare(parts: Part[]) {
    const tail = parts.length - 1
    // Part zero is the environment, not a history boundary.
    if (tail < 1) return undefined
    const candidates = [...this.completed, ...this.pending]
    const hash = createHash('sha256')
    const matching: Boundary[] = []
    const order = ++this.sequence
    for (const [index, { text }] of parts.entries()) {
      // Length framing makes adjacent content blocks unambiguous.
      hash.update(String(text.length) + ':').update(text)
      if (index !== tail && !candidates.some((entry) => entry.index === index)) continue
      const digest = hash.copy().digest('hex')
      if (index === tail || candidates.some((entry) => entry.index === index && entry.digest === digest)) {
        matching.push({ index, digest, order })
      }
    }
    const selected = matching.slice(-LIMIT)
    // If several reviews raced, keep at least one settled fallback alongside
    // speculative markers (an in-flight write may fail or not yet be visible).
    const fallback = matching.findLast((entry) => this.completed.some((old) => old.digest === entry.digest))
    if (fallback && !selected.includes(fallback)) selected[0] = fallback
    for (const { index } of selected) parts[index].prompt_cache_breakpoint = { mode: 'explicit' }

    const proposed = selected[selected.length - 1]
    this.pending = [...this.pending, proposed].slice(-LIMIT)
    return (success: boolean) => {
      this.pending = this.pending.filter((entry) => entry !== proposed)
      if (!success) return
      // Merge by submission order, not response order: late completions must
      // not roll back more recent candidates or evict them on duplicates.
      const recent = [...this.completed, ...selected].sort((a, b) => a.order - b.order || a.index - b.index)
      const unique = new Map<string, Boundary>()
      for (const entry of recent) {
        unique.delete(entry.digest)
        unique.set(entry.digest, entry)
      }
      this.completed = [...unique.values()].slice(-LIMIT)
    }
  }
}
