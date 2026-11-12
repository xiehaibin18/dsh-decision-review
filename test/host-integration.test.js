import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { apply } from '../dist/index.js'
import {
  jsonRequest,
  makeExec,
  makeHost,
  makeProfileDir,
  makeSession,
  removeDir,
  silenceConsole,
  waitForAbort,
} from './helpers.js'

describe('profile directory', () => {
  let hostProfile
  let envProfile
  let savedEnv

  beforeEach(() => {
    savedEnv = ['DSH_PROFILE_DIR', 'HOME'].map((key) => [key, process.env[key]])
    silenceConsole()
    hostProfile = makeProfileDir()
    envProfile = makeProfileDir()
  })
  afterEach(() => {
    mock.restore()
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (hostProfile) removeDir(hostProfile)
    if (envProfile) removeDir(envProfile)
  })

  async function saveModel(options) {
    const host = makeHost(options)
    try {
      apply(host.ctx)
      const route = host.routes.get('/api/decision-review/save')
      await expect(
        route.fetch(
          jsonRequest('http://127.0.0.1/api/decision-review/save', { settings: { model: 'written-by-test' } }),
        ),
      ).resolves.toHaveProperty('status', 200)
    } finally {
      await host.dispose()
    }
  }

  test('follows the host profile context rather than the desktop default', async () => {
    process.env.HOME = envProfile
    delete process.env.DSH_PROFILE_DIR
    await saveModel({ profileContext: { name: 'custom', dir: hostProfile } })
    expect(fs.existsSync(path.join(hostProfile, 'decision-review.settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(envProfile, '.dsh/profiles/desktop/decision-review.settings.json'))).toBe(false)
  })

  test('uses DSH_PROFILE_DIR when the host offers no profile context', async () => {
    process.env.DSH_PROFILE_DIR = envProfile
    await saveModel()
    expect(fs.existsSync(path.join(envProfile, 'decision-review.settings.json'))).toBe(true)
  })

  test('falls back to the legacy desktop profile under HOME', async () => {
    delete process.env.DSH_PROFILE_DIR
    process.env.HOME = envProfile
    const desktop = path.join(envProfile, '.dsh/profiles/desktop')
    fs.mkdirSync(desktop, { recursive: true })
    await saveModel()
    expect(fs.existsSync(path.join(desktop, 'decision-review.settings.json'))).toBe(true)
  })
})

describe('Auto preset lifecycle', () => {
  let profileDir
  let host

  beforeEach(() => {
    silenceConsole()
    profileDir = makeProfileDir()
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

  function mount(options = {}, beforeApply = () => {}) {
    host = makeHost({ profileContext: { name: 'test', dir: profileDir }, ...options })
    beforeApply(host.ctx)
    apply(host.ctx)
  }

  function sessionLog(id, header = { isSeeded: false }, events = []) {
    return {
      id,
      header,
      events,
      get seq() {
        return events.length
      },
      append(type, data) {
        events.push({ seq: this.seq, time: 0, type, data })
      },
    }
  }

  const workspacePin = () => [
    { seq: 0, time: 0, type: 'permission/preset', data: { preset: 'workspace-write' } },
    { seq: 1, time: 0, type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { seq: 2, time: 0, type: 'approval/policy', data: { policy: 'ask' } },
  ]

  // rc.1 publishes a read-only Session, runs setup, then serially announces
  // the writable Agent. The permission service's prepended listener fills
  // absent permission facts; Auto and an explicit setup choice are retained.
  function mountCreation() {
    mount(
      {
        setPreset(session, preset) {
          session.append('permission/preset', { preset })
          session.append('sandbox/mode', { mode: 'danger-full-access' })
        },
      },
      (ctx) => {
        ctx.effect(() =>
          ctx.on(
            'agent/created',
            ({ agent: { session } }) => {
              for (const { type, data } of workspacePin()) {
                if (!session.events.some((event) => event.type === type)) session.append(type, data)
              }
            },
            { prepend: true },
          ),
        )
      },
    )
  }

  async function created(session, { source = 'startup', setup, signal } = {}) {
    const before = structuredClone(session.events)
    await host.emit('session/created', session)
    expect(session.events).toStrictEqual(before)
    setup?.(session)
    await host.emit('agent/created', { agent: { id: session.id, session }, source, signal })
  }

  test('selects Auto before the host default on a fresh main session without the query service', async () => {
    mountCreation()
    const session = sessionLog('fresh-main')
    await created(session)
    expect(host.presetCalls).toStrictEqual([{ session, preset: 'auto' }])
    expect(session.events.map(({ type, data }) => [type, data])).toStrictEqual([
      ['permission/preset', { preset: 'auto' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'ask' }],
    ])
  })

  test('preserves an explicit setup choice even if it matches the host default pin', async () => {
    mountCreation()
    const session = sessionLog('chosen-main')
    await created(session, {
      setup: (live) => {
        for (const { type, data } of workspacePin()) live.append(type, data)
      },
    })
    expect(session.events).toStrictEqual(workspacePin())
    expect(host.presetCalls).toStrictEqual([])
  })

  test.each(['resume', 'startup'])(
    'keeps a %s session with an end-seed marker at the host fallback',
    async (source) => {
      mountCreation()
      const seed = { seq: 0, time: 0, type: 'session/end-seed', data: {} }
      const session = sessionLog(source, undefined, [seed])
      await created(session, { source })
      expect(session.events.map(({ type, data }) => [type, data])).toStrictEqual([
        [seed.type, seed.data],
        ...workspacePin().map(({ type, data }) => [type, data]),
      ])
      expect(host.presetCalls).toHaveLength(0)
    },
  )

  test.each([
    ['child', { origin: 'subagent', parentSession: 'p', isSeeded: false }, {}],
    ['historical fork', { parentSession: 'p', isSeeded: false }, {}],
    ['inherited', { isSeeded: true }, {}],
    ['resumed', undefined, { source: 'resume' }],
    ['aborted', undefined, { signal: AbortSignal.abort() }],
  ])('does not change permission for a %s session', async (name, header, options) => {
    mountCreation()
    await created(sessionLog(name, header), options)
    expect(host.presetCalls).toHaveLength(0)
  })

  test('contributes localized descriptions for Auto and its confirmation', () => {
    mount()
    const { description, confirmationDescription } = host.autoPresentation
    for (const locale of ['en', 'zh']) {
      expect(description[locale].length).toBeGreaterThan(0)
      expect(confirmationDescription[locale]).toContain('Decisions')
    }
    expect(confirmationDescription.en).toMatch(/endpoint.*model/i)
    expect(confirmationDescription.en).toMatch(/session.*(?:route|model)/i)
    expect(confirmationDescription.zh).toMatch(/地址.*模型|端点.*模型/)
    expect(confirmationDescription.zh).toMatch(/会话.*(?:路由|模型)/)
  })

  test('migrates only live Auto sessions before unregistering the integration on hot removal', async () => {
    const auto = sessionLog('auto')
    const childAuto = sessionLog('child-auto', { origin: 'subagent', parentSession: auto.id })
    const other = sessionLog('other')
    mount({
      sessions: [auto, other, childAuto],
      currentPreset: (session) => (session === other ? 'workspace-write' : 'auto'),
      setPreset: () => expect(host.autoRegistered).toBe(true),
    })
    await host.dispose()
    expect(host.presetCalls).toStrictEqual(
      [auto, childAuto].map((session) => ({ session, preset: 'danger-full-access' })),
    )
    expect(host.autoRegistered).toBe(false)
    expect(host.listeners.has('tools/pre-execute')).toBe(false)
    expect(host.listeners.has('agent/created')).toBe(false)
    expect(host.routes.size).toBe(0)
  })

  test('preserves live Auto pins while the root is unloading', async () => {
    const auto = sessionLog('auto')
    mount({ sessions: [auto] })
    host.ctx.root.fiber.state = 5 // Cordis FiberState.UNLOADING
    await host.dispose()
    expect(host.presetCalls).toStrictEqual([])
    expect(host.autoRegistered).toBe(false)
  })

  test('cancels and drains a pending review before disposal returns', async () => {
    mount()
    const started = Promise.withResolvers()
    const aborted = Promise.withResolvers()
    const releaseUpstream = Promise.withResolvers()
    const fetchDecisions = spyOn(globalThis, 'fetch').mockImplementation(async (_url, { signal }) => {
      started.resolve(signal)
      try {
        await waitForAbort(signal)
      } finally {
        aborted.resolve()
        await releaseUpstream.promise
      }
    })
    const downstream = mock(async () => ({ kind: 'allow' }))
    const review = host.listeners.get('tools/pre-execute')(makeExec(makeSession()), downstream)
    const signal = await started.promise
    const disposed = mock()
    const disposing = host.dispose().then(disposed)
    try {
      await aborted.promise
      await new Promise((resolve) => setImmediate(resolve))
      expect(signal.aborted).toBe(true)
      expect(disposed).not.toHaveBeenCalled()
    } finally {
      releaseUpstream.resolve()
      await disposing
    }
    await expect(review).resolves.toStrictEqual({ kind: 'cancel' })
    expect(fetchDecisions).toHaveBeenCalledTimes(1)
    expect(downstream).not.toHaveBeenCalled()
  }, 2000)
})
