import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { apply, isUnchosenMainSession } from '../index.js'
import { jsonRequest, makeHost, makeProfileDir, removeDir, silenceConsole } from './helpers.js'

silenceConsole()

describe('profile directory', () => {
  let hostProfile
  let envProfile
  const savedEnv = { dir: process.env.DSH_PROFILE_DIR, home: process.env.HOME }

  beforeEach(() => {
    hostProfile = makeProfileDir()
    envProfile = makeProfileDir()
  })
  afterEach(() => {
    removeDir(hostProfile)
    removeDir(envProfile)
    for (const [key, value] of [['DSH_PROFILE_DIR', savedEnv.dir], ['HOME', savedEnv.home]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    mock.restoreAll()
    silenceConsole()
  })

  async function saveModel(host) {
    apply(host.ctx)
    const route = host.routes.get('/api/decision-review/save')
    await route.fetch(jsonRequest('http://127.0.0.1/api/decision-review/save', { settings: { model: 'written-by-test' } }))
  }

  it('follows the host profile context rather than the desktop default', async () => {
    process.env.HOME = envProfile
    delete process.env.DSH_PROFILE_DIR
    await saveModel(makeHost({ profileContext: { name: 'custom', dir: hostProfile } }))
    assert.ok(fs.existsSync(path.join(hostProfile, 'decision-review.settings.json')))
    assert.equal(fs.existsSync(path.join(envProfile, '.dsh/profiles/desktop/decision-review.settings.json')), false)
  })

  it('uses DSH_PROFILE_DIR when the host offers no profile context', async () => {
    process.env.DSH_PROFILE_DIR = envProfile
    await saveModel(makeHost())
    assert.ok(fs.existsSync(path.join(envProfile, 'decision-review.settings.json')))
  })

  it('falls back to the legacy desktop profile under HOME', async () => {
    delete process.env.DSH_PROFILE_DIR
    process.env.HOME = envProfile
    const desktop = path.join(envProfile, '.dsh/profiles/desktop')
    fs.mkdirSync(desktop, { recursive: true })
    await saveModel(makeHost())
    assert.ok(fs.existsSync(path.join(desktop, 'decision-review.settings.json')))
  })
})

describe('new-session Auto default', () => {
  const main = { id: 's', header: { origin: 'main' } }
  const hostPin = [
    { type: 'permission/preset', payload: { preset: 'default' } },
    { type: 'approval/policy', payload: { policy: 'ask' } },
  ]

  describe('isUnchosenMainSession', () => {
    it('accepts an empty log and a log holding only the host’s own default pin', () => {
      assert.equal(isUnchosenMainSession(main, []), true)
      assert.equal(isUnchosenMainSession(main, hostPin), true)
      assert.equal(isUnchosenMainSession(main, undefined), true)
    })

    it('leaves a session alone once a second preset record shows a choice', () => {
      assert.equal(isUnchosenMainSession(main, [...hostPin, { type: 'permission/preset', payload: { preset: 'danger-full-access' } }]), false)
    })

    it('leaves sessions with history, a recorded Auto, or a parent alone', () => {
      assert.equal(isUnchosenMainSession(main, [...hostPin, { type: 'user/message', data: {} }]), false)
      assert.equal(isUnchosenMainSession(main, [{ type: 'permission/preset', payload: { preset: 'auto' } }]), false)
      assert.equal(isUnchosenMainSession({ id: 'c', header: { origin: 'subagent', parentSession: 'p' } }, []), false)
      assert.equal(isUnchosenMainSession({ id: 'c', header: { parentSession: 'p' } }, hostPin), false)
    })
  })

  describe('session/created listener', () => {
    let profileDir

    beforeEach(() => { profileDir = makeProfileDir() })
    afterEach(() => {
      removeDir(profileDir)
      mock.restoreAll()
      silenceConsole()
    })

    async function created(session, records) {
      const host = makeHost({ profileContext: { name: 'test', dir: profileDir }, sessionQuery: { listEvents: async () => records } })
      apply(host.ctx)
      host.listeners.get('session/created')(session)
      await new Promise((resolve) => setTimeout(resolve, 30))
      return host.presetCalls
    }

    it('selects Auto whether or not the host has already pinned its default', async () => {
      assert.deepEqual((await created(main, [])).map((call) => call.preset), ['auto'])
      assert.deepEqual((await created(main, hostPin)).map((call) => call.preset), ['auto'])
    })

    it('keeps a user-selected, reopened or delegated session as recorded', async () => {
      const chosen = [...hostPin, { type: 'permission/preset', payload: { preset: 'default' } }]
      assert.deepEqual(await created(main, chosen), [])
      assert.deepEqual(await created(main, [...hostPin, { type: 'user/message', data: {} }]), [])
      assert.deepEqual(await created({ id: 'c', header: { origin: 'subagent', parentSession: 'p' } }, hostPin), [])
    })

    it('stays inactive when the session indexer is missing', () => {
      const host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
      apply(host.ctx)
      assert.equal(host.listeners.has('session/created'), false)
    })
  })
})
