import { spyOn } from 'bun:test'

export * from './fixtures.js'

/** Keep plugin log lines out of test output. */
export function silenceConsole() {
  spyOn(console, 'info').mockImplementation(() => {})
  return spyOn(console, 'warn').mockImplementation(() => {})
}

/** Stub the Decisions endpoint and expose its calls through a fetch spy. */
export function stubDecisionsFetch(answersFor) {
  const fetchDecisions = spyOn(globalThis, 'fetch')
  return fetchDecisions.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body)
    const answers = await answersFor(body, init, fetchDecisions.mock.calls.length)
    return new Response(JSON.stringify({ answers }), { headers: { 'content-type': 'application/json' } })
  })
}
