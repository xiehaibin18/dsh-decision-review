import { setTimeout as delay } from 'node:timers/promises'
import {
  TEST_SCENARIO_NAMES,
  type ConfigResponse,
  type SaveResponse,
  type SettingsIssue,
  type TestResponse,
} from '../src/shared/contracts.js'
import { isRecord } from '../src/server/json.js'
import {
  mergeSettingsUpdate,
  normalizeSettings,
  publicSettings,
  SettingsValidationError,
  type StoredSettings,
} from '../src/server/settings.js'
import { fixtureSettings, fixtureStats, fixtureTest } from './fixtures.js'
import { isSceneId, type PreviewSession } from './scenes.js'

interface FixtureSession extends PreviewSession {
  stored: StoredSettings
  recovered: boolean
  lifecycle: AbortController
}

class PreviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issue?: SettingsIssue,
  ) {
    super(message)
  }
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } })
}

async function readBody(request: Request) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    throw new PreviewError(415, 'content-type must be application/json')
  }
  const text = await request.text()
  if (text.length > 64 * 1024) throw new PreviewError(413, 'request body is too large')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new PreviewError(400, 'request body is not valid JSON')
  }
  if (!isRecord(body)) throw new PreviewError(400, 'request body must be a JSON object')
  return body
}

function requireMethod(request: Request, method: string) {
  if (request.method !== method) throw new PreviewError(405, `Use ${method}`)
}

/** One in-memory fixture per tab/scene. Disposing it cancels pending mutations before commit. */
export function createPreviewService() {
  const sessions = new Map<string, FixtureSession>()

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) throw new PreviewError(403, 'Preview requests must be same-origin')
    if (url.pathname === '/api/preview/sessions') {
      requireMethod(request, 'POST')
      const body = await readBody(request)
      if (!isSceneId(body.scene)) throw new PreviewError(400, 'Unknown preview scene')
      const session: FixtureSession = {
        id: crypto.randomUUID(),
        scene: body.scene,
        stored: fixtureSettings(body.scene),
        recovered: false,
        lifecycle: new AbortController(),
      }
      sessions.set(session.id, session)
      return json({ id: session.id, scene: session.scene } satisfies PreviewSession, 201)
    }

    const match =
      /^\/api\/preview\/sessions\/([^/]+)(?:\/(recover|decision-review\/(?:config|save|test|stats)))?$/.exec(
        url.pathname,
      )
    if (!match) throw new PreviewError(404, 'Unknown preview route')
    const session = sessions.get(match[1])
    if (!session) throw new PreviewError(404, 'Preview session expired; reload or reset the scene')
    const route = match[2]
    if (!route) {
      requireMethod(request, 'DELETE')
      session.lifecycle.abort()
      sessions.delete(session.id)
      return json({ ok: true })
    }
    if (route === 'recover') {
      requireMethod(request, 'POST')
      await readBody(request)
      session.recovered = true
      return json({ ok: true })
    }

    const operation = route.slice('decision-review/'.length)
    requireMethod(request, operation === 'config' || operation === 'stats' ? 'GET' : 'POST')
    const body = request.method === 'POST' ? await readBody(request) : undefined
    const signal = AbortSignal.any([request.signal, session.lifecycle.signal])
    // Snapshot the operation's settings and fault at dispatch, matching an in-flight HTTP request.
    const stored = session.stored
    const failing = !session.recovered && session.scene === `${operation === 'config' ? 'load' : operation}-error`
    await delay(session.scene === 'slow' ? (operation === 'stats' ? 1000 : 2000) : 120, undefined, { signal })
    signal.throwIfAborted()
    if (failing) throw new PreviewError(503, `Synthetic ${operation} failure`)

    switch (operation) {
      case 'config':
        return json({
          settings: publicSettings(stored.settings),
          problems: stored.problems.map(({ issue }) => issue),
          runtime: { engine: stored.settings.engine, accepting: true, active: 0, paused: stored.problems.length > 0 },
        } satisfies ConfigResponse)
      case 'save': {
        if (!isRecord(body?.settings)) throw new PreviewError(400, 'missing settings')
        let settings
        try {
          settings = normalizeSettings(mergeSettingsUpdate(stored.settings, body.settings), { strict: true })
        } catch (error) {
          if (!(error instanceof SettingsValidationError)) throw error
          throw new PreviewError(400, error.message, error.issue)
        }
        session.stored = { settings, problems: [], damaged: false }
        return json({ ok: true, settings: publicSettings(settings), problems: [] } satisfies SaveResponse)
      }
      case 'test': {
        const names = body?.scenarios === undefined ? TEST_SCENARIO_NAMES : body.scenarios
        if (
          !Array.isArray(names) ||
          names.length === 0 ||
          new Set(names).size !== names.length ||
          !names.every((name: unknown): name is (typeof TEST_SCENARIO_NAMES)[number] =>
            TEST_SCENARIO_NAMES.some((known) => known === name),
          )
        ) {
          throw new PreviewError(
            400,
            `scenarios must be a non-empty list of distinct names from: ${TEST_SCENARIO_NAMES.join(', ')}`,
          )
        }
        if (stored.problems.length > 0)
          throw new PreviewError(409, 'Fix the stored settings before testing the Decisions API', {
            code: 'stored_invalid',
          })
        return json({
          ok: true,
          results: names.map((name) => fixtureTest(stored.settings, name, session.scene === 'test-mixed')),
        } satisfies TestResponse)
      }
      case 'stats':
        if (!url.searchParams.get('session')) throw new PreviewError(400, 'missing session')
        return json(fixtureStats(session.scene))
      default:
        throw new PreviewError(404, 'Unknown preview operation')
    }
  }

  return {
    async fetch(request: Request) {
      try {
        return await handle(request)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
          return json({ error: 'Preview request cancelled' }, 499)
        return json(
          {
            error: error instanceof Error ? error.message : String(error),
            issue: error instanceof PreviewError ? error.issue : undefined,
          },
          error instanceof PreviewError ? error.status : 500,
        )
      }
    },
    dispose() {
      for (const session of sessions.values()) session.lifecycle.abort()
      sessions.clear()
    },
  }
}
