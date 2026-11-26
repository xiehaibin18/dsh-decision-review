import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test'
import { apply, readDecision } from '../dist/index.js'
import {
  makeAnswers,
  makeExec,
  makeHost,
  makeProfileDir,
  makeSession,
  removeDir,
  silenceConsole,
  streamOf,
  stubDecisionsFetch,
  waitForAbort,
} from './helpers.js'

const VERDICT = '{"risk":"low","decision":"allow"}'
const STOP = { type: 'finish', reason: { kind: 'stop' } }

describe('readDecision against the host stream protocol', () => {
  test.each([
    ['a delta-only text block', [{ type: 'text-delta', index: 0, text: VERDICT }]],
    [
      'a block-start / block-end text block',
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'block-end', index: 0, block: { type: 'text', text: VERDICT } },
      ],
    ],
  ])('reads %s', async (_name, chunks) => {
    await expect(readDecision(streamOf([...chunks, STOP]))).resolves.toStrictEqual({ risk: 'low', decision: 'allow' })
  })

  test('reads reasoning followed by split text deltas', async () => {
    const stream = streamOf([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'Project-local test run.' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Project-local test run.' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: '{"risk":"medium",' },
      { type: 'text-delta', index: 1, text: '"decision":"deny","reason":"needs approval"}' },
      { type: 'usage', usage: {} },
      STOP,
    ])
    await expect(readDecision(stream)).resolves.toStrictEqual({
      risk: 'medium',
      decision: 'deny',
      reason: 'needs approval',
    })
  })

  test.each([
    [
      'reasoning after the text block',
      [{ type: 'text-delta', index: 0, text: VERDICT }, { type: 'reasoning-delta', index: 1, text: 'late' }, STOP],
      /followed by exactly one text block/,
    ],
    [
      'a tool-call block',
      [{ type: 'tool-call-delta', index: 0, id: 'x', name: 'y', argumentsDelta: '{}' }, STOP],
      /exactly one text block/,
    ],
    [
      'two text blocks',
      [{ type: 'text-delta', index: 0, text: VERDICT }, { type: 'text-delta', index: 1, text: VERDICT }, STOP],
      /protocol|JSON|exactly one/,
    ],
    ['a missing text block', [STOP], /exactly one text block/],
    ['a missing finish', [{ type: 'text-delta', index: 0, text: VERDICT }], /no terminal finish/],
    ['data after the finish', [STOP, { type: 'text-delta', index: 0, text: VERDICT }], /after its terminal finish/],
    ['an unknown chunk type', [{ type: 'text', text: VERDICT }, STOP], /unknown chunk type text/],
  ])('rejects %s', async (_name, chunks, error) => {
    await expect(readDecision(streamOf(chunks))).rejects.toThrow(error)
  })

  test.each([
    [{ kind: 'error', failure: { code: 'upstream', message: 'boom' } }, /ended with error upstream: boom/],
    [{ kind: 'aborted', failure: { code: 'timeout', message: 'too slow' } }, /ended with aborted timeout/],
  ])('surfaces a %j finish', async (reason, error) => {
    await expect(readDecision(streamOf([{ type: 'finish', reason }]))).rejects.toThrow(error)
  })
})

describe('session engine through the approval entry point', () => {
  let profileDir
  let host

  beforeEach(() => {
    silenceConsole()
    profileDir = makeProfileDir()
    fs.writeFileSync(path.join(profileDir, 'decision-review.settings.json'), JSON.stringify({ engine: 'session' }))
  })
  afterEach(async () => {
    try {
      await host?.dispose()
    } finally {
      host = undefined
      mock.restore()
      if (profileDir) removeDir(profileDir)
    }
  })

  function review(chunks, hostOptions = {}) {
    host = makeHost({
      profileContext: { name: 'test', dir: profileDir },
      stream: () => streamOf(chunks),
      ...hostOptions,
    })
    apply(host.ctx)
    return host.listeners.get('tools/pre-execute')(makeExec(makeSession()), async () => ({ kind: 'allow' }))
  }

  test('allows when the host-protocol stream says allow', async () => {
    await expect(review([{ type: 'text-delta', index: 0, text: VERDICT }, STOP])).resolves.toStrictEqual({
      kind: 'allow',
    })
  })

  test('turns a bare denial into a localized approval ask instead of throwing', async () => {
    const result = await review([{ type: 'text-delta', index: 0, text: '{"risk":"medium","decision":"deny"}' }, STOP])
    expect(result.kind).toBe('ask')
    expect(result.reason).toMatch(/session reviewer denied this call as medium risk/)
    expect(result.displayReason.zh).toMatch(/会话模型将此调用判为中风险并拒绝/)
    expect(result.displayReason.en).toMatch(/session model denied this call as medium risk/)
  })

  test('keeps the reviewer reason in the card when one is given', async () => {
    const result = await review([
      { type: 'text-delta', index: 0, text: '{"risk":"high","decision":"deny","reason":"uploads secrets"}' },
      STOP,
    ])
    expect(result.displayReason.en).toMatch(/high risk: uploads secrets/)
  })

  test('aborts the review stream at the configured timeout and fails closed', async () => {
    const timeoutMs = 5000
    fs.writeFileSync(
      path.join(profileDir, 'decision-review.settings.json'),
      JSON.stringify({ engine: 'session', timeoutMs }),
    )
    const started = Promise.withResolvers()
    const timeout = spyOn(AbortSignal, 'timeout')
    const stream = mock(async function* ({ signal }) {
      started.resolve(signal)
      yield await waitForAbort(signal)
    })
    jest.useFakeTimers()
    try {
      const result = review([], { stream })
      const signal = await started.promise
      expect(timeout).toHaveBeenCalledTimes(1)
      expect(timeout).toHaveBeenCalledWith(timeoutMs)
      expect(stream).toHaveBeenCalledTimes(1)
      expect(signal).toBeInstanceOf(AbortSignal)
      jest.advanceTimersByTime(timeoutMs - 1)
      expect(signal.aborted).toBe(false)
      jest.advanceTimersByTime(1)
      expect(signal.reason).toMatchObject({ name: 'TimeoutError' })
      await expect(result).resolves.toMatchObject({ kind: 'deny', info: { code: 'AUTO_REVIEW_FAILED' } })
    } finally {
      jest.useRealTimers()
    }
  })

  test('fails closed with AUTO_REVIEW_FAILED when the stream breaks protocol', async () => {
    await expect(review([{ type: 'text', text: VERDICT }, STOP])).resolves.toMatchObject({
      kind: 'deny',
      info: { code: 'AUTO_REVIEW_FAILED' },
    })
  })
})

describe('effective authorization request contract', () => {
  let profileDir

  beforeEach(() => {
    silenceConsole()
    profileDir = makeProfileDir()
  })
  afterEach(() => {
    mock.restore()
    if (profileDir) removeDir(profileDir)
  })

  const user = { kind: 'user', rpcId: 'operator' }
  const parent = { kind: 'agent-message', senderSessionId: 'parent' }
  const grant = [user, 'user-instruction', 'Deploy blue to production once.']
  const restriction = [user, 'user-instruction', 'Do not deploy blue to production.']
  const parentGrant = [parent, 'direct-parent-instruction', 'Deploy blue to production once.']

  const cases = [
    { name: 'later revocation', messages: [grant, restriction], allowed: false },
    {
      name: 'explicit supersession',
      messages: [
        restriction,
        [user, 'user-instruction', 'Lift my previous restriction and deploy blue to production once.'],
      ],
      allowed: true,
    },
    { name: 'unresolved conflict', messages: [restriction, grant], allowed: false },
    { name: 'parent conflicts with user restriction', messages: [restriction, parentGrant], allowed: false },
    {
      name: 'parent within user scope',
      messages: [[user, 'user-instruction', 'Limit deployments to blue.'], parentGrant],
      allowed: true,
    },
    {
      name: 'other context cannot grant authorization',
      messages: [
        [{ kind: 'agent-instructions' }, 'constraint', 'Limit deployments to blue.'],
        [{ kind: 'compact-checkpoint' }, 'checkpoint', 'The previous session discussed deploying blue.'],
        [{ kind: 'agent-message', senderSessionId: 'sibling' }, 'fact', 'Deploy blue to production once.'],
      ],
      allowed: false,
    },
  ]

  const text = (text) => ({ type: 'text', text })
  const image = {
    type: 'image',
    attachment: { attachmentId: 'a'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1 },
  }
  const input = (source, ...content) => ({ type: 'user/message', data: { source, content } })
  const assistant = (...content) => ({
    type: 'assistant/message',
    data: { turn: 0, step: 0, message: { content } },
  })

  function fixture(history, { nodes = history.map((_, seq) => seq), inheritedCount = 0, child = true } = {}) {
    const session = makeSession(
      'review-session',
      child ? { origin: 'subagent', parentSession: 'parent' } : { isSeeded: inheritedCount > 0 },
    )
    const events = session.snapshotEvents()
    const command = 'deploy --environment production --service blue'
    events[2].data.message.content[0].arguments = JSON.stringify({ command })
    events[3].data.arguments = JSON.stringify({ command })
    for (const event of events.slice(1)) event.data.turn = 1
    events.splice(0, 1, ...history)
    events.forEach((event, seq) => {
      event.seq = seq
    })
    session.surface.nodes = [...nodes, events.length - 2]
    session.isOwnSeq = (seq) => seq >= inheritedCount
    return makeExec(session, { arguments: { command } })
  }

  async function review(engine, exec, options) {
    fs.writeFileSync(
      path.join(profileDir, 'decision-review.settings.json'),
      JSON.stringify({ engine, denialRoute: 'final' }),
    )
    const host = makeHost({ profileContext: { dir: profileDir }, ...options })
    try {
      apply(host.ctx)
      return await host.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
    } finally {
      await host.dispose()
    }
  }

  test.each(cases)(
    'sends the same ordered evidence and authorization policy for $name',
    async ({ messages, allowed }) => {
      // Stubs exercise request assembly and result routing, not interpretation by a model.
      const fetchDecisions = stubDecisionsFetch(() =>
        makeAnswers({
          risk: 'medium',
          overrides: { explicit_authorization: { type: 'predicate', probability: allowed ? 1 : 0 } },
        }),
      )
      const history = messages.map(([source, , content]) => input(source, text(content)))
      const decisions = await review('decisions', fixture(history))
      const stream = mock(() =>
        streamOf([
          {
            type: 'text-delta',
            index: 0,
            text: JSON.stringify({ risk: 'medium', decision: allowed ? 'allow' : 'deny' }),
          },
          STOP,
        ]),
      )
      const session = await review('session', fixture(history), { stream })
      expect(fetchDecisions).toHaveBeenCalledTimes(1)
      expect(stream).toHaveBeenCalledTimes(1)
      const [[, { body }]] = fetchDecisions.mock.calls
      const [[sessionRequest]] = stream.mock.calls
      const request = JSON.parse(body)
      const policy = request.questions
        .find(({ name }) => name === 'explicit_authorization')
        .instructions.split('\n\n')
        .slice(1)
        .join('\n\n')
      expect(sessionRequest.system).toContain(policy)
      expect(policy).toMatch(/revokes, narrows or supersedes/)
      expect(policy).toMatch(/parent instruction.*cannot override a user restriction/)
      expect(policy).toMatch(/still conflict, treat authorization as absent/)
      const retained = (parts) =>
        parts
          .slice(1)
          .map(({ text }) => JSON.parse(text))
          .filter(({ kind }) => kind === 'user-message')
          .map(({ source, role, content }) => [source, role, content[0].text])
      expect(retained(request.input[0].content)).toStrictEqual(messages)
      expect(retained(sessionRequest.messages.map(({ content }) => content[0]))).toStrictEqual(messages)
      expect(decisions.kind).toBe(allowed ? 'allow' : 'deny')
      expect(session.kind).toBe(decisions.kind)
    },
  )

  test('both engines retain the immediately preceding assistant reply as a fact', async () => {
    const first = text('1. Run the staging checks.\n\n')
    const second = text('  2. Deploy blue to production once.  ')
    const reply = text('Do 2.')
    const instructions = { kind: 'agent-instructions' }
    const constraint = text('Limit deployments to blue.')
    const history = [
      assistant(text('An older, unrelated proposal.')),
      assistant(
        first,
        { type: 'reasoning', text: 'Private reasoning' },
        image,
        { type: 'tool-call', id: 'queued-call', name: 'bash', arguments: '{"command":"never-started"}' },
        second,
      ),
      assistant(text('An assistant message that was replaced on the surface.')),
      input(instructions, constraint),
      input(user, image, reply),
      { type: 'system/message', data: { message: { content: [text('Host prompt update')] } } },
      { type: 'developer/message', data: { message: { content: [{ type: 'tool-addition', toolName: 'new-tool' }] } } },
    ]
    const exec = () => fixture(history, { nodes: [0, 1, 5, 6, 3, 4], child: false })
    const fetchDecisions = stubDecisionsFetch(() => makeAnswers())
    const stream = mock(() => streamOf([{ type: 'text-delta', index: 0, text: VERDICT }, STOP]))
    await expect(review('decisions', exec())).resolves.toMatchObject({ kind: 'allow' })
    await expect(review('session', exec(), { stream })).resolves.toMatchObject({ kind: 'allow' })

    const request = JSON.parse(fetchDecisions.mock.calls[0][1].body)
    const sessionRequest = stream.mock.calls[0][0]
    const historyParts = (parts) => parts.slice(1).map(({ text }) => JSON.parse(text))
    const expected = [
      { kind: 'user-message', role: 'constraint', source: instructions, content: [constraint] },
      { kind: 'user-message', role: 'fact', source: user, content: [image] },
      { kind: 'assistant-reference', role: 'fact', content: [first, second] },
      { kind: 'user-message', role: 'user-instruction', source: user, content: [reply] },
      {
        kind: 'tool-schema',
        role: 'fact',
        mode: 'native',
        name: 'bash',
        description: 'Run a command.',
        parameters: { type: 'object' },
      },
    ]
    expect(historyParts(request.input[0].content)).toStrictEqual(expected)
    expect(historyParts(sessionRequest.messages.slice(0, -1).map(({ content }) => content[0]))).toStrictEqual(expected)
  })

  const proposal = assistant(text('1. Deploy blue to production once.'))
  const reply = input(user, text('Do 1.'))
  test.each([
    ['an unanswered proposal', [proposal], {}],
    ['an attachment-only user message', [proposal, input(user, image), reply], {}],
    ['a user attachment with whitespace-only text', [proposal, input(user, image, text(' \n  ')), reply], {}],
    [
      'a later assistant message with no visible text',
      [proposal, assistant({ type: 'reasoning', text: 'Private reasoning' }), reply],
      {},
    ],
    [
      'a tool result',
      [proposal, { type: 'tool/result', data: { message: { content: [text('Tool output')] } } }, reply],
      {},
    ],
    ['a parent instruction', [proposal, input(parent, text('Do 1.')), reply], {}],
    ['an unverified child prompt', [proposal, input({ kind: 'user' }, text('Do 1.'))], {}],
    [
      'a compaction checkpoint',
      [proposal, input({ kind: 'compact-checkpoint' }, text('Compaction summary')), reply],
      {},
    ],
    ['a reply across a fork boundary', [proposal, reply], { child: false, inheritedCount: 1 }],
    ['a reply in the inherited prefix', [proposal, reply], { child: false, inheritedCount: 2 }],
  ])('omits assistant references for %s', async (_name, history, options) => {
    const fetchDecisions = stubDecisionsFetch(() => makeAnswers())
    await expect(review('decisions', fixture(history, options))).resolves.toMatchObject({ kind: 'allow' })
    const request = JSON.parse(fetchDecisions.mock.calls[0][1].body)
    const entries = request.input[0].content.slice(1).map(({ text }) => JSON.parse(text))
    expect(entries.map(({ kind }) => kind)).not.toContain('assistant-reference')
  })

  const firstPlan = { ...assistant(text('1. Run the staging checks.')), surfaceOp: 'append' }
  const laterPlan = { ...assistant(text('1. Deploy blue to production once.')), surfaceOp: 'append' }
  const queuedReply = {
    ...input(user, text('Do 1.')).data,
    id: 'queued-user-reply',
    role: 'user',
  }
  const inbox = (target, inserted, removal = {}) => ({
    type: 'agent/inbox/spliced',
    data: { target, start: 0, inserted, ...removal },
  })
  const submit = inbox('next-turn', [queuedReply])
  const claim = inbox('next-turn', [], { removedCount: 1 })
  const remove = inbox('next-turn', [], { removedCount: 1, outcome: 'canceled' })
  const steer = inbox('next-step', [queuedReply])
  const claimSteering = inbox('next-step', [], { removedCount: 1 })
  const admit = { type: 'user/message', data: queuedReply, surfaceOp: 'append' }
  const editedReply = { ...queuedReply, content: [text('Do option 1 only.')] }
  const edit = inbox('next-turn', [editedReply], { removedCount: 1, outcome: 'canceled' })
  const admitEdit = { ...admit, data: editedReply }
  const earlierQueuedReply = { ...queuedReply, id: 'earlier-queued-user-reply', content: [text('Check staging.')] }
  const checkpoint = {
    ...input({ kind: 'compact-checkpoint' }, text('Compaction summary')),
    surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 },
    sourceEventSeqs: [0],
  }

  test.each([
    { name: 'before a proposal', history: [submit, laterPlan, claim, admit] },
    { name: 'after a proposal', history: [laterPlan, submit, claim, admit], expected: laterPlan },
    { name: 'between two proposals', history: [firstPlan, submit, laterPlan, claim, admit], expected: firstPlan },
    {
      name: 'before a proposal and then moved to steering',
      history: [submit, laterPlan, remove, steer, claimSteering, admit],
    },
    {
      name: 'between two proposals and then moved to steering',
      history: [firstPlan, submit, laterPlan, remove, steer, claimSteering, admit],
      expected: firstPlan,
    },
    { name: 'between two proposals and then edited', history: [firstPlan, submit, laterPlan, edit, claim, admitEdit] },
    {
      name: 'after a still-pending user submission under the same proposal',
      history: [
        firstPlan,
        inbox('next-turn', [earlierQueuedReply]),
        inbox('next-turn', [queuedReply], { start: 1 }),
        inbox('next-turn', [], { start: 1, removedCount: 1, outcome: 'canceled' }),
        steer,
        claimSteering,
        admit,
      ],
    },
    {
      name: 'after a preceding proposal was compacted',
      history: [firstPlan, checkpoint, submit, laterPlan, claim, admit],
      nodes: [1, 3, 5],
    },
    {
      name: 'before its preceding proposal was compacted',
      history: [firstPlan, submit, checkpoint, laterPlan, claim, admit],
      nodes: [2, 3, 5],
    },
    {
      name: 'in an inherited inbox and then moved',
      history: [submit, laterPlan, remove, steer, claimSteering, admit],
      inheritedCount: 1,
    },
  ])(
    'uses the durable first submission for a reply sent $name',
    async ({
      history,
      expected,
      inheritedCount,
      nodes = history.flatMap((event, seq) => (event.surfaceOp === 'append' ? [seq] : [])),
    }) => {
      const fetchDecisions = stubDecisionsFetch(() => makeAnswers())
      await expect(
        review('decisions', fixture(history, { nodes, inheritedCount, child: false })),
      ).resolves.toMatchObject({
        kind: 'allow',
      })
      const request = JSON.parse(fetchDecisions.mock.calls[0][1].body)
      const entries = request.input[0].content.slice(1).map(({ text }) => JSON.parse(text))
      const reply = entries.findIndex(({ role }) => role === 'user-instruction')
      expect(reply).toBeGreaterThanOrEqual(0)
      expect(entries.filter(({ kind }) => kind === 'assistant-reference')).toStrictEqual(
        expected ? [{ kind: 'assistant-reference', role: 'fact', content: expected.data.message.content }] : [],
      )
      if (expected) expect(entries[reply - 1]?.kind).toBe('assistant-reference')
    },
  )
})
