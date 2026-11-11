import {
  API_BASE,
  type ConfigResponse,
  type SaveResponse,
  type SettingsUpdate,
  type TestResponse,
  type TestScenarioName,
} from '../shared/contracts.js'

type ApiErrorKey = 'load.error' | 'save.error' | 'test.error'

export interface ApiError {
  key: ApiErrorKey
  status?: number
  detail?: string
}

/** A body makes an authenticated, same-origin call a JSON POST. */
export function callApi(path: '/config'): Promise<ConfigResponse>
export function callApi(path: '/save', body: { settings: SettingsUpdate }): Promise<SaveResponse>
export function callApi(path: '/test', body: { scenarios?: TestScenarioName[] }): Promise<TestResponse>
export async function callApi(path: string, body?: object): Promise<unknown> {
  const res = await fetch(
    API_BASE + path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
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
  return payload
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
