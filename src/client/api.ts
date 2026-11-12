import {
  API_BASE,
  type ConfigResponse,
  type ReviewStats,
  type SaveResponse,
  type SettingsUpdate,
  type TestResponse,
} from '../shared/contracts.js'

export interface ReviewApi {
  loadConfig(signal: AbortSignal): Promise<ConfigResponse>
  saveSettings(settings: SettingsUpdate, signal: AbortSignal): Promise<SaveResponse>
  runSmokeTest(signal: AbortSignal): Promise<TestResponse>
  getStats(sessionId: string, signal: AbortSignal): Promise<ReviewStats | null>
}

type ApiErrorKey = 'load.error' | 'save.error' | 'test.error'

export interface ApiError {
  key: ApiErrorKey
  status?: number
  detail?: string
}

export function createReviewApi(base = API_BASE): ReviewApi {
  return {
    loadConfig: (signal) => requestJson(base + '/config', signal),
    saveSettings: (settings, signal) => requestJson(base + '/save', signal, { settings }),
    runSmokeTest: (signal) => requestJson(base + '/test', signal, {}),
    async getStats(sessionId, signal) {
      // The host may pass `session-<uuid>`. Trails are indexed by bare UUID.
      const id = sessionId.replace(/^session-/, '')
      const res = await fetch(base + '/stats?session=' + encodeURIComponent(id), { signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    },
  }
}

async function requestJson<T>(url: string, signal: AbortSignal, body?: object): Promise<T> {
  const init: RequestInit = { signal }
  if (body !== undefined) {
    init.method = 'POST'
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (typeof payload === 'object' && payload !== null && 'error' in payload && payload.error) {
    throw new Error(String(payload.error))
  }
  if (!res.ok) throw Object.assign(new Error(), { status: res.status })
  return payload as T
}

export function reportError(key: ApiErrorKey, error: unknown): ApiError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status
  ) {
    return { key, status: error.status }
  }
  return { key, detail: error instanceof Error ? error.message : String(error) }
}
