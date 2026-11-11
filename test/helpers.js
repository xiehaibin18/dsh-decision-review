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
  const effects = []
  const selected = new Map()
  let admitAuto
  let autoPresentation
  function effect(setup) {
    const result = setup()
    if (typeof result === 'function') effects.push(result)
    else {
      const disposers = [...result]
      effects.push(async () => {
        for (const dispose of disposers.reverse()) await dispose()
      })
    }
  }
  const ctx = {
    permissionPresets: {
      current: (session) => selected.get(session) ?? (typeof options.currentPreset === 'function' ? options.currentPreset(session) : options.currentPreset ?? 'auto'),
      set: (session, preset) => {
        if (preset === 'auto') {
          assertAutoRegistered()
          admitAuto()
        }
        options.setPreset?.(session, preset)
        selected.set(session, preset)
        presetCalls.push({ session, preset })
      },
      registerAuto: (admit, presentation) => {
        admitAuto = admit
        autoPresentation = presentation
        return () => { admitAuto = undefined }
      },
    },
    approval: { overrideOf: () => options.approvalOverride ?? 'ask' },
    workingDirectory: { ensure: async () => '/work' },
    llm: { stream: (streamOptions) => options.stream(streamOptions) },
    sessions: { list: () => options.sessions ?? [] },
    root: { fiber: { state: 2 } },
    effect,
    on(event, listener, { prepend = false } = {}) {
      const handlers = listeners.get(event) ?? []
      handlers[prepend ? 'unshift' : 'push'](listener)
      listeners.set(event, handlers)
      return () => {
        const index = handlers.indexOf(listener)
        if (index >= 0) handlers.splice(index, 1)
        if (handlers.length === 0) listeners.delete(event)
      }
    },
    get(key) {
      if (key === 'profileContext') return options.profileContext
      return undefined
    },
    inject(_dependencies, setup) {
      setup({
        effect,
        connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } } },
      })
    },
  }

  function assertAutoRegistered() {
    if (admitAuto === undefined) throw new Error('permission: Auto is not registered')
  }

  return {
    ctx,
    listeners: { get: (event) => listeners.get(event)?.[0], has: (event) => listeners.has(event) },
    routes,
    presetCalls,
    get autoRegistered() { return admitAuto !== undefined },
    get autoPresentation() { return autoPresentation },
    async emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) await listener(...args)
    },
    async dispose() {
      while (effects.length > 0) await effects.pop()()
    },
  }
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
