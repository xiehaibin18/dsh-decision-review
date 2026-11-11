import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
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
} from './helpers.js'

silenceConsole()

const VERDICT = '{"risk":"low","decision":"allow"}'

describe('readDecision against the host stream protocol', () => {
  it('reads a delta-only text block', async () => {
    const stream = streamOf([
      { type: 'text-delta', index: 0, text: VERDICT },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.deepEqual(await readDecision(stream), { risk: 'low', decision: 'allow' })
  })

  it('reads a block-start / block-end text block', async () => {
    const stream = streamOf([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: VERDICT } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.deepEqual(await readDecision(stream), { risk: 'low', decision: 'allow' })
  })

  it('reads reasoning followed by split text deltas', async () => {
    const stream = streamOf([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'Project-local test run.' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Project-local test run.' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: '{"risk":"medium",' },
      { type: 'text-delta', index: 1, text: '"decision":"deny","reason":"needs approval"}' },
      { type: 'usage', usage: {} },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.deepEqual(await readDecision(stream), { risk: 'medium', decision: 'deny', reason: 'needs approval' })
  })

  it('rejects reasoning after the text block', async () => {
    const stream = streamOf([
      { type: 'text-delta', index: 0, text: VERDICT },
      { type: 'reasoning-delta', index: 1, text: 'late' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    await assert.rejects(readDecision(stream), /followed by exactly one text block/)
  })

  it('rejects a tool-call block, two text blocks and a missing text block', async () => {
    await assert.rejects(
      readDecision(
        streamOf([
          { type: 'tool-call-delta', index: 0, id: 'x', name: 'y', argumentsDelta: '{}' },
          { type: 'finish', reason: { kind: 'stop' } },
        ]),
      ),
      /exactly one text block/,
    )
    await assert.rejects(
      readDecision(
        streamOf([
          { type: 'text-delta', index: 0, text: VERDICT },
          { type: 'text-delta', index: 1, text: VERDICT },
          { type: 'finish', reason: { kind: 'stop' } },
        ]),
      ),
      /protocol|JSON|exactly one/,
    )
    await assert.rejects(
      readDecision(streamOf([{ type: 'finish', reason: { kind: 'stop' } }])),
      /exactly one text block/,
    )
  })

  it('surfaces a failed or aborted finish', async () => {
    const failed = streamOf([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'upstream', message: 'boom' } } },
    ])
    await assert.rejects(readDecision(failed), /ended with error upstream: boom/)
    const aborted = streamOf([
      { type: 'finish', reason: { kind: 'aborted', failure: { code: 'timeout', message: 'too slow' } } },
    ])
    await assert.rejects(readDecision(aborted), /ended with aborted timeout/)
  })

  it('requires a terminal finish and nothing after it', async () => {
    await assert.rejects(
      readDecision(streamOf([{ type: 'text-delta', index: 0, text: VERDICT }])),
      /no terminal finish/,
    )
    await assert.rejects(
      readDecision(
        streamOf([
          { type: 'finish', reason: { kind: 'stop' } },
          { type: 'text-delta', index: 0, text: VERDICT },
        ]),
      ),
      /after its terminal finish/,
    )
  })

  it('rejects an unknown chunk type', async () => {
    await assert.rejects(
      readDecision(
        streamOf([
          { type: 'text', text: VERDICT },
          { type: 'finish', reason: { kind: 'stop' } },
        ]),
      ),
      /unknown chunk type text/,
    )
  })
})

describe('session engine through the approval entry point', () => {
  let profileDir

  beforeEach(() => {
    profileDir = makeProfileDir()
    fs.writeFileSync(path.join(profileDir, 'decision-review.settings.json'), JSON.stringify({ engine: 'session' }))
  })
  afterEach(() => {
    removeDir(profileDir)
    mock.restoreAll()
    silenceConsole()
  })

  async function review(chunks, hostOptions = {}) {
    let streamOptions
    const host = makeHost({
      profileContext: { name: 'test', dir: profileDir },
      stream: (options) => {
        streamOptions = options
        return streamOf(chunks)
      },
      ...hostOptions,
    })
    apply(host.ctx)
    const preExecute = host.listeners.get('tools/pre-execute')
    const result = await preExecute(makeExec(makeSession()), async () => ({ kind: 'allow' }))
    return { result, streamOptions }
  }

  it('allows when the host-protocol stream says allow', async () => {
    const { result } = await review([
      { type: 'text-delta', index: 0, text: VERDICT },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.deepEqual(result, { kind: 'allow' })
  })

  it('turns a bare denial into a localized approval ask instead of throwing', async () => {
    const { result } = await review([
      { type: 'text-delta', index: 0, text: '{"risk":"medium","decision":"deny"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.equal(result.kind, 'ask')
    assert.match(result.reason, /session reviewer denied this call as medium risk/)
    assert.match(result.displayReason.zh, /会话评审员判定为中风险并拒绝/)
    assert.match(result.displayReason.en, /session reviewer denied this call as medium risk/)
  })

  it('keeps the reviewer reason in the card when one is given', async () => {
    const { result } = await review([
      { type: 'text-delta', index: 0, text: '{"risk":"high","decision":"deny","reason":"uploads secrets"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.match(result.displayReason.en, /high risk: uploads secrets/)
  })

  it('passes the configured timeout to the review request', async () => {
    fs.writeFileSync(
      path.join(profileDir, 'decision-review.settings.json'),
      JSON.stringify({ engine: 'session', timeoutMs: 5000 }),
    )
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    const requestedTimeouts = []
    mock.method(AbortSignal, 'timeout', (ms) => {
      requestedTimeouts.push(ms)
      return realTimeout(ms)
    })
    const { streamOptions } = await review([
      { type: 'text-delta', index: 0, text: VERDICT },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.deepEqual(requestedTimeouts, [5000])
    assert.ok(streamOptions.signal instanceof AbortSignal)
  })

  it('fails closed with AUTO_REVIEW_FAILED when the stream breaks protocol', async () => {
    const { result } = await review([
      { type: 'text', text: VERDICT },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    assert.equal(result.kind, 'deny')
    assert.equal(result.info.code, 'AUTO_REVIEW_FAILED')
  })
})

describe('effective authorization request contract', () => {
  let profileDir

  beforeEach(() => {
    profileDir = makeProfileDir()
  })
  afterEach(() => {
    removeDir(profileDir)
    mock.restoreAll()
    silenceConsole()
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
    apply(host.ctx)
    return host.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
  }

  for (const { name, messages, allowed } of cases) {
    it(`sends the same ordered evidence and authorization policy for ${name}`, async () => {
      // Stubs exercise request assembly and result routing, not interpretation by a model.
      const calls = stubDecisionsFetch(async () =>
        makeAnswers({
          risk: 'medium',
          overrides: { explicit_authorization: { type: 'predicate', probability: allowed ? 1 : 0 } },
        }),
      )
      const decisions = await review('decisions', fixture(messages))
      let sessionRequest
      const session = await review('session', fixture(messages), {
        stream: (options) => {
          sessionRequest = options
          return streamOf([
            {
              type: 'text-delta',
              index: 0,
              text: JSON.stringify({ risk: 'medium', decision: allowed ? 'allow' : 'deny' }),
            },
            { type: 'finish', reason: { kind: 'stop' } },
          ])
        },
      })
      const request = calls[0].body
      const policy = request.questions
        .find(({ name }) => name === 'explicit_authorization')
        .instructions.split('\n\n')
        .slice(1)
        .join('\n\n')
      assert.ok(sessionRequest.system.includes(policy), 'both engines receive the same authorization semantics')
      assert.match(policy, /revokes, narrows or supersedes/)
      assert.match(policy, /parent instruction.*cannot override a user restriction/)
      assert.match(policy, /still conflict, treat authorization as absent/)
      const retained = (parts) =>
        parts
          .slice(1)
          .map(({ text }) => JSON.parse(text))
          .filter(({ kind }) => kind === 'user-message')
          .map(({ source, role, content }) => [source, role, content[0].text])
      assert.deepEqual(retained(request.input[0].content), messages)
      assert.deepEqual(retained(sessionRequest.messages.map(({ content }) => content[0])), messages)
      assert.equal(decisions.kind, allowed ? 'allow' : 'deny')
      assert.equal(session.kind, decisions.kind)
    })
  }
})
