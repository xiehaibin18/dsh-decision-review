import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

/* The client half is a browser script over React and the host's slot/locale
 * services. These tests run its configuration panel on a minimal hook
 * renderer and a scripted server, which is enough to pin the form behaviour
 * (what a save sends, what it must not overwrite, when the smoke test is
 * allowed) without a browser. */

const SERVER_SETTINGS = {
  engine: 'decisions', endpoint: 'https://api.example.test/v1/decisions', model: 'model-a', stateBudget: 'full',
  timeoutMs: 60000, denialRoute: 'ask', tConf: 0.75, tHighPred: 0.85, tMedPred: 0.5, tStrongPred: 0.8, tAuth: 0.7,
  rules: [], hasApiKey: true,
}

function createRenderer() {
  const hooks = []
  let cursor = 0
  let effects = []
  let rootComponent
  let rootProps
  let tree

  const React = {
    createElement(type, props, ...children) {
      const flat = children.flat()
      return { type, props: { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat }, children: flat }
    },
    useState(initial) {
      const index = cursor++
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      const slot = hooks[index]
      return [slot.value, (update) => {
        slot.value = typeof update === 'function' ? update(slot.value) : update
        render()
      }]
    },
    useRef(initial) {
      const index = cursor++
      hooks[index] ??= { current: initial }
      return hooks[index]
    },
    useEffect(effect, deps) {
      const index = cursor++
      const slot = (hooks[index] ??= { deps: undefined, ran: false })
      if (!slot.ran || deps === undefined || deps.some((dep, at) => dep !== slot.deps[at])) {
        slot.ran = true
        slot.deps = deps
        effects.push(effect)
      }
    },
    useCallback: (fn) => fn,
  }

  function expand(node) {
    if (Array.isArray(node)) return node.map(expand)
    if (node === null || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, children: node.children.map(expand) }
  }

  function render() {
    cursor = 0
    effects = []
    tree = expand(React.createElement(rootComponent, rootProps))
    for (const effect of effects) effect()
  }

  function* walk(node) {
    if (Array.isArray(node)) {
      for (const child of node) yield* walk(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    yield node
    yield* walk(node.children)
  }

  const textOf = (node) => [...walk(node)].map((entry) => entry).filter(Boolean).flatMap((entry) => entry.children).filter((child) => typeof child === 'string').join('')

  return {
    React,
    mount(component, props) {
      rootComponent = component
      rootProps = props
      render()
    },
    /** The input, select or textarea inside the `label` field whose caption is `caption`. */
    control(caption) {
      const field = [...walk(tree)].find((node) => node.type === 'label' && textOf(node.children[0]) === caption)
      assert.ok(field, `no field captioned ${caption}`)
      return [...walk(field)].find((node) => ['input', 'select', 'textarea'].includes(node.type))
    },
    button(caption) {
      return [...walk(tree)].find((node) => node.type === 'button' && textOf(node) === caption)
    },
    text() {
      return [...walk(tree)].flatMap((node) => node.children).filter((child) => typeof child === 'string').join(' | ')
    },
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('configuration panel', () => {
  let renderer
  let requests
  let saveGate
  let serverSettings

  beforeEach(async () => {
    renderer = createRenderer()
    requests = []
    saveGate = undefined
    serverSettings = { ...SERVER_SETTINGS }
    let rowConfig
    globalThis.window = {
      __ModuleLoader__: {
        load(definition) {
          const module = definition.factory((name) => {
            assert.equal(name, 'react')
            return renderer.React
          })
          module.apply({
            locale: { register: () => () => {}, bind: () => (key, params) => (params ? `${key}${JSON.stringify(params)}` : key) },
            slots: {
              inject: (_slot, setup) => setup(),
              register: (meta, component) => { if (meta.name === 'plugins.row.config') rowConfig = component },
            },
          })
        },
      },
    }
    mock.method(globalThis, 'fetch', async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(init.body)
      requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers, body })
      const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/config')) return reply({ settings: serverSettings, runtime: { engine: 'decisions', accepting: true, active: 0 } })
      if (url.endsWith('/save')) {
        if (saveGate) await saveGate
        const { apiKey, clearApiKey, ...fields } = body.settings
        serverSettings = { ...serverSettings, ...fields, hasApiKey: clearApiKey ? false : (apiKey ? true : serverSettings.hasApiKey) }
        return reply({ ok: true, settings: serverSettings })
      }
      if (url.endsWith('/test')) return reply({ ok: true, results: [] })
      return reply({ error: 'unknown' }, 404)
    })
    await import(`../client.js?run=${Math.random()}`)
    renderer.mount(rowConfig, { view: 'page' })
    await settle()
  })
  afterEach(() => {
    delete globalThis.window
    mock.restoreAll()
  })

  const saveRequests = () => requests.filter((request) => request.url.endsWith('/save'))

  it('loads through the authenticated route without ever holding the stored key', () => {
    assert.equal(requests[0].url, '/api/decision-review/config')
    assert.equal(renderer.control('apikey.label').props.value, '')
    assert.equal(renderer.control('apikey.label').props.placeholder, 'apikey.placeholder')
    assert.ok(renderer.button('apikey.clear'))
  })

  it('saves with a JSON POST that omits the key unless one was typed', async () => {
    renderer.control('model.label').props.onChange({ target: { value: 'model-b' } })
    await renderer.button('save').props.onClick()
    const [request] = saveRequests()
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['content-type'], 'application/json')
    assert.equal(request.body.settings.model, 'model-b')
    assert.equal('apiKey' in request.body.settings, false)
    assert.equal('hasApiKey' in request.body.settings, false)
    assert.equal('clearApiKey' in request.body.settings, false)

    renderer.control('apikey.label').props.onChange({ target: { value: 'sk-typed' } })
    await renderer.button('save').props.onClick()
    assert.equal(saveRequests()[1].body.settings.apiKey, 'sk-typed')
    assert.equal(renderer.control('apikey.label').props.value, '', 'a saved key leaves the form')
  })

  it('can ask the host to remove the stored key', async () => {
    renderer.button('apikey.clear').props.onClick()
    assert.ok(renderer.button('apikey.clear.undo'))
    await renderer.button('save').props.onClick()
    assert.equal(saveRequests()[0].body.settings.clearApiKey, true)
    assert.equal(renderer.button('apikey.clear'), undefined, 'no stored key left to remove')
  })

  describe('operator rules', () => {
    const typeRules = (text) => renderer.control('rules.label').props.onChange({ target: { value: text } })

    it('reject a malformed line instead of dropping it, and do not save', async () => {
      typeRules('deny|block deploys\npermit|something\nno separator')
      await renderer.button('save').props.onClick()
      assert.equal(saveRequests().length, 0)
      const shown = renderer.text()
      assert.match(shown, /rules\.error\.format\{"n":2\}/)
      assert.match(shown, /rules\.error\.format\{"n":3\}/)
    })

    it('accept the full-width bar and any letter case', async () => {
      typeRules('Deny｜block deploys to production\nALLOW|run the tests')
      await renderer.button('save').props.onClick()
      assert.deepEqual(saveRequests()[0].body.settings.rules, [
        { condition: 'block deploys to production', verdict: 'deny' },
        { condition: 'run the tests', verdict: 'allow' },
      ])
    })

    it('reject too many rules and over-long conditions before sending', async () => {
      typeRules(Array.from({ length: 21 }, (_, index) => `ask|rule ${index}`).join('\n'))
      await renderer.button('save').props.onClick()
      assert.match(renderer.text(), /rules\.error\.limit/)
      typeRules(`ask|${'x'.repeat(401)}`)
      await renderer.button('save').props.onClick()
      assert.match(renderer.text(), /rules\.error\.long\{"n":1,"max":400\}/)
      assert.equal(saveRequests().length, 0)
    })
  })

  it('does not overwrite edits made while a save is in flight', async () => {
    let release
    saveGate = new Promise((resolve) => { release = resolve })
    renderer.control('model.label').props.onChange({ target: { value: 'model-saved' } })
    const saving = renderer.button('save').props.onClick()
    renderer.control('model.label').props.onChange({ target: { value: 'typed-while-saving' } })
    release()
    await saving
    assert.equal(renderer.control('model.label').props.value, 'typed-while-saving')
    assert.equal(serverSettings.model, 'model-saved')
    assert.equal(renderer.button('test').props.disabled, true, 'the newer edit is unsaved, so the smoke test stays locked')
  })

  it('adopts the server’s normalized values when nothing changed meanwhile', async () => {
    renderer.control('timeout.label').props.onChange({ target: { value: '15000' } })
    await renderer.button('save').props.onClick()
    assert.equal(renderer.control('timeout.label').props.value, '15000')
    assert.equal(renderer.button('test').props.disabled, false)
  })

  it('runs the smoke test only against saved settings', async () => {
    assert.equal(renderer.button('test').props.disabled, false)
    renderer.control('model.label').props.onChange({ target: { value: 'unsaved-model' } })
    assert.equal(renderer.button('test').props.disabled, true)
    assert.match(renderer.text(), /test\.unsaved/)
    await renderer.button('save').props.onClick()
    assert.equal(renderer.button('test').props.disabled, false)
    await renderer.button('test').props.onClick()
    const testRequest = requests.find((request) => request.url.endsWith('/test'))
    assert.equal(testRequest.method, 'POST')
    assert.deepEqual(testRequest.body, {})
  })

  it('shows the route’s own error when a save fails', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'decision-review: timeoutMs must be an integer between 5000 and 600000' }), { status: 400, headers: { 'content-type': 'application/json' } }))
    renderer.control('timeout.label').props.onChange({ target: { value: '12.5' } })
    await renderer.button('save').props.onClick()
    assert.match(renderer.text(), /save\.error: decision-review: timeoutMs must be an integer/)
  })
})
