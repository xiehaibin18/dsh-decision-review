import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ContentBlockType, GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { ReviewDecision, OperatorRule } from '../shared/contracts.js'
import { isRecord, json } from './json.js'
import { REVIEW_POLICY } from './review-policy.js'
import type { Settings } from './settings.js'
import { snapshotAutoReview, type ReviewSnapshot, type ShownSchemas } from './snapshot.js'

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'auto-review': true
  }
}

type SessionDecision =
  { risk: 'low' | 'medium'; decision: 'allow' } | { risk: 'medium' | 'high'; decision: 'deny'; reason?: string }

interface PartialBlock {
  blockType: ContentBlockType
  text: string
  block?: ContentBlock
}

type AssembledBlock = ContentBlock | { type: Exclude<ContentBlockType, 'text' | 'reasoning'> }

/** Render the environment and one message per retained item. */
function reviewMessages(snapshot: ReviewSnapshot): RequestMessage[] {
  return [`ENVIRONMENT\n${json({ cwd: snapshot.cwd })}`, ...snapshot.history.map((entry) => json(entry))].map(
    (text) => ({ role: 'user', content: [{ type: 'text', text }] }),
  )
}

/** Count members in the raw top-level JSON object. */
function topLevelMemberCount(text: string): number {
  const syntax = text.replace(/"(?:\\.|[^"\\])*"/gs, '')
  let depth = 0
  let count = 0
  for (const char of syntax) {
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
    else if (char === ':' && depth === 1) count += 1
  }
  return count
}

/** Parse the closed risk/decision protocol and its fixed safety combinations. */
function parseDecision(text: string): SessionDecision {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) {
    throw new Error('decision-review: reviewer output must be one JSON object')
  }
  const keys = Object.keys(value)
  if (topLevelMemberCount(text) !== keys.length)
    throw new Error('decision-review: reviewer output repeats a JSON member')
  const risk = value.risk
  const decision = value.decision
  if (keys.length === 2 && decision === 'allow' && (risk === 'low' || risk === 'medium')) return { risk, decision }
  if (keys.length === 2 && decision === 'deny' && (risk === 'medium' || risk === 'high')) return { risk, decision }
  if (
    decision === 'deny' &&
    (risk === 'medium' || risk === 'high') &&
    keys.length === 3 &&
    Object.hasOwn(value, 'reason') &&
    typeof value.reason === 'string'
  ) {
    return { risk, decision, reason: value.reason }
  }
  throw new Error('decision-review: reviewer output does not match the risk/decision protocol')
}

/** Assemble the host LLM stream into closed blocks. Port of the host's
 * BlockAssembler (profile bundles cannot import @deepseek-ai/dsh-llm): a
 * block is built from `block-start`, its `*-delta` chunks, and a closing
 * `block-end` that carries the authoritative block; a stream may also carry
 * only deltas. */
class StreamBlockAssembler {
  private readonly partials = new Map<number, PartialBlock>()

  private ensure(index: number, blockType: ContentBlockType): PartialBlock {
    let partial = this.partials.get(index)
    if (partial === undefined) {
      partial = { blockType, text: '' }
      this.partials.set(index, partial)
    }
    return partial
  }

  push(chunk: StreamChunk): void {
    const type: string = chunk.type
    switch (chunk.type) {
      case 'block-start':
        this.ensure(chunk.index, chunk.blockType)
        return
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (partial.block === undefined) partial.text += typeof chunk.text === 'string' ? chunk.text : ''
        return
      }
      case 'tool-call-delta':
        this.ensure(chunk.index, 'tool-call')
        return
      case 'block-end': {
        const partial = this.ensure(chunk.index, chunk.block.type)
        if (partial.block === undefined) partial.block = chunk.block
        return
      }
      case 'usage':
      case 'finish':
        return
      default:
        throw new Error(`decision-review: reviewer emitted an unknown chunk type ${String(type)}`)
    }
  }

  blocks(): AssembledBlock[] {
    return Array.from(this.partials.values(), (partial) => {
      if (partial.block !== undefined) return partial.block
      if (partial.blockType === 'text' || partial.blockType === 'reasoning')
        return { type: partial.blockType, text: partial.text }
      return { type: partial.blockType }
    })
  }
}

/** Consume the streamed review answer: zero+ reasoning blocks, one text block, terminal stop. */
export async function readDecision(stream: AsyncIterable<StreamChunk>): Promise<SessionDecision> {
  const assembler = new StreamBlockAssembler()
  let finished = false
  for await (const chunk of stream) {
    if (finished) throw new Error('decision-review: reviewer emitted data after its terminal finish')
    assembler.push(chunk)
    if (chunk.type !== 'finish') continue
    finished = true
    const reason = chunk.reason
    const kind = reason && reason.kind
    if (reason?.kind === 'error' || reason?.kind === 'aborted') {
      const failure = reason.failure
      throw new Error(
        `decision-review: reviewer ended with ${kind} ${failure?.code ?? kind}: ${failure?.message ?? ''}`,
      )
    }
    if (kind !== 'stop') throw new Error(`decision-review: reviewer ended with ${String(kind)}`)
  }
  if (!finished) throw new Error('decision-review: reviewer emitted no terminal finish')
  const blocks = assembler.blocks()
  const final = blocks.at(-1)
  if (final?.type !== 'text' || blocks.slice(0, -1).some((block) => block.type !== 'reasoning')) {
    throw new Error(
      'decision-review: reviewer must emit zero or more reasoning blocks followed by exactly one text block',
    )
  }
  return parseDecision(final.text)
}

/** Give a session-engine denial the structured `why` and raw `reason` the
 * approval card and the model-facing message are built from; the session
 * protocol's optional free-text reason is the only detail it carries. */
function sessionDenialDetail(decision: SessionDecision): ReviewDecision {
  if (decision.decision !== 'deny') return decision
  return {
    ...decision,
    reason: decision.reason ?? `session reviewer denied this call as ${decision.risk} risk`,
    why: { code: 'session_denied', risk: decision.risk, reason: decision.reason },
  }
}

/** Review one frozen pending action with the fixed policy and current LLM route (official engine). */
export async function sessionClassifyRisk(
  ctx: Context,
  agent: Agent,
  exec: ToolExecution,
  signal: AbortSignal,
  shown: ShownSchemas,
  settings: Settings,
) {
  const cwd = await ctx.workingDirectory.ensure(agent, signal)
  const snapshot = snapshotAutoReview(agent, exec, cwd, shown)
  shown.set(snapshot.pending.key, snapshot.pending.schema)
  const options: GenerateOptions = {
    provider: snapshot.provider,
    model: snapshot.model,
    system: REVIEW_POLICY + operatorRulesSection(settings.rules),
    messages: reviewMessages(snapshot),
    temperature: 0,
    sessionId: agent.session.id,
    purpose: 'auto-review',
    signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]),
  }
  const started = Date.now()
  const decision = sessionDenialDetail(await readDecision(ctx.llm.stream(options)))
  return { decision, telemetry: { ms: Date.now() - started, answers: null, usage: null } }
}

/** Operator rules section appended to the session reviewer's system policy.
 * The session protocol has no per-rule question seam, so the rules arrive as
 * authoritative guidance and the model reflects their verdicts in its
 * risk/decision answer directly. */
function operatorRulesSection(rules: readonly OperatorRule[]): string {
  if (!rules || rules.length === 0) return ''
  const lines = rules.map((rule, i) => `r${i} [verdict=${rule.verdict}] ${rule.condition}`)
  return `\n\nOPERATOR RULES (operator authority, highest priority; judge each pending call against these semantic conditions, never surface strings):\n${lines.join('\n')}\nReflect a matched rule in your answer: verdict=allow means output risk low and decision allow; verdict=allow_if_requested requires effective explicit authorization as defined above, then the normal risk policy applies; without that authorization output medium and deny with reason "operator rule requires user adjudication". Verdict=ask means output decision deny with reason "operator rule requires user adjudication"; verdict=deny means output risk high and decision deny. A matched rule never overrides a high exfiltration finding.`
}
