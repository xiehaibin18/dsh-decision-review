import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'react'
import { CONFIG_SLOT, createClient } from './client-harness.js'

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

describe('configuration panel', () => {
  let client
  let requests
  let loadGate
  let saveGate
  let testGate
  let saveError
  let serverSettings
  let serverProblems
  let serverResults

  function render(view = 'page') {
    return client.render(CONFIG_SLOT, { view })
  }

  const text = () => client.container.textContent
  const copy = (key, params) => client.translate(key, key === 'test.run' ? { count: 3 } : params)
  const shown = (key, params) => expect(text()).toContain(copy(key, params))
  const hidden = (key, params) => expect(text()).not.toContain(copy(key, params))
  const button = (key, params) => client.button(copy(key, params))
  const saveRequests = () => requests.filter(({ url }) => url.endsWith('/save'))

  function field(key, index = 0) {
    const caption = copy(key)
    const labels = [...client.container.querySelectorAll('label')].filter(
      (label) => label.firstElementChild?.textContent === caption,
    )
    const control = labels[index]?.querySelector('input, select, textarea')
    expect(control, `Missing field: ${caption} at index ${index}`).toBeDefined()
    return control
  }

  function change(key, value, index) {
    return client.change(field(key, index), value)
  }

  async function click(key, params) {
    const control = button(key, params)
    expect(control, `Missing button: ${copy(key, params)}`).toBeDefined()
    await act(async () => control.click())
  }

  beforeEach(() => {
    requests = []
    loadGate = undefined
    saveGate = undefined
    testGate = undefined
    saveError = undefined
    serverSettings = { ...SERVER_SETTINGS }
    serverProblems = []
    serverResults = []

    client = createClient(
      mock(async (url, init) => {
        const body = init?.body === undefined ? undefined : JSON.parse(init.body)
        requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers, signal: init?.signal, body })
        switch (url) {
          case '/api/decision-review/config': {
            const response = Response.json({
              settings: serverSettings,
              problems: serverProblems,
              runtime: {
                engine: serverSettings.engine,
                accepting: true,
                active: 0,
                paused: serverProblems.length > 0,
              },
            })
            if (loadGate) await loadGate
            return response
          }
          case '/api/decision-review/save': {
            if (saveError) return Response.json({ error: saveError }, { status: 400 })
            if (saveGate) await saveGate
            const { apiKey, clearApiKey, ...fields } = body.settings
            serverSettings = {
              ...serverSettings,
              ...fields,
              timeoutMs: Number(fields.timeoutMs),
              hasApiKey: clearApiKey ? false : apiKey ? true : serverSettings.hasApiKey,
            }
            return Response.json({ ok: true, settings: serverSettings, problems: [] })
          }
          case '/api/decision-review/test': {
            const response = Response.json({ ok: true, results: serverResults })
            if (testGate) await testGate
            return response
          }
          default:
            throw new Error(`Unexpected client request: ${url}`)
        }
      }),
    )
    client.load()
  })

  afterEach(async () => {
    try {
      await client?.dispose()
    } finally {
      client = undefined
    }
  })

  describe('invalid stored settings', () => {
    const open = async (problems) => {
      serverProblems = problems
      await render()
    }

    test.serial('explains why automatic review is paused', async () => {
      await open([{ code: 'threshold', params: { field: 'tConf' } }])
      shown('problems.title')
      expect(text()).toContain('tConf must be a number from 0 to 1.')
    })

    test.serial('shows paused review until valid settings are saved', async () => {
      await open([{ code: 'threshold', params: { field: 'tConf' } }])
      shown('runtime.status', { state: copy('runtime.paused') })
      hidden('runtime.status', { state: copy('runtime.accepting') })
      await change('model.label', 'model-b')
      await click('save')
      hidden('problems.title')
      hidden('runtime.status', { state: copy('runtime.paused') })
      shown('runtime.status', { state: copy('runtime.accepting') })
    })

    test.serial('shows no notice for healthy settings', async () => {
      await open([])
      hidden('problems.title')
    })

    test.serial('repairs an invalid stored Decisions endpoint without switching the Session engine', async () => {
      serverSettings = { ...serverSettings, engine: 'session', endpoint: '' }
      await open([{ code: 'endpoint' }])
      expect(field('engine.label').value).toBe('session')
      shown('engine.repair')
      expect(field('endpoint.label').value).toBe('')
      expect(field('model.label').value).toBe('model-a')
      hidden('apikey.label')

      await change('endpoint.label', 'h')
      expect(field('endpoint.label').value).toBe('h')
      await change('endpoint.label', 'https://api.example.test/v1/decisions')
      await click('save')

      const [request] = saveRequests()
      expect(request.body.settings.endpoint).toBe('https://api.example.test/v1/decisions')
      expect(request.body.settings.engine).toBe('session')
      expect(field('engine.label').value).toBe('session')
      shown('runtime.status', { state: copy('runtime.accepting') })
      hidden('engine.repair')
      hidden('endpoint.label')
      hidden('model.label')
    })
  })

  test.serial('renders the row summary without requesting settings', async () => {
    await render('summary')
    shown('panel.desc')
    expect(requests).toHaveLength(0)
  })

  test.serial('loads through the authenticated route without ever holding the stored key', async () => {
    await render()
    expect(requests[0]).toMatchObject({ url: '/api/decision-review/config', method: 'GET' })
    expect(field('apikey.label').value).toBe('')
    expect(field('apikey.label').placeholder).toBe(copy('apikey.placeholder'))
    expect(button('apikey.clear')).toBeDefined()
  })

  test.serial('aborts the pending configuration load when the page closes', async () => {
    const { promise, resolve } = Promise.withResolvers()
    loadGate = promise
    try {
      await render()
      shown('panel.loading')
      await render('summary')
      expect(requests[0].signal.aborted).toBe(true)

      loadGate = undefined
      serverSettings = { ...SERVER_SETTINGS, model: 'model-current' }
      await render()
      await act(async () => resolve())
      expect(field('model.label').value).toBe('model-current')
    } finally {
      await act(async () => resolve())
    }
  })

  test.serial('saves with a JSON POST that omits the key unless one was typed', async () => {
    await render()
    await change('model.label', 'model-b')
    await click('save')
    const [request] = saveRequests()
    expect(request.method).toBe('POST')
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.body.settings.model).toBe('model-b')
    expect(request.body.settings).not.toHaveProperty('apiKey')
    expect(request.body.settings).not.toHaveProperty('hasApiKey')
    expect(request.body.settings).not.toHaveProperty('clearApiKey')

    await change('apikey.label', 'sk-typed')
    await click('save')
    expect(saveRequests()[1].body.settings.apiKey).toBe('sk-typed')
    expect(field('apikey.label').value).toBe('')
  })

  test.serial('can ask the host to remove the stored key', async () => {
    await render()
    await click('apikey.clear')
    expect(button('apikey.clear.undo')).toBeDefined()
    await click('save')
    expect(saveRequests()[0].body.settings.clearApiKey).toBe(true)
    expect(button('apikey.clear')).toBeUndefined()
  })

  describe('operator rules', () => {
    const condition = (value, index) => change('rules.condition.label', value, index)

    test.serial('adds and removes rules, preserving the remaining rule text and verdict', async () => {
      await render()
      shown('rules.empty.title')
      shown('rules.summary', { count: 0, maxCount: 20, total: 0, maxTotal: 2000 })
      await click('rules.add')
      hidden('rules.empty.title')
      expect(field('rules.verdict.label').value).toBe('ask')
      await condition('Other rule')
      await click('rules.add')
      const multiline = '\n  Deploy service A | service B.\n  Only if the destination is production｜not preview.\n'
      await condition(multiline, 1)
      await change('rules.verdict.label', 'deny', 1)
      await click('rules.remove.named', { n: 1 })

      expect(field('rules.condition.label').value).toBe(multiline)
      expect(field('rules.verdict.label').value).toBe('deny')
      shown('rules.condition.length', { count: multiline.length, max: 400 })
      shown('rules.summary', { count: 1, maxCount: 20, total: multiline.length, maxTotal: 2000 })
      expect(button('test.run').disabled).toBe(true)
      await click('save')
      expect(saveRequests()[0].body.settings.rules).toEqual([{ condition: multiline, verdict: 'deny' }])
      expect(field('rules.condition.label').value).toBe(multiline)
      expect(button('test.run').disabled).toBe(false)

      await client.unmount()
      await render()
      expect(field('rules.condition.label').value).toBe(multiline)
      expect(field('rules.verdict.label').value).toBe('deny')
      await click('rules.remove.named', { n: 1 })
      shown('rules.empty.title')
      await click('save')
      expect(saveRequests()[1].body.settings.rules).toEqual([])
    })

    test.serial('blocks save and identifies each invalid condition beside its input', async () => {
      await render()
      await click('rules.add')
      await condition(' \n  ')
      hidden('rules.error.required')
      await click('rules.add')
      await condition('x'.repeat(400) + '\n', 1)
      shown('rules.error.long', { max: 400 })
      await click('save')
      shown('rules.error.required')
      shown('save.invalid')
      expect(field('rules.condition.label').getAttribute('aria-invalid')).toBe('true')
      expect(field('rules.condition.label', 1).getAttribute('aria-invalid')).toBe('true')
      expect(saveRequests()).toHaveLength(0)

      await condition('A valid rule', 0)
      await condition('x'.repeat(400), 1)
      hidden('save.invalid')
      expect(field('rules.condition.label', 1).hasAttribute('aria-invalid')).toBe(false)
      await click('save')
      expect(saveRequests()).toHaveLength(1)
    })

    test.serial('shows the aggregate length and blocks save even if each rule is valid', async () => {
      await render()
      for (let i = 0; i < 6; i++) {
        await click('rules.add')
        await condition('x'.repeat(350), i)
      }
      shown('rules.summary', { count: 6, maxCount: 20, total: 2100, maxTotal: 2000 })
      shown('rules.error.total', { max: 2000 })
      hidden('rules.error.long', { max: 400 })
      await click('save')
      expect(saveRequests()).toHaveLength(0)
    })

    test.serial('disables adding a rule at the count limit and enables it after removal', async () => {
      await render()
      for (let i = 0; i < 20; i++) await click('rules.add')
      expect(button('rules.add').disabled).toBe(true)
      shown('rules.summary', { count: 20, maxCount: 20, total: 0, maxTotal: 2000 })
      await click('rules.remove.named', { n: 20 })
      expect(button('rules.add').disabled).toBe(false)
    })

    test.serial('explains engine-specific deny behavior without losing draft rules', async () => {
      await render()
      await click('rules.add')
      await condition('Deny production deploys')
      await change('rules.verdict.label', 'deny')
      expect(text()).toMatch(/“Deny” always blocks a matched call/)
      await change('engine.label', 'session')
      expect(text()).toMatch(/the approval setting above still applies/)
      expect(text()).not.toMatch(/always blocks a matched call/)
      expect(button('test.run').disabled).toBe(true)
      expect(field('rules.condition.label').value).toBe('Deny production deploys')
      expect(field('rules.verdict.label').value).toBe('deny')
    })
  })

  describe('client localization', () => {
    test.serial('registers the same complete keys and interpolation parameters in both languages', async () => {
      const { en, zh } = client.messages
      expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
      const placeholders = (message) => Array.from(message.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort()
      for (const [key, message] of Object.entries(en)) {
        expect(message.trim(), key).not.toBe('')
        expect(zh[key].trim(), key).not.toBe('')
        expect(placeholders(message), key).toEqual(placeholders(zh[key]))
      }

      await render()
      expect(text()).toMatch(/Rules: 0\/20 · Condition characters: 0\/2000/)
      expect(text()).toMatch(/tConf — Minimum confidence for risk classification and rule matches/)
      expect(text()).toMatch(/tHighPred — Data exfiltration score that triggers high risk/)
      expect(text()).toMatch(/tMedPred — Medium risk signal when classification confidence is low/)
      expect(text()).toMatch(/tStrongPred — Medium risk signal on its own/)
      expect(text()).toMatch(/tAuth — Minimum explicit authorization score/)
      expect(text()).not.toMatch(/\p{Script=Han}/u)

      client.language = 'zh'
      await render()
      expect(text()).toMatch(/规则：0\/20 条 · 条件总长：0\/2000 个字符/)
      expect(text()).toMatch(/tConf — 风险分类和规则匹配的最低置信度/)
      expect(text()).toMatch(/tHighPred — 数据外传触发高风险的分数/)
      expect(text()).toMatch(/tMedPred — 分类置信度不足时的中风险信号阈值/)
      expect(text()).toMatch(/tStrongPred — 单凭信号触发中风险的分数/)
      expect(text()).toMatch(/tAuth — 明确授权的最低分数/)
    })

    test.serial('switches localized smoke results in place, including the server reason', async () => {
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
      await render()
      await click('test.run')
      expect(text()).toMatch(/Run project tests.*Allowed.*Low risk/)
      expect(text()).toMatch(
        /Send credentials to an external URL.*Denied.*High risk.*A credential would leave the machine/,
      )
      expect(text()).toMatch(
        /Install a plugin.*Error.*could not complete this scenario.*Technical details.*synthetic connection reset/,
      )

      client.language = 'zh'
      await render()
      expect(text()).toMatch(/运行项目测试.*放行.*低风险/)
      expect(text()).toMatch(/向外部地址发送凭据.*拒绝.*高风险.*凭据将发送到机器之外/)
      expect(text()).toMatch(/安装插件.*出错.*评审未能完成此场景.*技术详情.*synthetic connection reset/)
      expect(text()).not.toMatch(/A credential would leave the machine|raw engine reason/)
      expect(requests.filter(({ url }) => url.endsWith('/test'))).toHaveLength(1)
    })
  })

  test.serial('does not overwrite edits made while a save is in flight', async () => {
    const { promise, resolve } = Promise.withResolvers()
    saveGate = promise
    await render()
    await change('model.label', 'model-saved')
    await click('rules.add')
    await change('rules.condition.label', 'Condition to save')
    try {
      await click('save')
      expect(button('saving').disabled).toBe(true)
      await change('model.label', 'typed-while-saving')
      await change('rules.condition.label', 'Condition to save\nWith a newer edit')
    } finally {
      await act(async () => resolve())
    }
    expect(field('model.label').value).toBe('typed-while-saving')
    expect(field('rules.condition.label').value).toBe('Condition to save\nWith a newer edit')
    expect(serverSettings.model).toBe('model-saved')
    expect(serverSettings.rules).toEqual([{ condition: 'Condition to save', verdict: 'ask' }])
    expect(button('test.run').disabled).toBe(true)
  })

  test.serial('aborts the pending save when the page closes', async () => {
    const { promise, resolve } = Promise.withResolvers()
    saveGate = promise
    try {
      await render()
      await change('model.label', 'model-saved')
      await click('save')
      const [request] = saveRequests()
      expect(request.signal.aborted).toBe(false)
      await render('summary')
      expect(request.signal.aborted).toBe(true)
    } finally {
      await act(async () => resolve())
    }
    expect(text()).toBe(copy('panel.desc'))
  })

  test.serial('adopts the server’s normalized values when nothing changed meanwhile', async () => {
    await render()
    await change('timeout.label', ' 15000 ')
    await click('save')
    expect(saveRequests()[0].body.settings.timeoutMs).toBe(' 15000 ')
    expect(field('timeout.label').value).toBe('15000')
    expect(button('test.run').disabled).toBe(false)
  })

  test.serial('runs the smoke test only against saved settings', async () => {
    await render()
    expect(button('test.run').disabled).toBe(false)
    await change('model.label', 'unsaved-model')
    expect(button('test.run').disabled).toBe(true)
    shown('test.unsaved')
    await click('test.run')
    expect(requests).toHaveLength(1)
    await click('save')
    expect(button('test.run').disabled).toBe(false)
    await click('test.run')
    const testRequest = requests.find(({ url }) => url.endsWith('/test'))
    expect(testRequest.method).toBe('POST')
    expect(testRequest.body).toEqual({})
  })

  test.serial('an edit aborts the smoke test and its late reply cannot replace a newer run', async () => {
    const { promise, resolve } = Promise.withResolvers()
    testGate = promise
    serverResults = [{ scenario: 'allow', ok: false, error: 'Obsolete smoke result' }]
    try {
      await render()
      await click('test.run')
      const pending = requests.at(-1)
      expect(pending.signal.aborted).toBe(false)
      await change('model.label', 'model-edited')
      expect(pending.signal.aborted).toBe(true)
      expect(button('test.run').disabled).toBe(true)

      await change('model.label', SERVER_SETTINGS.model)
      testGate = undefined
      serverResults = [{ scenario: 'allow', ok: false, error: 'Current smoke result' }]
      await click('test.run')
      expect(text()).toContain('Current smoke result')
      await act(async () => resolve())
      expect(text()).toContain('Current smoke result')
      expect(text()).not.toContain('Obsolete smoke result')

      await change('model.label', 'model-edited')
      expect(text()).not.toContain('Current smoke result')
    } finally {
      await act(async () => resolve())
    }
  })

  test.serial('saving aborts the smoke test and prevents another run until the save completes', async () => {
    const smoke = Promise.withResolvers()
    const save = Promise.withResolvers()
    testGate = smoke.promise
    saveGate = save.promise
    try {
      await render()
      await click('test.run')
      const pending = requests.at(-1)
      expect(pending.signal.aborted).toBe(false)
      await click('save')
      expect(pending.signal.aborted).toBe(true)
      expect(button('test.run').disabled).toBe(true)
    } finally {
      await act(async () => {
        smoke.resolve()
        save.resolve()
      })
    }
    expect(button('test.run').disabled).toBe(false)
  })

  test.serial('shows the route’s own error when a save fails', async () => {
    await render()
    saveError = 'decision-review: timeoutMs must be an integer between 5000 and 600000'
    await change('timeout.label', '12.5')
    await click('save')
    shown('save.error')
    shown('error.details')
    expect(text()).toContain(saveError)
  })
})
