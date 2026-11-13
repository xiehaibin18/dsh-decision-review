import { afterEach, describe, expect, jest, mock, spyOn, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act } from 'react'
import { apply } from '../dist/index.js'
import { CLIENT_ORIGIN, CONFIG_SLOT, STATS_SLOT, createClient } from './client-harness.js'
import { makeAnswers, makeHost, makeProfileDir, removeDir } from './helpers.js'

describe('built client in a simulated DSH host', () => {
  let client
  let host
  let profileDir
  let decisionsFetch
  let info

  afterEach(async () => {
    try {
      await client?.dispose()
    } finally {
      try {
        await host?.dispose()
      } finally {
        decisionsFetch?.mockRestore()
        info?.mockRestore()
        if (profileDir) removeDir(profileDir)
      }
    }
  })

  test.serial('localizes a real settings validation error without submitting again', async () => {
    profileDir = makeProfileDir()
    host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
    apply(host.ctx)
    const paths = []
    client = createClient(async (path, init) => {
      paths.push(path)
      const url = new URL(path, CLIENT_ORIGIN)
      return host.routes.get(url.pathname).fetch(new Request(url, init))
    })
    await client.load()
    client.language = 'zh'
    await client.render(CONFIG_SLOT, { view: 'page' })
    const endpoint = [...client.container.querySelectorAll('label')].find((label) =>
      label.textContent.startsWith('Decisions API 地址'),
    ).control
    await client.change(endpoint, 'invalid-endpoint')
    await act(async () => client.button('保存').click())
    const error = () => client.container.querySelector('[role="alert"]').textContent
    expect(error()).toContain('Decisions API 地址必须是')
    expect(error()).not.toContain('invalid-endpoint')

    client.language = 'en'
    await client.render(CONFIG_SLOT, { view: 'page' })
    expect(error()).toContain('The Decisions API URL must be')
    expect(endpoint.value).toBe('invalid-endpoint')
    expect(paths).toEqual(['/api/decision-review/config', '/api/decision-review/save'])
  })

  test.serial('saves and reloads settings through the real host routes', async () => {
    const endpoint = 'https://decisions.example.test/v1/decisions'
    const storedKey = 'test-only-stored-key'
    const condition = '\n  Deploy service A | service B.\n  仅限生产环境｜保留末尾空格。  \n'
    const rules = [{ condition, verdict: 'deny' }]
    profileDir = makeProfileDir()

    function startHost() {
      host = makeHost({ profileContext: { name: 'test', dir: profileDir } })
      apply(host.ctx)
    }

    info = spyOn(console, 'info').mockImplementation(() => {})
    const decisionsCalls = []
    decisionsFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe(endpoint)
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
    client = createClient(async (path, init) => {
      expect(path).toMatch(/^\/api\/decision-review\//)
      const url = new URL(path, CLIENT_ORIGIN)
      const request = new Request(url, init)
      const route = host.routes.get(url.pathname)
      expect(route?.methods, `Unregistered route: ${request.method} ${path}`).toContain(request.method)
      const response = await route.fetch(request)
      const sent = init?.body === undefined ? undefined : JSON.parse(init.body)
      requests.push({ path, sent, received: await response.clone().json() })
      return response
    })
    await client.load()
    const { container } = client
    const stylesheet = client.window.document.querySelector('style[data-decision-review]')
    expect(stylesheet?.textContent).toContain('.decision-review-panel')

    function button(label) {
      const control = client.button(label)
      expect(control, `Missing button: ${label}`).toBeDefined()
      return control
    }

    const click = (label) => act(async () => button(label).click())
    const password = () => container.querySelector('input[type=password]')
    const rule = () => container.querySelector('textarea')
    const verdict = () => rule().closest('section').querySelector('[role="combobox"]')

    await client.render(CONFIG_SLOT, { view: 'page' })
    expect(container.textContent).toMatch(/Decision Review/)
    expect(password().value).toBe('')
    expect(password().placeholder).toMatch(/saved/)
    expect(button('Run smoke test (3 scenarios)').disabled).toBe(false)

    await click('Add rule')
    await client.change(rule(), condition)
    await client.choose(verdict(), 'Deny')
    expect(button('Run smoke test (3 scenarios)').disabled).toBe(true)
    await click('Run smoke test (3 scenarios)')
    expect(requests).toHaveLength(1)
    await click('Save')
    expect(container.textContent).toContain('Settings saved.')
    expect(button('Run smoke test (3 scenarios)').disabled).toBe(false)
    expect(requests[1].sent.settings.rules).toEqual(rules)
    expect(requests[1].sent.settings).not.toHaveProperty('apiKey')

    // Restart the server and remount the panel to read the on-disk settings.
    await client.unmount()
    await host.dispose()
    startHost()
    client.language = 'zh'
    await client.render(CONFIG_SLOT, { view: 'page' })
    expect(container.textContent).toMatch(/决策评审/)
    expect(rule().value).toBe(condition)
    expect(verdict().textContent).toBe('拒绝')
    expect(password().value).toBe('')
    expect(password().placeholder).toMatch(/已保存/)

    await click('移除已保存的密钥')
    expect(button('运行冒烟测试（3 个场景）').disabled).toBe(true)
    await click('保存')
    expect(requests[3].sent.settings.clearApiKey).toBe(true)
    expect(password().placeholder).toBe('')
    expect(button('运行冒烟测试（3 个场景）').disabled).toBe(false)
    await click('运行冒烟测试（3 个场景）')

    const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/运行项目测试.*放行.*低风险/)
    expect(rows[1]).toMatch(/向外部地址发送凭据.*拒绝.*高风险.*疑似数据外传/)
    expect(rows[2]).toMatch(/安装插件.*放行.*低风险/)
    expect(decisionsCalls).toHaveLength(3)
    for (const { authorization, body } of decisionsCalls) {
      expect(authorization ?? '').not.toContain(storedKey)
      const operatorRule = body.questions.find(({ name }) => name === 'operator_rule')
      expect(operatorRule.choices.some(({ description }) => description.endsWith(condition))).toBe(true)
    }

    expect(requests.map(({ path }) => path.split('/').at(-1))).toEqual(['config', 'save', 'config', 'save', 'test'])
    expect(requests.slice(0, 4).map(({ received }) => received.settings.hasApiKey)).toEqual([true, true, true, false])
    for (const { received } of requests) {
      expect(received.settings ?? {}).not.toHaveProperty('apiKey')
      expect(JSON.stringify(received)).not.toContain(storedKey)
    }

    const { unregisterLocale } = client
    await client.dispose()
    client = undefined
    expect(unregisterLocale).toHaveBeenCalledTimes(1)
    expect(stylesheet.isConnected).toBe(false)
  })
})

describe('composer approval stats pill', () => {
  let client
  let fetchStats
  let hidden

  function statsResponse(overrides = {}) {
    return Response.json({
      reviewed: 0,
      autoAllowed: 0,
      asked: 0,
      finalDenied: 0,
      failed: 0,
      approvals: { asked: 0, allowed: 0, rejected: 0, cancelled: 0, unavailable: 0 },
      passRate: null,
      ...overrides,
    })
  }

  async function advance(ms) {
    await act(async () => {
      jest.advanceTimersByTime(ms)
    })
  }

  const trigger = () => client.container.querySelector('button[aria-haspopup="dialog"]')
  const card = () => client.container.querySelector('[role="dialog"]')

  function metrics() {
    return Object.fromEntries(
      [...card().querySelectorAll('dl > div')].map((row) => [
        row.querySelector('dt').textContent,
        row.querySelector('dd').textContent,
      ]),
    )
  }

  async function render(sessionId) {
    await client.render(STATS_SLOT, { sessionId })
  }

  async function openClient() {
    jest.useFakeTimers()
    hidden = false
    fetchStats = mock(async (url) => {
      throw new Error(`Unexpected stats request: ${url}`)
    })
    client = createClient(fetchStats)
    Object.defineProperty(client.window.document, 'hidden', { get: () => hidden })
    await client.load()
  }

  afterEach(async () => {
    try {
      await client?.dispose()
    } finally {
      client = undefined
      jest.useRealTimers()
    }
  })

  test.serial('polls the normalized session on schedule, skips hidden pages, and stops on unmount', async () => {
    await openClient()
    fetchStats
      .mockResolvedValueOnce(statsResponse())
      .mockResolvedValueOnce(
        statsResponse({ reviewed: 6, autoAllowed: 3, asked: 1, finalDenied: 1, failed: 1, passRate: 50 }),
      )
      .mockResolvedValueOnce(statsResponse({ reviewed: 8, autoAllowed: 6, asked: 2, passRate: 75 }))

    await render('session-test/with space')
    expect(fetchStats.mock.calls.map(([url]) => url)).toEqual([
      '/api/decision-review/stats?session=test%2Fwith%20space',
    ])
    expect(client.container.textContent).toBe('')

    await advance(3999)
    expect(fetchStats).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchStats).toHaveBeenCalledTimes(2)
    expect(client.container.textContent).toBe('6 reviewed · 50% auto-passed')
    expect(trigger().hasAttribute('title')).toBe(false)
    expect(card()).toBeNull()
    await act(async () => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(metrics()).toEqual({
      'Auto-pass rate': '50%',
      'Auto-passed': '3',
      'Sent for approval': '1',
      Blocked: '1',
      'Review failures': '1',
    })

    hidden = true
    await advance(8000)
    expect(fetchStats).toHaveBeenCalledTimes(2)
    expect(trigger().textContent).toBe('6 reviewed · 50% auto-passed')
    hidden = false
    await advance(4000)
    expect(fetchStats).toHaveBeenCalledTimes(3)
    expect(trigger().textContent).toBe('8 reviewed · 75% auto-passed')
    expect(card()).not.toBeNull()
    expect(metrics()['Auto-passed']).toBe('6')

    await client.unmount()
    await advance(8000)
    expect(fetchStats).toHaveBeenCalledTimes(3)
    expect(client.container.textContent).toBe('')
  })

  test.serial('clears stats on session change and polls without overlapping requests', async () => {
    await openClient()
    const previous = Promise.withResolvers()
    const current = Promise.withResolvers()
    const pending = Promise.withResolvers()
    const obsoleteStats = statsResponse({ reviewed: 99, autoAllowed: 99, passRate: 100 })
    const currentStats = statsResponse({ reviewed: 2, autoAllowed: 1, asked: 1, passRate: 50 })
    const pendingStats = statsResponse({ reviewed: 9, autoAllowed: 9, passRate: 100 })
    fetchStats
      .mockResolvedValueOnce(statsResponse({ reviewed: 1, autoAllowed: 1, passRate: 100 }))
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise)
      .mockReturnValueOnce(pending.promise)

    try {
      await render('session-old')
      expect(client.container.textContent).toBe('1 reviewed · 100% auto-passed')
      await act(async () => trigger().click())
      expect(card()).not.toBeNull()
      await advance(4000)
      expect(fetchStats).toHaveBeenCalledTimes(2)
      await advance(8000)
      expect(fetchStats).toHaveBeenCalledTimes(2)

      await render('session-current')
      expect(fetchStats.mock.calls.map(([url]) => url)).toEqual([
        '/api/decision-review/stats?session=old',
        '/api/decision-review/stats?session=old',
        '/api/decision-review/stats?session=current',
      ])
      expect(fetchStats.mock.calls[1][1].signal.aborted).toBe(true)
      expect(client.container.textContent).toBe('')
      await act(async () => current.resolve(currentStats))
      expect(client.container.textContent).toBe('2 reviewed · 50% auto-passed')
      expect(trigger().getAttribute('aria-expanded')).toBe('false')
      expect(card()).toBeNull()

      await act(async () => previous.resolve(obsoleteStats))
      expect(client.container.textContent).toBe('2 reviewed · 50% auto-passed')

      await advance(4000)
      expect(fetchStats).toHaveBeenCalledTimes(4)
      const [url, { signal }] = fetchStats.mock.calls.at(-1)
      expect(url).toBe('/api/decision-review/stats?session=current')
      await client.unmount()
      expect(signal.aborted).toBe(true)
      await act(async () => pending.resolve(pendingStats))
      await advance(8000)
      expect(fetchStats).toHaveBeenCalledTimes(4)
      expect(client.container.textContent).toBe('')
    } finally {
      await act(async () => {
        previous.resolve(obsoleteStats)
        current.resolve(currentStats)
        pending.resolve(pendingStats)
      })
    }
  })
})
