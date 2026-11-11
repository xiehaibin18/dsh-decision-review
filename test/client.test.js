import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'

/* The client half is a browser script over React and the host's slot/locale
 * services. These tests run its configuration panel on a minimal hook
 * renderer and a scripted server, which is enough to pin the form behaviour
 * (what a save sends, what it must not overwrite, when the smoke test is
 * allowed) without a browser. */

const SERVER_SETTINGS = {
  engine: 'decisions',
  endpoint: 'https://api.example.test/v1/decisions',
  model: 'model-a',
  timeoutMs: 60000,
  denialRoute: 'ask',
  tConf: 0.75,
  tHighPred: 0.85,
  tMedPred: 0.5,
  tStrongPred: 0.8,
  tAuth: 0.7,
  rules: [],
  hasApiKey: true,
}

function createRenderer() {
  const hooks = []
  let cursor = 0
  let effects = []
  let rootComponent
  let rootProps
  let tree

  const React = {
    Fragment: Symbol('Fragment'),
    useId: () => 'test-id-' + cursor++,
    createElement(type, props, ...children) {
      const flat = children.flat()
      return { type, props: { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat }, children: flat }
    },
    useState(initial) {
      const index = cursor++
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      const slot = hooks[index]
      return [
        slot.value,
        (update) => {
          slot.value = typeof update === 'function' ? update(slot.value) : update
          render()
        },
      ]
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
  }

  function expand(node) {
    if (Array.isArray(node)) return node.map(expand)
    if (node === null || typeof node !== 'object') return node
    if (node.type === React.Fragment) return node.children.map(expand)
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

  function textOf(node) {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (!node || typeof node !== 'object' || node.props['aria-hidden']) return ''
    return textOf(node.children)
  }

  return {
    React,
    mount(component, props) {
      rootComponent = component
      rootProps = props
      render()
    },
    unmount() {
      hooks.length = 0
      tree = null
    },
    /** The input, select or textarea inside the `label` field whose caption is `caption`. */
    controls(caption) {
      const fields = [...walk(tree)].filter((node) => node.type === 'label' && textOf(node.children[0]) === caption)
      return fields.map((field) => [...walk(field)].find((node) => ['input', 'select', 'textarea'].includes(node.type)))
    },
    control(caption, index = 0) {
      const control = this.controls(caption)[index]
      assert.ok(control, 'no field captioned ' + caption + ' at index ' + index)
      return control
    },
    button(caption) {
      return [...walk(tree)].find(
        (node) => node.type === 'button' && (node.props['aria-label'] ?? textOf(node)) === caption,
      )
    },
    text() {
      return textOf(tree)
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
  let serverProblems
  let rowConfig
  let serverResults
  let messages
  let language

  function copy(key, params = {}) {
    assert.ok(Object.hasOwn(messages[language], key), 'missing message: ' + language + '/' + key)
    return messages[language][key].replace(/\{(\w+)\}/g, (_, name) => {
      assert.ok(Object.hasOwn(params, name), 'missing parameter: ' + key + '/' + name)
      return String(params[name])
    })
  }

  function mount(view = 'page') {
    renderer.mount(rowConfig, { view, t: copy })
  }

  const field = (key, index) => renderer.control(copy(key), index)
  const change = (key, value, index) => field(key, index).props.onChange({ target: { value } })
  const button = (key, params) => renderer.button(copy(key, params))
  const shown = (key, params) => assert.ok(renderer.text().includes(copy(key, params)), 'missing text for ' + key)
  const hidden = (key, params) => assert.ok(!renderer.text().includes(copy(key, params)), 'unexpected text for ' + key)
  // Set by suites that need to prepare the server's answer before the panel mounts.
  let deferMount = false

  beforeEach(async () => {
    renderer = createRenderer()
    requests = []
    saveGate = undefined
    serverSettings = { ...SERVER_SETTINGS }
    serverProblems = []
    serverResults = []
    language = 'en'
    globalThis.window = {
      __ModuleLoader__: {
        load(definition) {
          const module = definition.factory((name) => {
            assert.equal(name, 'react')
            return renderer.React
          })
          module.apply({
            locale: {
              register(namespace, dictionaries) {
                assert.equal(namespace, 'decision-review')
                messages = dictionaries
                return () => {}
              },
              resolveText: (text) => (typeof text === 'string' ? text : (text[language] ?? text.en)),
            },
            slots: {
              inject: (_slot, setup) => setup(),
              register: (meta, component) => {
                assert.equal(meta.locale, 'decision-review')
                if (meta.name === 'plugins.row.config') rowConfig = component
              },
            },
          })
        },
      },
    }
    mock.method(globalThis, 'fetch', async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(init.body)
      requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers, body })
      const reply = (payload, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/config'))
        return reply({
          settings: serverSettings,
          problems: serverProblems,
          runtime: { engine: serverSettings.engine, accepting: true, active: 0, paused: serverProblems.length > 0 },
        })
      if (url.endsWith('/save')) {
        if (saveGate) await saveGate
        const { apiKey, clearApiKey, ...fields } = body.settings
        serverSettings = {
          ...serverSettings,
          ...fields,
          hasApiKey: clearApiKey ? false : apiKey ? true : serverSettings.hasApiKey,
        }
        return reply({ ok: true, settings: serverSettings, problems: [] })
      }
      if (url.endsWith('/test')) return reply({ ok: true, results: serverResults })
      return reply({ error: 'unknown' }, 404)
    })
    await import(`../dist/client.js?run=${Math.random()}`)
    if (!deferMount) {
      mount()
      await settle()
    }
  })
  afterEach(() => {
    delete globalThis.window
    mock.restoreAll()
  })

  const saveRequests = () => requests.filter((request) => request.url.endsWith('/save'))

  describe('invalid stored settings', () => {
    before(() => {
      deferMount = true
    })
    after(() => {
      deferMount = false
    })
    const open = async (problems) => {
      serverProblems = problems
      mount()
      await settle()
    }

    it('explains why automatic review is paused', async () => {
      await open(['stored tConf is not a number in [0,1]; the default 0.75 is shown'])
      shown('problems.title')
      assert.match(renderer.text(), /stored tConf is not a number/)
    })

    it('shows paused review until valid settings are saved', async () => {
      await open(['stored tConf is not a number in [0,1]; the default 0.75 is shown'])
      shown('runtime.status', { state: copy('runtime.paused') })
      hidden('runtime.status', { state: copy('runtime.accepting') })
      change('model.label', 'model-b')
      await button('save').props.onClick()
      hidden('problems.title')
      hidden('runtime.status', { state: copy('runtime.paused') })
      shown('runtime.status', { state: copy('runtime.accepting') })
    })

    it('shows no notice for healthy settings', async () => {
      await open([])
      hidden('problems.title')
    })

    it('repairs an invalid stored Decisions endpoint without switching the Session engine', async () => {
      serverSettings = { ...serverSettings, engine: 'session', endpoint: '' }
      await open(['stored endpoint is not a valid HTTPS URL; an empty field is shown'])
      assert.equal(field('engine.label').props.value, 'session')
      shown('engine.repair')
      assert.equal(field('endpoint.label').props.value, '')
      assert.equal(field('model.label').props.value, 'model-a')
      hidden('apikey.label')

      change('endpoint.label', 'h')
      assert.equal(field('endpoint.label').props.value, 'h', 'the field stays visible during editing')
      change('endpoint.label', 'https://api.example.test/v1/decisions')
      await button('save').props.onClick()

      const [request] = saveRequests()
      assert.equal(request.body.settings.endpoint, 'https://api.example.test/v1/decisions')
      assert.equal(request.body.settings.engine, 'session')
      assert.equal(field('engine.label').props.value, 'session')
      shown('runtime.status', { state: copy('runtime.accepting') })
      hidden('engine.repair')
      hidden('endpoint.label')
      hidden('model.label')
    })
  })

  it('loads through the authenticated route without ever holding the stored key', () => {
    assert.equal(requests[0].url, '/api/decision-review/config')
    assert.equal(field('apikey.label').props.value, '')
    assert.equal(field('apikey.label').props.placeholder, copy('apikey.placeholder'))
    assert.ok(button('apikey.clear'))
  })

  it('saves with a JSON POST that omits the key unless one was typed', async () => {
    change('model.label', 'model-b')
    await button('save').props.onClick()
    const [request] = saveRequests()
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['content-type'], 'application/json')
    assert.equal(request.body.settings.model, 'model-b')
    assert.equal('apiKey' in request.body.settings, false)
    assert.equal('hasApiKey' in request.body.settings, false)
    assert.equal('clearApiKey' in request.body.settings, false)

    field('apikey.label').props.onChange({ target: { value: 'sk-typed' } })
    await button('save').props.onClick()
    assert.equal(saveRequests()[1].body.settings.apiKey, 'sk-typed')
    assert.equal(field('apikey.label').props.value, '', 'a saved key leaves the form')
  })

  it('can ask the host to remove the stored key', async () => {
    button('apikey.clear').props.onClick()
    assert.ok(button('apikey.clear.undo'))
    await button('save').props.onClick()
    assert.equal(saveRequests()[0].body.settings.clearApiKey, true)
    assert.equal(button('apikey.clear'), undefined, 'no stored key left to remove')
  })

  describe('operator rules', () => {
    const condition = (value, index) => change('rules.condition.label', value, index)

    it('adds and removes rules, preserving the remaining rule text and verdict', async () => {
      shown('rules.empty.title')
      shown('rules.summary', { count: 0, maxCount: 20, total: 0, maxTotal: 2000 })
      button('rules.add').props.onClick()
      hidden('rules.empty.title')
      assert.equal(field('rules.verdict.label').props.value, 'ask')
      condition('Other rule')
      button('rules.add').props.onClick()
      const multiline = '\n  Deploy service A | service B.\n  Only if the destination is production｜not preview.\n'
      condition(multiline, 1)
      change('rules.verdict.label', 'deny', 1)
      button('rules.remove.named', { n: 1 }).props.onClick()

      assert.equal(field('rules.condition.label').props.value, multiline)
      assert.equal(field('rules.verdict.label').props.value, 'deny')
      shown('rules.condition.length', { count: multiline.length, max: 400 })
      shown('rules.summary', { count: 1, maxCount: 20, total: multiline.length, maxTotal: 2000 })
      assert.equal(button('test.run').props.disabled, true)
      await button('save').props.onClick()
      assert.deepEqual(saveRequests()[0].body.settings.rules, [{ condition: multiline, verdict: 'deny' }])
      assert.equal(field('rules.condition.label').props.value, multiline)
      assert.equal(button('test.run').props.disabled, false)

      // A new mount reads the saved native objects back from the route.
      renderer.unmount()
      mount()
      await settle()
      assert.equal(field('rules.condition.label').props.value, multiline)
      assert.equal(field('rules.verdict.label').props.value, 'deny')
      button('rules.remove.named', { n: 1 }).props.onClick()
      shown('rules.empty.title')
      await button('save').props.onClick()
      assert.deepEqual(saveRequests()[1].body.settings.rules, [])
    })

    it('blocks save and identifies each invalid condition beside its input', async () => {
      button('rules.add').props.onClick()
      condition(' \n  ')
      hidden('rules.error.required')
      button('rules.add').props.onClick()
      condition('x'.repeat(400) + '\n', 1)
      shown('rules.error.long', { max: 400 })
      await button('save').props.onClick()
      shown('rules.error.required')
      shown('save.invalid')
      assert.equal(field('rules.condition.label').props['aria-invalid'], true)
      assert.equal(field('rules.condition.label', 1).props['aria-invalid'], true)
      assert.equal(saveRequests().length, 0)

      condition('A valid rule', 0)
      condition('x'.repeat(400), 1)
      hidden('save.invalid')
      assert.equal(field('rules.condition.label', 1).props['aria-invalid'], undefined)
      await button('save').props.onClick()
      assert.equal(saveRequests().length, 1)
    })

    it('shows the aggregate length and blocks save even if each rule is valid', async () => {
      for (let i = 0; i < 6; i++) {
        button('rules.add').props.onClick()
        condition('x'.repeat(350), i)
      }
      shown('rules.summary', { count: 6, maxCount: 20, total: 2100, maxTotal: 2000 })
      shown('rules.error.total', { max: 2000 })
      hidden('rules.error.long', { max: 400 })
      await button('save').props.onClick()
      assert.equal(saveRequests().length, 0)
    })

    it('disables adding a rule at the count limit and enables it after removal', () => {
      for (let i = 0; i < 20; i++) button('rules.add').props.onClick()
      assert.equal(button('rules.add').props.disabled, true)
      shown('rules.summary', { count: 20, maxCount: 20, total: 0, maxTotal: 2000 })
      button('rules.remove.named', { n: 20 }).props.onClick()
      assert.equal(button('rules.add').props.disabled, false)
    })

    it('explains engine-specific deny behavior without losing draft rules', () => {
      button('rules.add').props.onClick()
      condition('Deny production deploys')
      change('rules.verdict.label', 'deny')
      assert.match(renderer.text(), /matched “Deny” rule always stops the call/)
      change('engine.label', 'session')
      assert.match(renderer.text(), /any refusal still follows your setting for reviewer denials/)
      assert.doesNotMatch(renderer.text(), /always stops the call/)
      assert.equal(button('test.run').props.disabled, true)
      assert.equal(field('rules.condition.label').props.value, 'Deny production deploys')
      assert.equal(field('rules.verdict.label').props.value, 'deny')
    })
  })

  describe('client localization', () => {
    it('registers the same complete keys and interpolation parameters in both languages', () => {
      assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort())
      const placeholders = (text) => Array.from(text.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort()
      for (const [key, text] of Object.entries(messages.en)) {
        assert.ok(text.trim() && messages.zh[key].trim(), key)
        assert.deepEqual(placeholders(text), placeholders(messages.zh[key]), key)
      }
      assert.match(renderer.text(), /Rules: 0\/20 · Condition characters: 0\/2000/)
      assert.match(renderer.text(), /tConf — Minimum classification confidence/)
      assert.match(renderer.text(), /tHighPred — Data exfiltration threshold for high-risk classification/)
      assert.match(renderer.text(), /tMedPred — Weak signal threshold for medium risk/)
      assert.match(renderer.text(), /tStrongPred — Strong signal threshold for medium risk/)
      assert.match(renderer.text(), /tAuth — Authorization threshold for allowing medium risk/)
      assert.doesNotMatch(renderer.text(), /\p{Script=Han}/u)

      language = 'zh'
      mount()
      assert.match(renderer.text(), /规则：0\/20 条 · 条件总长：0\/2000 个字符/)
      assert.match(renderer.text(), /tConf — 分类置信度下限/)
      assert.match(renderer.text(), /tHighPred — 数据外传高风险判定阈值/)
      assert.match(renderer.text(), /tMedPred — 中风险弱信号阈值/)
      assert.match(renderer.text(), /tStrongPred — 中风险强信号阈值/)
      assert.match(renderer.text(), /tAuth — 中风险放行的授权阈值/)
    })

    it('switches localized smoke results in place, including the server reason', async () => {
      serverResults = [
        { scenario: 'allow', ok: true, ms: 42, composed: { decision: 'allow', risk: 'low' } },
        {
          scenario: 'exfil',
          ok: true,
          ms: 37,
          composed: {
            decision: 'deny',
            risk: 'high',
            reason: 'raw engine reason',
            display: { en: 'A credential would leave the machine.', zh: '凭据将发送到机器之外。' },
          },
        },
        { scenario: 'install', ok: false, error: 'synthetic connection reset' },
      ]
      await button('test.run').props.onClick()
      const en = renderer.text()
      assert.match(en, /Run project tests.*Allowed.*Low risk/)
      assert.match(en, /Send credentials to an external URL.*Denied.*High risk.*A credential would leave the machine/)
      assert.match(
        en,
        /Install a plugin.*Error.*could not complete this scenario.*Technical details.*synthetic connection reset/,
      )

      language = 'zh'
      mount()
      const zh = renderer.text()
      assert.match(zh, /运行项目测试.*放行.*低风险/)
      assert.match(zh, /向外部地址发送凭据.*拒绝.*高风险.*凭据将发送到机器之外/)
      assert.match(zh, /安装插件.*出错.*评审未能完成此场景.*技术详情.*synthetic connection reset/)
      assert.doesNotMatch(zh, /A credential would leave the machine|raw engine reason/)
      assert.equal(requests.filter(({ url }) => url.endsWith('/test')).length, 1)
    })
  })

  it('does not overwrite edits made while a save is in flight', async () => {
    let release
    saveGate = new Promise((resolve) => {
      release = resolve
    })
    change('model.label', 'model-saved')
    button('rules.add').props.onClick()
    change('rules.condition.label', 'Condition to save')
    const saving = button('save').props.onClick()
    change('model.label', 'typed-while-saving')
    change('rules.condition.label', 'Condition to save\nWith a newer edit')
    release()
    await saving
    assert.equal(field('model.label').props.value, 'typed-while-saving')
    assert.equal(field('rules.condition.label').props.value, 'Condition to save\nWith a newer edit')
    assert.equal(serverSettings.model, 'model-saved')
    assert.deepEqual(serverSettings.rules, [{ condition: 'Condition to save', verdict: 'ask' }])
    assert.equal(button('test.run').props.disabled, true, 'the newer edit is unsaved, so the smoke test stays locked')
  })

  it('adopts the server’s normalized values when nothing changed meanwhile', async () => {
    field('timeout.label').props.onChange({ target: { value: '15000' } })
    await button('save').props.onClick()
    assert.equal(field('timeout.label').props.value, '15000')
    assert.equal(button('test.run').props.disabled, false)
  })

  it('runs the smoke test only against saved settings', async () => {
    assert.equal(button('test.run').props.disabled, false)
    change('model.label', 'unsaved-model')
    assert.equal(button('test.run').props.disabled, true)
    shown('test.unsaved')
    await button('save').props.onClick()
    assert.equal(button('test.run').props.disabled, false)
    await button('test.run').props.onClick()
    const testRequest = requests.find((request) => request.url.endsWith('/test'))
    assert.equal(testRequest.method, 'POST')
    assert.deepEqual(testRequest.body, {})
  })

  it('shows the route’s own error when a save fails', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({ error: 'decision-review: timeoutMs must be an integer between 5000 and 600000' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    )
    field('timeout.label').props.onChange({ target: { value: '12.5' } })
    await button('save').props.onClick()
    shown('save.error')
    shown('error.details')
    assert.match(renderer.text(), /decision-review: timeoutMs must be an integer/)
  })
})
