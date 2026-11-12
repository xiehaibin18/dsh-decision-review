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
    expect(result.displayReason.zh).toMatch(/会话评审员判定为中风险并拒绝/)
    expect(result.displayReason.en).toMatch(/session reviewer denied this call as medium risk/)
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

  function fixture(messages) {
    const session = makeSession('review-child', { origin: 'subagent', parentSession: 'parent' })
    const events = session.snapshotEvents()
    const command = 'deploy --environment production --service blue'
    events[2].data.message.content[0].arguments = JSON.stringify({ command })
    events[3].data.arguments = JSON.stringify({ command })
    events.splice(
      0,
      1,
      ...messages.map(([source, , text]) => ({
        type: 'user/message',
        data: { source, content: [{ type: 'text', text }] },
      })),
    )
    events.forEach((event, seq) => {
      event.seq = seq
    })
    session.surface.nodes = [...messages.map((_, seq) => seq), events.length - 2]
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
      const decisions = await review('decisions', fixture(messages))
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
      const session = await review('session', fixture(messages), { stream })
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
})
