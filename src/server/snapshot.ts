import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-instructions'
import type {} from '@deepseek-ai/dsh-compaction'
import type { ContentBlock, MessageSource, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { isRecord, json } from './json.js'

type ReviewSourceRole = 'user-instruction' | 'direct-parent-instruction' | 'constraint' | 'checkpoint' | 'fact'
type CallMode = 'native' | 'ptc-inner'

interface HistoricalUserMessage {
  kind: 'user-message'
  role: ReviewSourceRole
  source: MessageSource
  content: readonly ContentBlock[]
}

interface HistoricalToolCall {
  kind: 'tool-call'
  role: 'fact'
  mode: CallMode
  name: string
  arguments: string
}

interface HistoricalToolSchema {
  kind: 'tool-schema'
  role: 'fact'
  mode: CallMode
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type HistoricalEntry = HistoricalUserMessage | HistoricalToolCall | HistoricalToolSchema
export type ShownSchemas = Map<string, HistoricalToolSchema>

export interface ReviewSnapshot {
  provider: string
  model: string
  cwd: string
  history: readonly HistoricalEntry[]
  pending: { key: string; schema: HistoricalToolSchema }
}

type NativeCallEvent = Extract<SessionEvent, { type: 'tool/call' }>
type PtcStartEvent = Extract<SessionEvent, { type: 'tool/ptc-dispatch-start' }>
type StepIdentity = { readonly turn: number; readonly step: number }
type ScopedPtcStart = { event: PtcStartEvent; step: StepIdentity }
type CreationPrompts = { own: SessionEvent['seq'] | undefined; all: ReadonlySet<SessionEvent['seq']> }

/** Recreate the agent-loop's parse of one native call's logged raw arguments. */
function parseLoggedArguments(raw: string): unknown {
  if (raw === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Compare two lossless-JSON values without retaining aliases. */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Validate the schema fields that must be present in a logged pending action. */
function loggedSchema(
  value: { description?: unknown; parameters?: unknown },
  expectedName: string,
  mode: 'native' | 'PTC',
): ToolSchema {
  if (typeof value.description !== 'string' || !isRecord(value.parameters)) {
    throw new Error(`decision-review: the pending ${mode} tool schema is incomplete`)
  }
  return { name: expectedName, description: value.description, parameters: value.parameters }
}

/** Whether browser admission distinguishes a user prompt from a child's creation prompt. */
function isBrowserPrompt(source: MessageSource): boolean {
  return source.kind === 'user' && 'rpcId' in source && typeof source.rpcId === 'string'
}

/** Whether this visible context is the current project-instruction source. */
function isProjectInstruction(source: MessageSource): boolean {
  return source.kind === 'agent-instructions'
}

/** Whether this source is a compaction checkpoint. */
function isCheckpoint(source: MessageSource): boolean {
  return source.kind === 'compact-checkpoint'
}

/** Whether this message was durably attributed to the child's direct parent. */
function isDirectParentInstruction(source: MessageSource, parentSession: Session['header']['parentSession']): boolean {
  return parentSession !== undefined && source.kind === 'agent-message' && source.senderSessionId === parentSession
}

/** Identify model-authored creation prompts in the current and inherited Sessions. */
function creationPrompts(agent: Agent, events: readonly SessionEvent[]): CreationPrompts {
  const session = agent.session
  const all = new Set<SessionEvent['seq']>()
  let passedCreationBoundary = false
  for (const event of events) {
    if (event.type === 'subagent/descriptor') {
      passedCreationBoundary = true
      continue
    }
    if (
      passedCreationBoundary &&
      event.type === 'user/message' &&
      event.data.source.kind === 'user' &&
      !isBrowserPrompt(event.data.source)
    ) {
      all.add(event.seq)
      if (
        session.isOwnSeq(event.seq) &&
        session.header.origin === 'subagent' &&
        session.header.parentSession !== undefined
      ) {
        return { own: event.seq, all }
      }
      passedCreationBoundary = false
    }
  }
  return { own: undefined, all }
}

/** Assign one retained text block its fixed instruction, constraint, summary, or fact role. */
function textRole(
  source: MessageSource,
  seq: SessionEvent['seq'],
  prompts: CreationPrompts,
  session: Session,
): ReviewSourceRole {
  if (seq === prompts.own || isDirectParentInstruction(source, session.header.parentSession)) {
    return 'direct-parent-instruction'
  }
  if (prompts.all.has(seq)) return 'fact'
  if (source.kind === 'user') {
    // A child's unverified creation prompt must not acquire user-level authority.
    if (
      prompts.own === undefined &&
      session.header.origin === 'subagent' &&
      session.header.parentSession !== undefined &&
      session.isOwnSeq(seq) &&
      !isBrowserPrompt(source)
    )
      return 'fact'
    return 'user-instruction'
  }
  if (isCheckpoint(source)) return 'checkpoint'
  return 'fact'
}

/** Partition one visible user-role message into role-labelled retained blocks. */
function filteredUserEntries(
  seq: SessionEvent['seq'],
  source: MessageSource,
  content: readonly ContentBlock[],
  prompts: CreationPrompts,
  session: Session,
): HistoricalUserMessage[] {
  return content.map((block) => ({
    kind: 'user-message',
    role: block.type === 'text' ? textRole(source, seq, prompts, session) : 'fact',
    source,
    content: [block],
  }))
}

/** Copy the turn and step identity carried by one core execution event. */
function stepIdentity(data: StepIdentity): StepIdentity {
  return { turn: data.turn, step: data.step }
}

/** Compare two turn-and-step identities. */
function sameStep(left: StepIdentity, right: StepIdentity): boolean {
  return left.turn === right.turn && left.step === right.step
}

/** Key one call id inside the step that owns its lifecycle. */
function scopedCallKey(step: StepIdentity, callId: ToolCallId): string {
  return `${step.turn}\u0000${step.step}\u0000${callId}`
}

/** Assign each PTC start to the step open when it was logged. */
function scopePtcStarts(events: readonly SessionEvent[]) {
  const starts: ScopedPtcStart[] = []
  let openStep: StepIdentity | undefined
  for (const event of events) {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      openStep = undefined
      continue
    }
    if (event.type === 'step/start') {
      openStep = stepIdentity(event.data)
      continue
    }
    if (event.type === 'step/end') {
      openStep = undefined
      continue
    }
    if (event.type !== 'tool/ptc-dispatch-start') continue
    if (openStep === undefined) throw new Error('decision-review: a PTC call has no owning step in the session log')
    starts.push({ event, step: openStep })
  }
  return { starts, openStep }
}

/** Build the history item that describes one call's tool. */
function toolSchemaEntry(mode: CallMode, schema: ToolSchema): HistoricalToolSchema {
  return {
    kind: 'tool-schema',
    role: 'fact',
    mode,
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  }
}

/** Resolve one native action's schema from its visible call and latest request header. */
function nativeAction(
  exec: ToolExecution,
  headerTools: readonly ToolSchema[] | undefined,
  logged: NativeCallEvent,
): HistoricalToolSchema {
  if (logged.data.name !== exec.name || !sameJson(parseLoggedArguments(logged.data.arguments), exec.arguments)) {
    throw new Error('decision-review: the pending native call disagrees with its logged action')
  }
  const candidates: readonly unknown[] = Array.isArray(headerTools) ? headerTools : []
  const schemas = candidates.filter(
    (candidate): candidate is Record<string, unknown> => isRecord(candidate) && candidate.name === exec.name,
  )
  const candidate = schemas[0]
  if (candidate === undefined || schemas.length !== 1) {
    throw new Error('decision-review: the pending native tool schema is missing or ambiguous')
  }
  return toolSchemaEntry('native', loggedSchema(candidate, exec.name, 'native'))
}

/** Resolve a PTC inner action's schema from its binding and logged identity. */
function ptcAction(
  exec: ToolExecution,
  start: ScopedPtcStart,
  visibleParentKeys: ReadonlySet<string>,
): HistoricalToolSchema {
  const { event } = start
  if (
    !visibleParentKeys.has(scopedCallKey(start.step, event.data.parentCallId)) ||
    event.data.rootCallId !== exec.rootCallId ||
    event.data.name !== exec.name ||
    !sameJson(event.data.arguments, exec.arguments)
  ) {
    throw new Error('decision-review: the pending PTC call disagrees with its logged action')
  }
  if (exec.schema === undefined || exec.schema.name !== exec.name) {
    throw new Error('decision-review: the pending PTC binding schema is missing or inconsistent')
  }
  return toolSchemaEntry('ptc-inner', loggedSchema(exec.schema, exec.name, 'PTC'))
}

/** Key one call's shown schema by its mode and step-scoped identity. */
function shownSchemaKey(mode: CallMode, scopedKey: string): string {
  return `${mode}\u0000${scopedKey}`
}

/**
 * Freeze the reviewer input from one session and pending execution.
 * Uses the official plugin's snapshot algorithm without a runtime host import.
 */
export function snapshotAutoReview(
  agent: Agent,
  exec: ToolExecution,
  cwd: string,
  shown: ReadonlyMap<string, HistoricalToolSchema>,
): ReviewSnapshot {
  const session = agent.session
  // Reviewer needs the whole action history; no projection or paged reader exists yet.
  const events = session.snapshotEvents()
  const nodes = [...session.surface.nodes]
  const header = session.requestHeader()
  if (header === undefined || header.config.provider.length === 0 || header.config.model.length === 0) {
    throw new Error('decision-review: no complete request-header route is available')
  }

  const nativeCalls = events.filter((event) => event.type === 'tool/call')
  const { starts, openStep: currentStep } = scopePtcStarts(events)
  const prompts = creationPrompts(agent, events)
  const nativeByScopedId = new Map<string, NativeCallEvent[]>()
  for (const event of nativeCalls) {
    const key = scopedCallKey(stepIdentity(event.data), event.data.callId)
    const bucket = nativeByScopedId.get(key)
    if (bucket === undefined) nativeByScopedId.set(key, [event])
    else bucket.push(event)
  }
  const startsByParent = new Map<string, ScopedPtcStart[]>()
  const startsBySubCall = new Map<string, ScopedPtcStart>()
  for (const start of starts) {
    const subCallKey = scopedCallKey(start.step, start.event.data.subCallId)
    if (startsBySubCall.has(subCallKey))
      throw new Error('decision-review: a PTC call identity is ambiguous in the session log')
    startsBySubCall.set(subCallKey, start)
    const parentKey = scopedCallKey(start.step, start.event.data.parentCallId)
    const bucket = startsByParent.get(parentKey)
    if (bucket === undefined) startsByParent.set(parentKey, [start])
    else bucket.push(start)
  }

  if (currentStep === undefined)
    throw new Error('decision-review: the pending call has no open step in the session log')
  const currentRootCalls = nativeByScopedId.get(scopedCallKey(currentStep, exec.rootCallId)) ?? []
  const currentRootCall = currentRootCalls[0]
  if (currentRootCall === undefined || currentRootCalls.length !== 1) {
    throw new Error('decision-review: the pending root call is missing or ambiguous in the session log')
  }
  const currentPtcStart =
    exec.parent === undefined ? undefined : startsBySubCall.get(scopedCallKey(currentStep, exec.callId))
  if (exec.parent !== undefined && currentPtcStart === undefined) {
    throw new Error('decision-review: the pending PTC call is missing or ambiguous in the session log')
  }

  const history: HistoricalEntry[] = []
  const emittedSchemas = new Set<string>()
  const pushCall = (
    mode: CallMode,
    key: string,
    callName: string,
    rawArguments: string,
    schema?: HistoricalToolSchema,
  ) => {
    const resolved = schema === undefined ? shown.get(key) : schema
    if (resolved !== undefined && !emittedSchemas.has(JSON.stringify(resolved))) {
      emittedSchemas.add(JSON.stringify(resolved))
      history.push(resolved)
    }
    history.push({ kind: 'tool-call', role: 'fact', mode, name: callName, arguments: rawArguments })
  }
  const visibleParentKeys = new Set<string>()
  let passedCurrentRoot = false
  for (const seq of nodes) {
    const event = events[seq]
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'tool') continue
      if (isProjectInstruction(event.data.source)) {
        const content = event.data.content
        if (content.length > 0) {
          history.push({ kind: 'user-message', role: 'constraint', source: event.data.source, content })
        }
      } else {
        history.push(...filteredUserEntries(event.seq, event.data.source, event.data.content, prompts, session))
      }
      continue
    }
    if (event.type !== 'assistant/message') continue
    const messageStep = stepIdentity(event.data)
    const isCurrentMessage = sameStep(messageStep, currentStep)
    let sawUnstartedSibling = false
    for (const block of event.data.message.content) {
      if (block.type !== 'tool-call') continue
      const key = scopedCallKey(messageStep, block.id)
      const isCurrentRoot = isCurrentMessage && block.id === exec.rootCallId
      if (isCurrentRoot && passedCurrentRoot)
        throw new Error('decision-review: the pending root call is ambiguous in the current surface')
      const calls = nativeByScopedId.get(key) ?? []
      if (calls.length > 1) throw new Error('decision-review: a native call identity is ambiguous in the session log')
      const call = calls[0]
      const startsForCall = startsByParent.get(key) ?? []
      if (call === undefined) {
        if (isCurrentMessage && !passedCurrentRoot)
          throw new Error('decision-review: a visible call before the pending root is missing from the session log')
        if (startsForCall.length > 0)
          throw new Error('decision-review: an unstarted visible call has logged PTC dispatches')
        sawUnstartedSibling = true
        continue
      }
      if (sawUnstartedSibling) throw new Error('decision-review: visible native call logs do not form a started prefix')
      if (call.data.name !== block.name || call.data.arguments !== block.arguments) {
        throw new Error('decision-review: a visible tool call disagrees with its logged action')
      }
      visibleParentKeys.add(key)
      if (call !== currentRootCall || exec.parent !== undefined) {
        pushCall('native', shownSchemaKey('native', key), call.data.name, call.data.arguments)
      }
      for (const start of startsForCall) {
        if (start === currentPtcStart) continue
        const subCallKey = scopedCallKey(start.step, start.event.data.subCallId)
        pushCall(
          'ptc-inner',
          shownSchemaKey('ptc-inner', subCallKey),
          start.event.data.name,
          json(start.event.data.arguments),
        )
      }
      if (isCurrentRoot) passedCurrentRoot = true
    }
  }

  if (!passedCurrentRoot) throw new Error('decision-review: the pending root call is missing from the current surface')

  let pending: ReviewSnapshot['pending']
  if (currentPtcStart === undefined) {
    pending = {
      key: shownSchemaKey('native', scopedCallKey(currentStep, exec.rootCallId)),
      schema: nativeAction(exec, header.tools, currentRootCall),
    }
    pushCall('native', pending.key, exec.name, currentRootCall.data.arguments, pending.schema)
  } else {
    pending = {
      key: shownSchemaKey('ptc-inner', scopedCallKey(currentStep, exec.callId)),
      schema: ptcAction(exec, currentPtcStart, visibleParentKeys),
    }
    pushCall('ptc-inner', pending.key, exec.name, json(currentPtcStart.event.data.arguments), pending.schema)
  }
  return {
    provider: header.config.provider,
    model: header.config.model,
    cwd,
    history,
    pending,
  }
}
