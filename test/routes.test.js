import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { apply } from '../dist/index.js'
import {
  jsonRequest,
  makeAnswers,
  makeExec,
  makeHost,
  makeProfileDir,
  makeSession,
  removeDir,
  silenceConsole,
  stubDecisionsFetch,
  waitForAbort,
} from './helpers.js'

const SECRET = 'sk-test-secret-value'
const BASE = 'http://127.0.0.1:3080/api/decision-review'
const INVALID_ROUTE = {
  endpoint: [
    null,
    false,
    12,
    [],
    {},
    ' ',
    '/v1/decisions',
    'https:',
    'http:///example.test',
    'ftp://example.test',
    'https://user:password@example.test',
  ],
  model: [null, false, 12, [], {}, ' '],
}

describe('Connection routes', () => {
  let profileDir
  let host
  let settingsFile

  beforeEach(() => {
    silenceConsole()
    profileDir = makeProfileDir()
    settingsFile = path.join(profileDir, 'decision-review.settings.json')
    fs.writeFileSync(settingsFile, JSON.stringify({ apiKey: SECRET, model: 'model-a' }))
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
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

  const call = (route, request) => host.routes.get(`/api/decision-review/${route}`).fetch(request)
  const stored = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

  test('mounts buffered Connection routes, with writes limited to POST', () => {
    const mounted = Object.fromEntries([...host.routes].map(([routePath, route]) => [routePath, route.methods]))
    expect(mounted).toStrictEqual({
      '/api/decision-review/config': ['GET'],
      '/api/decision-review/save': ['POST'],
      '/api/decision-review/stats': ['GET'],
      '/api/decision-review/pending': ['GET'],
      '/api/decision-review/test': ['POST'],
    })
    for (const route of host.routes.values()) expect(route.requestBody).toBe('buffered')
  })

  test('never returns the stored API key', async () => {
    const response = await call('config', new Request(`${BASE}/config`))
    const text = await response.text()
    expect(text).not.toContain(SECRET)
    const payload = JSON.parse(text)
    expect(payload.settings).toMatchObject({ hasApiKey: true, model: 'model-a' })
    expect(payload.settings).not.toHaveProperty('apiKey')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test.each([
    ['omits', { model: 'model-b' }],
    ['blanks', { model: 'model-c', apiKey: '' }],
  ])('keeps the stored key when a save %s it', async (_action, update) => {
    const response = await call('save', jsonRequest(`${BASE}/save`, { settings: update }))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.settings.hasApiKey).toBe(true)
    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(stored()).toMatchObject({ apiKey: SECRET, model: update.model })
  })

  test('replaces and clears the key on request', async () => {
    await call('save', jsonRequest(`${BASE}/save`, { settings: { apiKey: 'sk-new' } }))
    expect(stored().apiKey).toBe('sk-new')
    const cleared = await (await call('save', jsonRequest(`${BASE}/save`, { settings: { clearApiKey: true } }))).json()
    expect(stored().apiKey).toBe('')
    expect(cleared.settings.hasApiKey).toBe(false)
  })

  test('rejects a bad save with a 4xx and leaves the stored settings alone', async () => {
    const before = fs.readFileSync(settingsFile, 'utf8')
    const badRule = await call(
      'save',
      jsonRequest(`${BASE}/save`, { settings: { rules: [{ verdict: 'permit', condition: 'x' }] } }),
    )
    expect(badRule.status).toBe(400)
    expect((await badRule.json()).error).toMatch(/rule 1/)
    const badTimeout = await call('save', jsonRequest(`${BASE}/save`, { settings: { timeoutMs: 5000.5 } }))
    expect(badTimeout.status).toBe(400)
    const noBody = await call('save', jsonRequest(`${BASE}/save`, {}))
    expect(noBody.status).toBe(400)
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(before)
  })

  test.each(Object.entries(INVALID_ROUTE).flatMap(([field, values]) => values.map((value) => [field, value])))(
    'rejects %s=%j without changing the saved route',
    async (field, value) => {
      const before = fs.readFileSync(settingsFile, 'utf8')
      const response = await call('save', jsonRequest(`${BASE}/save`, { settings: { [field]: value } }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain(field)
      expect(fs.readFileSync(settingsFile, 'utf8')).toBe(before)
    },
  )

  test('preserves the exact condition text in a save and a subsequent config read', async () => {
    const condition = '  deploys to production\n\n  with affected services listed\n '
    const rules = [{ condition, verdict: 'allow_if_requested' }]
    const response = await call('save', jsonRequest(`${BASE}/save`, { settings: { rules } }))
    expect(response.status).toBe(200)
    expect((await response.json()).settings.rules).toStrictEqual(rules)
    expect(stored().rules).toStrictEqual(rules)
    const payload = await (await call('config', new Request(`${BASE}/config`))).json()
    expect(payload.settings.rules).toStrictEqual(rules)
  })

  test('requires a JSON body on writes', async () => {
    const plain = new Request(`${BASE}/save`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ settings: { model: 'x' } }),
    })
    expect((await call('save', plain)).status).toBe(415)
    const broken = new Request(`${BASE}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect((await call('save', broken)).status).toBe(400)
    const oversized = jsonRequest(`${BASE}/save`, { settings: { model: 'x'.repeat(70000) } })
    expect((await call('save', oversized)).status).toBe(413)
    expect(stored().model).toBe('model-a')
  })

  test('serves per-session stats and demands a session id', async () => {
    expect((await call('stats', new Request(`${BASE}/stats`))).status).toBe(400)
    const payload = await (await call('stats', new Request(`${BASE}/stats?session=session-abc`))).json()
    expect(payload.reviewed).toBe(0)
    expect(payload.passRate).toBe(null)
  })

  describe('smoke test', () => {
    test.each([[['typo']], [['allow', 'allow']], [[]], ['allow']])(
      'rejects invalid scenarios %j',
      async (scenarios) => {
        await expect(call('test', jsonRequest(`${BASE}/test`, { scenarios }))).resolves.toHaveProperty('status', 400)
      },
    )

    test('runs all three scenarios against one settings snapshot even if a save lands mid-run', async () => {
      const fetchDecisions = stubDecisionsFetch(async (_body, _init, count) => {
        if (count === 1) await call('save', jsonRequest(`${BASE}/save`, { settings: { model: 'model-after-save' } }))
        return makeAnswers()
      })
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, {}))).json()
      expect(payload.results).toHaveLength(3)
      expect(fetchDecisions).toHaveBeenCalledTimes(3)
      expect(fetchDecisions.mock.calls.map(([, { body }]) => JSON.parse(body).model)).toStrictEqual([
        'model-a',
        'model-a',
        'model-a',
      ])
      expect(stored().model).toBe('model-after-save')
    })

    test('passes an already-aborted caller signal to every upstream request', async () => {
      const fetchDecisions = spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => waitForAbort(signal))
      const caller = new AbortController()
      caller.abort()
      const response = await call('test', jsonRequest(`${BASE}/test`, {}, { signal: caller.signal }))
      expect(fetchDecisions).toHaveBeenCalled()
      for (const [, { signal }] of fetchDecisions.mock.calls) expect(signal.aborted).toBe(true)
      const payload = await response.json()
      expect(payload.results).toHaveLength(3)
      for (const result of payload.results) expect(result.ok).toBe(false)
    })

    test('cancels an in-flight upstream request when the caller disconnects', async () => {
      const started = Promise.withResolvers()
      const fetchDecisions = spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => {
        started.resolve(signal)
        return waitForAbort(signal)
      })
      const caller = new AbortController()
      const request = jsonRequest(`${BASE}/test`, { scenarios: ['allow'] }, { signal: caller.signal })
      const pending = call('test', request)
      const signal = await started.promise
      expect(signal.aborted).toBe(false)
      caller.abort(new Error('caller disconnected'))
      const response = await pending
      expect(fetchDecisions).toHaveBeenCalledTimes(1)
      expect(signal.aborted).toBe(true)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        results: [{ scenario: 'allow', ok: false, error: 'caller disconnected' }],
      })
    })

    test('reports an upstream failure as a row instead of failing the whole run', async () => {
      spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, { scenarios: ['allow'] }))).json()
      expect(payload.results[0].ok).toBe(false)
      expect(payload.results[0].error).toMatch(/HTTP 401/)
    })

    test('reports a denial basis without inviting the reader to approve the smoke-test action', async () => {
      stubDecisionsFetch(() => makeAnswers({ risk: 'high' }))
      const payload = await (await call('test', jsonRequest(`${BASE}/test`, { scenarios: ['exfil'] }))).json()
      const { composed } = payload.results[0]
      expect(composed.decision).toBe('deny')
      expect(composed.display.en).toMatch(/high risk/)
      expect(composed.display.zh).toMatch(/高风险/)
      expect(composed.display.en).not.toMatch(/requests your approval/)
      expect(composed.display.zh).not.toMatch(/请你确认/)
    })
  })

  test('returns pending review context with no-store and requires session and matching callId', async () => {
    const missing = await call('pending', new Request(`${BASE}/pending`))
    expect(missing.status).toBe(400)
    const missingCall = await call('pending', new Request(`${BASE}/pending?session=session-abc`))
    expect(missingCall.status).toBe(200)
    expect(missingCall.headers.get('cache-control')).toBe('no-store')
    await expect(missingCall.json()).resolves.toStrictEqual({ pending: null })
    const empty = await call('pending', new Request(`${BASE}/pending?session=session-abc&callId=c1`))
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toStrictEqual({ pending: null })
  })

  test('exposes pending review only while approval/request is active, including hot-load prepending and abort/never paths', async () => {
    stubDecisionsFetch(() =>
      makeAnswers({
        risk: 'medium',
        overrides: {
          security_change: { type: 'predicate', probability: 0.91 },
          explicit_authorization: { type: 'predicate', probability: 0.12 },
        },
      }),
    )
    const session = makeSession('pending-life')
    const exec = makeExec(session)
    const preExecute = host.listeners.get('tools/pre-execute')
    const decision = await preExecute(exec, async () => ({ kind: 'allow' }))
    expect(decision.kind).toBe('ask')

    // Staged in pre-execute, but NOT publicly exposed before `approval/request` begins.
    const beforeApproval = await (
      await call('pending', new Request(`${BASE}/pending?session=session-${session.id}&callId=${exec.callId}`))
    ).json()
    expect(beforeApproval).toStrictEqual({ pending: null })

    // Published while `approval/request` is awaiting a decision, keyed by callId, and cleared on exit.
    let activeDuringApproval = null
    let mismatchedDuringApproval = null
    const outcome = await host.waterfall(
      'approval/request',
      { agent: { session }, toolName: 'bash', callId: exec.callId },
      async () => {
        mismatchedDuringApproval = await (
          await call('pending', new Request(`${BASE}/pending?session=session-${session.id}&callId=other-call`))
        ).json()
        activeDuringApproval = await (
          await call('pending', new Request(`${BASE}/pending?session=session-${session.id}&callId=${exec.callId}`))
        ).json()
        return 'allowed-once'
      },
    )
    expect(outcome).toBe('allowed-once')
    expect(mismatchedDuringApproval).toStrictEqual({ pending: null })
    expect(activeDuringApproval.pending).toMatchObject({
      callId: exec.callId,
      tool: 'bash',
      isPtcInner: false,
      risk: 'medium',
      action: { kind: 'command', detail: 'npm test' },
      scores: {
        predicates: { security_change: 0.91, explicit_authorization: 0.12 },
      },
    })
    const settled = await (
      await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${exec.callId}`))
    ).json()
    expect(settled).toStrictEqual({ pending: null })

    // When host effective approval policy is `never`, `approval/request` is skipped;
    // `/pending` never leaks the call even while `tools/result` is delayed by an earlier parallel call.
    await preExecute(exec, async () => ({ kind: 'allow' }))
    const duringNeverDelay = await (
      await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${exec.callId}`))
    ).json()
    expect(duringNeverDelay).toStrictEqual({ pending: null })
    await host.emit('tools/result', exec, { isError: true, content: 'rejected' })
    let afterResultApproval = null
    await host.waterfall(
      'approval/request',
      { agent: { session }, toolName: 'bash', callId: exec.callId },
      async () => {
        afterResultApproval = await (
          await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${exec.callId}`))
        ).json()
        return 'rejected'
      },
    )
    expect(afterResultApproval).toStrictEqual({ pending: null })

    // Aborting the execution signal before approval clears the staged entry;
    // aborting the request signal during approval withdraws the active entry immediately.
    const preAbort = new AbortController()
    const abortedExec = makeExec(session, { signal: preAbort.signal })
    await preExecute(abortedExec, async () => ({ kind: 'allow' }))
    preAbort.abort()
    let afterPreAbort = null
    await host.waterfall(
      'approval/request',
      { agent: { session }, toolName: 'bash', callId: abortedExec.callId },
      async () => {
        afterPreAbort = await (
          await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${abortedExec.callId}`))
        ).json()
        return 'cancelled'
      },
    )
    expect(afterPreAbort).toStrictEqual({ pending: null })

    const liveExec = makeExec(session, { callId: 'call-live-abort' })
    await preExecute(liveExec, async () => ({ kind: 'allow' }))
    const reqAbort = new AbortController()
    let duringLive = null
    let afterLiveAbort = null
    await host.waterfall(
      'approval/request',
      { agent: { session }, toolName: 'bash', callId: liveExec.callId, signal: reqAbort.signal },
      async () => {
        duringLive = await (
          await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${liveExec.callId}`))
        ).json()
        reqAbort.abort()
        afterLiveAbort = await (
          await call('pending', new Request(`${BASE}/pending?session=${session.id}&callId=${liveExec.callId}`))
        ).json()
        return 'cancelled'
      },
    )
    expect(duringLive.pending?.callId).toBe(liveExec.callId)
    expect(afterLiveAbort).toStrictEqual({ pending: null })
  })

  test('prepends approval/request ahead of pre-existing remote answerers on hot-load', async () => {
    const hotDir = makeProfileDir()
    fs.writeFileSync(
      path.join(hotDir, 'decision-review.settings.json'),
      JSON.stringify({ apiKey: SECRET, model: 'model-a' }),
    )
    const hotHost = makeHost({ profileContext: { dir: hotDir } })
    let pendingDuringRemote = null
    let remoteResolvedOutcome = null
    // Simulate a Web host remote approval listener registered before the plugin is hot-loaded,
    // which settles the waterfall directly without calling `next()`.
    hotHost.ctx.on('approval/request', async (req) => {
      const route = hotHost.routes.get('/api/decision-review/pending')
      pendingDuringRemote = await (
        await route.fetch(new Request(`${BASE}/pending?session=${req.agent.session.id}&callId=${req.callId}`))
      ).json()
      remoteResolvedOutcome = 'allowed-once'
      return remoteResolvedOutcome
    })
    try {
      apply(hotHost.ctx)
      stubDecisionsFetch(() =>
        makeAnswers({
          risk: 'medium',
          overrides: {
            security_change: { type: 'predicate', probability: 0.91 },
            explicit_authorization: { type: 'predicate', probability: 0.12 },
          },
        }),
      )
      const session = makeSession('hotload-session')
      const exec = makeExec(session)
      const preExecute = hotHost.listeners.get('tools/pre-execute')
      expect((await preExecute(exec, async () => ({ kind: 'allow' }))).kind).toBe('ask')

      const outcome = await hotHost.waterfall('approval/request', {
        agent: { session },
        toolName: 'bash',
        callId: exec.callId,
      })
      expect(outcome).toBe('allowed-once')
      expect(pendingDuringRemote.pending?.callId).toBe(exec.callId)

      // Cleared immediately after remote answerer returns (before tool execution completes).
      const pendingRoute = hotHost.routes.get('/api/decision-review/pending')
      const afterApproval = await (
        await pendingRoute.fetch(new Request(`${BASE}/pending?session=${session.id}&callId=${exec.callId}`))
      ).json()
      expect(afterApproval).toStrictEqual({ pending: null })
    } finally {
      await hotHost.dispose()
      removeDir(hotDir)
    }
  })

  test('includes explicit bash workdir in pending action summary and fallback approval prompt', async () => {
    stubDecisionsFetch(() =>
      makeAnswers({
        risk: 'medium',
        overrides: {
          production_effect: { type: 'predicate', probability: 0.89 },
          explicit_authorization: { type: 'predicate', probability: 0.1 },
        },
      }),
    )
    const preExecute = host.listeners.get('tools/pre-execute')
    const bashArgs = { command: 'rm -rf ./dist', workdir: '/srv/prod/app' }
    const rawBashArgs = JSON.stringify(bashArgs)
    const baseSession = makeSession('bash-workdir')
    const topEvents = baseSession.snapshotEvents().map((event) => {
      if (event.type === 'assistant/message') {
        return {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              content: event.data.message.content.map((block) =>
                block.type === 'tool-call' ? { ...block, name: 'bash', arguments: rawBashArgs } : block,
              ),
            },
          },
        }
      }
      if (event.type === 'tool/call') {
        return { ...event, data: { ...event.data, name: 'bash', arguments: rawBashArgs } }
      }
      return event
    })
    const topSession = { ...baseSession, snapshotEvents: () => topEvents }

    // Top-level bash with explicit workdir: host natively shows command, fallback adds workdir.
    const topExec = makeExec(topSession, { arguments: bashArgs })
    const topDecision = await preExecute(topExec, async () => ({ kind: 'allow' }))
    expect(topDecision.kind).toBe('ask')
    expect(topDecision.displayReason.en).toContain('Working directory: /srv/prod/app')
    expect(topDecision.displayReason.zh).toContain('工作目录：/srv/prod/app')
    expect(topDecision.displayReason.en).not.toContain('Pending call:')

    let topPending = null
    await host.waterfall(
      'approval/request',
      { agent: { session: topSession }, toolName: 'bash', callId: topExec.callId },
      async () => {
        topPending = await (
          await call('pending', new Request(`${BASE}/pending?session=${topSession.id}&callId=${topExec.callId}`))
        ).json()
        return 'rejected'
      },
    )
    expect(topPending.pending.action).toStrictEqual({
      kind: 'command',
      workdir: '/srv/prod/app',
      detail: 'rm -rf ./dist',
    })

    // PTC inner bash with explicit workdir: fallback includes both command and workdir.
    const ptcEvents = [
      ...baseSession.snapshotEvents().map((event) => {
        if (event.type === 'assistant/message') {
          return {
            ...event,
            data: {
              ...event.data,
              message: {
                ...event.data.message,
                content: event.data.message.content.map((block) =>
                  block.type === 'tool-call' ? { ...block, name: 'run_code', arguments: '{"code":"bash()"}' } : block,
                ),
              },
            },
          }
        }
        if (event.type === 'tool/call') {
          return { ...event, data: { ...event.data, name: 'run_code', arguments: '{"code":"bash()"}' } }
        }
        return event
      }),
      {
        seq: 4,
        type: 'tool/ptc-dispatch-start',
        data: {
          parentCallId: 'call-1',
          rootCallId: 'call-1',
          subCallId: 'call-ptc-inner',
          name: 'bash',
          arguments: bashArgs,
        },
      },
    ]
    const ptcSession = {
      ...baseSession,
      id: 'bash-workdir-ptc',
      snapshotEvents: () => ptcEvents,
    }
    const ptcExec = makeExec(ptcSession, {
      callId: 'call-ptc-inner',
      rootCallId: 'call-1',
      parent: { callId: 'call-1' },
      arguments: bashArgs,
      schema: { name: 'bash', description: 'Run a command.', parameters: { type: 'object' } },
    })
    const ptcDecision = await preExecute(ptcExec, async () => ({ kind: 'allow' }))
    expect(ptcDecision.kind).toBe('ask')
    expect(ptcDecision.displayReason.en).toContain('Pending call: bash rm -rf ./dist\nWorking directory: /srv/prod/app')
    expect(ptcDecision.displayReason.zh).toContain('待评审的调用：bash rm -rf ./dist\n工作目录：/srv/prod/app')
  })

  test('preserves edit old_string, new_string, and replace_all in pending summary and fallback prompt', async () => {
    stubDecisionsFetch(() =>
      makeAnswers({
        risk: 'medium',
        overrides: {
          irreversible_deletion: { type: 'predicate', probability: 0.88 },
          explicit_authorization: { type: 'predicate', probability: 0.1 },
        },
      }),
    )
    const editArgs = {
      file_path: 'config/security.yml',
      old_string: 'require_mfa: true\n',
      new_string: '',
      replace_all: true,
    }
    const baseSession = makeSession('edit-session')
    const rawArgs = JSON.stringify(editArgs)
    const editEvents = baseSession.snapshotEvents().map((event) => {
      if (event.type === 'assistant/message') {
        return {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              content: event.data.message.content.map((block) =>
                block.type === 'tool-call' ? { ...block, name: 'edit', arguments: rawArgs } : block,
              ),
            },
          },
        }
      }
      if (event.type === 'tool/call') {
        return { ...event, data: { ...event.data, name: 'edit', arguments: rawArgs } }
      }
      return event
    })
    const editSession = {
      ...baseSession,
      snapshotEvents: () => editEvents,
      requestHeader: () => ({
        ...baseSession.requestHeader(),
        tools: [{ name: 'edit', description: 'Edit a file', parameters: { type: 'object' } }],
      }),
    }
    const exec = makeExec(editSession, { name: 'edit', arguments: editArgs })
    const preExecute = host.listeners.get('tools/pre-execute')
    const decision = await preExecute(exec, async () => ({ kind: 'allow' }))
    expect(decision.kind).toBe('ask')
    expect(decision.displayReason.en).toContain('edit config/security.yml (delete 18 characters, replace all matches)')
    expect(decision.displayReason.zh).toContain('edit config/security.yml（删除 18 个字符，替换全部匹配）')

    let active = null
    await host.waterfall(
      'approval/request',
      { agent: { session: editSession }, toolName: 'edit', callId: exec.callId },
      async () => {
        active = await (
          await call('pending', new Request(`${BASE}/pending?session=${editSession.id}&callId=${exec.callId}`))
        ).json()
        return 'rejected'
      },
    )
    expect(active.pending.action).toStrictEqual({
      kind: 'file',
      target: 'config/security.yml',
      edit: {
        oldText: 'require_mfa: true\n',
        oldChars: 18,
        newText: '',
        newChars: 0,
        replaceAll: true,
      },
    })
  })
})
