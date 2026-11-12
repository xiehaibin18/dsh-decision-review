import {
  API_BASE,
  SETTINGS_ISSUE_CODES,
  type ConfigResponse,
  type ReviewStats,
  type SaveResponse,
  type SettingsIssue,
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
  issue?: SettingsIssue
}

export function createReviewApi(base = API_BASE): ReviewApi {
  return {
    loadConfig: (signal) => requestSettings<ConfigResponse>(base + '/config', signal),
    saveSettings: (settings, signal) => requestSettings<SaveResponse>(base + '/save', signal, { settings }),
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

async function requestSettings<T extends ConfigResponse | SaveResponse>(
  url: string,
  signal: AbortSignal,
  body?: object,
): Promise<T> {
  const payload = await requestJson<T>(url, signal, body)
  if (!Array.isArray(payload?.problems)) throw new Error('Invalid settings response')
  const problems = payload.problems.map((value) => {
    const issue = readSettingsIssue(value)
    if (!issue) throw new Error('Invalid settings issue in response')
    return issue
  })
  return { ...payload, problems }
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
  if (!res.ok) {
    const detail = isRecord(payload) && typeof payload.error === 'string' ? payload.error : undefined
    const issue = isRecord(payload) ? readSettingsIssue(payload.issue) : undefined
    throw new ResponseError(res.status, detail, issue)
  }
  return payload as T
}

class ResponseError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
    readonly issue?: SettingsIssue,
  ) {
    super(detail)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readSettingsIssue(value: unknown): SettingsIssue | undefined {
  if (!isRecord(value)) return
  const code = SETTINGS_ISSUE_CODES.find((code) => code === value.code)
  if (code === undefined) return
  if (value.params === undefined) return { code }
  if (!isRecord(value.params)) return
  const entries = Object.entries(value.params).filter(
    (entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
  )
  if (entries.length !== Object.keys(value.params).length) return
  return { code, params: Object.fromEntries(entries) }
}

export function reportError(key: ApiErrorKey, error: unknown): ApiError {
  if (error instanceof ResponseError) return { key, status: error.status, detail: error.detail, issue: error.issue }
  return { key, detail: error instanceof Error ? error.message : String(error) }
}
