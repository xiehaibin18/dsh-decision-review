import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

/** Keep plugin log lines out of test output. */
export function silenceConsole() {
  mock.method(console, 'info', () => {})
  mock.method(console, 'warn', () => {})
}

export function makeProfileDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decision-review-test-'))
}

export function removeDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true })
}

/** A host double: records listeners, mounted Connection routes and preset writes. */
export function makeHost(options = {}) {
  const listeners = new Map()
  const routes = new Map()
  const presetCalls = []
  const ctx = {
    permissionPresets: {
      current: () => options.currentPreset ?? 'auto',
      set: (session, preset) => { presetCalls.push({ session, preset }) },
      registerAuto: () => () => {},
    },
    approval: { overrideOf: () => options.approvalOverride ?? 'ask' },
    workingDirectory: { ensure: async () => '/work' },
    llm: { stream: (streamOptions) => options.stream(streamOptions) },
    sessions: { list: () => [] },
    root: { fiber: { state: 'inactive' } },
    effect(setup) {
      const generator = setup()
      for (let step = generator.next(); !step.done; step = generator.next()) { /* disposers are not exercised */ }
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
    get(key) {
      if (key === 'profileContext') return options.profileContext
      if (key === 'sessionQuery') return options.sessionQuery
      return undefined
    },
    inject(_dependencies, setup) {
      setup({
        effect: (register) => register(),
        connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {} } } },
      })
    },
  }
  return { ctx, listeners, routes, presetCalls }
}

/** A session whose log holds one pending `bash` call, shaped like the host's. */
export function makeSession(id = 'test-session', header = { origin: 'main' }) {
  const args = JSON.stringify({ command: 'npm test' })
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user', rpcId: 'fixture' }, content: [{ type: 'text', text: 'Run tests.' }] } },
    { seq: 1, type: 'step/start', data: { turn: 0, step: 0 } },
    { seq: 2, type: 'assistant/message', data: { turn: 0, step: 0, message: { content: [{ type: 'tool-call', id: 'call-1', name: 'bash', arguments: args }] } } },
    { seq: 3, type: 'tool/call', data: { turn: 0, step: 0, callId: 'call-1', name: 'bash', arguments: args } },
  ]
  return {
    id,
    header,
    surface: { nodes: [0, 2] },
    snapshotEvents: () => events,
    requestHeader: () => ({ config: { provider: 'fixture', model: 'fixture' }, tools: [{ name: 'bash', description: 'Run a command.', parameters: { type: 'object' } }] }),
    isOwnSeq: () => true,
  }
}

export function makeExec(session, overrides = {}) {
  return {
    agent: { session },
    name: 'bash',
    arguments: { command: 'npm test' },
    callId: 'call-1',
    rootCallId: 'call-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

const PREDICATES = ['exfiltration', 'irreversible_deletion', 'production_effect', 'security_change', 'session_created_cleanup', 'explicit_authorization']

/** A complete, valid Decisions answer list; `overrides` patch single answers by name. */
export function makeAnswers({ risk = 'low', confidence = 0.95, probability = 0, overrides = {}, rule } = {}) {
  const answers = [{ name: 'risk_class', type: 'choice', choice: risk, confidence }]
  for (const name of PREDICATES) answers.push({ name, type: 'predicate', probability })
  if (rule !== undefined) answers.push({ name: 'operator_rule', type: 'choice', choice: rule.choice, confidence: rule.confidence ?? 0.95 })
  return answers.map((answer) => (overrides[answer.name] === undefined ? answer : { name: answer.name, ...overrides[answer.name] }))
}

/** Replace global fetch with a stub returning `answersFor(body, init)`; returns the call log. */
export function stubDecisionsFetch(answersFor) {
  const calls = []
  mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    return new Response(JSON.stringify({ answers: await answersFor(body, init, calls.length) }), { headers: { 'content-type': 'application/json' } })
  })
  return calls
}

export async function* streamOf(chunks) {
  yield* chunks
}

export function jsonRequest(url, body, { method = 'POST', headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
