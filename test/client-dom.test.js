import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { apply } from '../dist/index.js'
import { makeAnswers, makeHost, makeProfileDir, removeDir } from './helpers.js'

test('the built classic script mounts and saves settings with real React DOM in a simulated DSH host', async (t) => {
  const origin = 'https://dsh.example.test'
  const endpoint = 'https://decisions.example.test/v1/decisions'
  const storedKey = 'test-only-stored-key'
  const condition = '\n  Deploy service A | service B.\n  仅限生产环境｜保留末尾空格。  \n'
  const rules = [{ condition, verdict: 'deny' }]
  const profileDir = makeProfileDir()
  const { window } = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', url: origin })
  const container = window.document.getElementById('root')
  let host
  let root
  let disposeLocale

  t.after(async () => {
    try {
      if (root) await act(async () => root.unmount())
      disposeLocale?.()
      await host?.dispose()
    } finally {
      window.close()
      delete globalThis.window
      delete globalThis.document
      delete globalThis.IS_REACT_ACT_ENVIRONMENT
      removeDir(profileDir)
    }
  })
  // React DOM detects the DOM at module initialization for its input event handlers.
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')

  function startHost() {
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
  }

  t.mock.method(console, 'info', () => {})
  const decisionsCalls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, endpoint)
    const body = JSON.parse(init.body)
    decisionsCalls.push({ authorization: new Headers(init.headers).get('authorization'), body })
    const exfiltration = JSON.stringify(body.input).includes('hooks.example-collector.net')
    const answers = makeAnswers({
      rule: { choice: 'none' },
      overrides: exfiltration ? { exfiltration: { type: 'predicate', probability: 0.98 } } : {},
    })
    return Response.json({ answers })
  })
  await writeFile(join(profileDir, 'decision-review.settings.json'), JSON.stringify({ endpoint, apiKey: storedKey }))
  startHost()

  const requests = []
  window.fetch = async (path, init) => {
    assert.match(path, /^\/api\/decision-review\//)
    const url = new URL(path, origin)
    const request = new Request(url, init)
    const route = host.routes.get(url.pathname)
    assert.ok(route?.methods.includes(request.method), `${request.method} ${path} is not registered`)
    const response = await route.fetch(request)
    const text = await response.text()
    const sent = init?.body === undefined ? undefined : JSON.parse(init.body)
    requests.push({ path, sent, received: JSON.parse(text) })
    return new Response(text, { status: response.status, headers: response.headers })
  }

  let messages
  let configView
  let language = 'en'
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      assert.equal(id, '@local/decision-review')
      const client = factory((name) => {
        assert.equal(name, 'react')
        return React
      })
      assert.deepEqual([...client.inject], ['slots', 'locale'])
      disposeLocale = client.apply({
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
          register(meta, component) {
            if (meta.name === 'plugins.row.config') configView = component
          },
        },
      })
    },
  }
  window.eval(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))
  assert.equal(typeof configView, 'function')

  async function mount() {
    const translate = (key, params = {}) =>
      messages[language][key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
    root = createRoot(container)
    await act(async () => root.render(React.createElement(configView, { view: 'page', t: translate })))
  }

  function button(label) {
    const match = [...container.querySelectorAll('button')].find(
      (node) => node.textContent.replace(/^\+ /, '') === label,
    )
    assert.ok(match, `Missing button: ${label}`)
    return match
  }

  async function change(control, value) {
    // Call the native setter so React's value tracker observes the DOM event.
    const { set } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
    const event = control.tagName === 'SELECT' ? 'change' : 'input'
    await act(async () => {
      set.call(control, value)
      control.dispatchEvent(new window.Event(event, { bubbles: true }))
    })
  }

  const click = async (label) => act(async () => button(label).click())
  const password = () => container.querySelector('input[type=password]')
  const rule = () => container.querySelector('textarea')
  const verdict = () => rule().closest('section').querySelector('select')

  await mount()
  assert.match(container.textContent, /Authorization review/)
  assert.equal(password().value, '')
  assert.match(password().placeholder, /saved/)
  assert.equal(button('Run smoke test (3 scenarios)').disabled, false)

  await click('Add rule')
  await change(rule(), condition)
  await change(verdict(), 'deny')
  assert.equal(button('Run smoke test (3 scenarios)').disabled, true)
  await click('Run smoke test (3 scenarios)')
  assert.equal(requests.length, 1)
  await click('Save')
  assert.match(container.textContent, /Settings saved\./)
  assert.equal(button('Run smoke test (3 scenarios)').disabled, false)
  assert.deepEqual(requests[1].sent.settings.rules, rules)
  assert.equal(Object.hasOwn(requests[1].sent.settings, 'apiKey'), false)

  // Restart the server and remount the panel to read the on-disk settings.
  await act(async () => root.unmount())
  root = undefined
  await host.dispose()
  startHost()
  language = 'zh'
  await mount()
  assert.match(container.textContent, /授权评审/)
  assert.equal(rule().value, condition)
  assert.equal(verdict().value, 'deny')
  assert.equal(password().value, '')
  assert.match(password().placeholder, /已保存/)

  await click('移除已保存的密钥')
  assert.equal(button('运行冒烟测试（3 个场景）').disabled, true)
  await click('保存')
  assert.equal(requests[3].sent.settings.clearApiKey, true)
  assert.equal(password().placeholder, '')
  assert.equal(button('运行冒烟测试（3 个场景）').disabled, false)
  await click('运行冒烟测试（3 个场景）')

  const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.textContent)
  assert.equal(rows.length, 3)
  assert.match(rows[0], /运行项目测试.*放行.*低风险/)
  assert.match(rows[1], /向外部地址发送凭据.*拒绝.*高风险.*疑似数据外传/)
  assert.match(rows[2], /安装插件.*放行.*低风险/)
  assert.equal(decisionsCalls.length, 3)
  for (const { authorization, body } of decisionsCalls) {
    assert.ok(!authorization?.includes(storedKey))
    const operatorRule = body.questions.find(({ name }) => name === 'operator_rule')
    assert.ok(operatorRule.choices.some(({ description }) => description.endsWith(condition)))
  }

  assert.deepEqual(
    requests.map(({ path }) => path.split('/').at(-1)),
    ['config', 'save', 'config', 'save', 'test'],
  )
  assert.deepEqual(
    requests.slice(0, 4).map(({ received }) => received.settings.hasApiKey),
    [true, true, true, false],
  )
  for (const { received } of requests) {
    assert.ok(!Object.hasOwn(received.settings ?? {}, 'apiKey'))
    assert.ok(!JSON.stringify(received).includes(storedKey))
  }
})
