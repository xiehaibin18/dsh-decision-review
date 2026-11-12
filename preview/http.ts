import { createReviewApi } from '../src/client/api.js'
import type { PreviewSession, SceneId } from './scenes.js'

export interface ActiveSession extends PreviewSession {
  api: ReturnType<typeof createReviewApi>
}

async function request<T>(path: string, method: 'POST' | 'DELETE', body?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload
}

export async function createSession(scene: SceneId): Promise<ActiveSession> {
  const session = await request<PreviewSession>('/api/preview/sessions', 'POST', { scene })
  return { ...session, api: createReviewApi(`/api/preview/sessions/${session.id}/decision-review`) }
}

export async function deleteSession(session: PreviewSession) {
  await request(`/api/preview/sessions/${session.id}`, 'DELETE')
}

export async function recoverSession(session: PreviewSession) {
  await request(`/api/preview/sessions/${session.id}/recover`, 'POST', {})
}
