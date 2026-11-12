import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

// Authentication belongs to the disposable profile created by verify-host.py.
const session = JSON.parse(await Bun.stdin.text())
const target = new URL(session.url)
console.log('Host browser input received')
assert.equal(target.protocol, 'http:')
assert.equal(target.hostname, '127.0.0.1')
assert.equal(typeof session.cookie, 'string')
const directory = 'artifacts/ui-evaluation/host'
const checks = []
const errors = []
const events = []
const requests = []
let view
let failure
async function until(expression) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await view.evaluate(expression)) return
    await Bun.sleep(60)
  }
  throw new Error(`Host browser condition timed out: ${expression}`)
}
async function clickText(text) {
  await until(
    `[...document.querySelectorAll('button')].some(button=>button.textContent.trim().replace(/^\\+ /,'')===${JSON.stringify(text)})`,
  )
  await view.evaluate(`(() => {
    document.querySelector('[data-ui-target]')?.removeAttribute('data-ui-target');
    [...document.querySelectorAll('button')].find(button=>button.textContent.trim().replace(/^\\+ /,'')===${JSON.stringify(text)}).setAttribute('data-ui-target','');
  })()`)
  await view.scrollTo('[data-ui-target]')
  await view.click('[data-ui-target]')
}
async function openConfig() {
  await view.click('button[aria-label="插件"]')
  await until('!!document.querySelector(\'button[aria-label="查看 决策评审"]\')')
  await view.click('button[aria-label="查看 决策评审"]')
  await until('!!document.querySelector(\'button[aria-label="配置 决策评审"]\')')
  await view.scrollTo('button[aria-label="配置 决策评审"]')
  await view.click('button[aria-label="配置 决策评审"]')
  await until('!!document.querySelector(".decision-review-rules")')
}
async function capture(name) {
  await until('document.getAnimations().every(animation => animation.playState !== "running")')
  await view.scrollTo('.decision-review-rules')
  const metrics = await view.evaluate(`(() => {
    const editor = document.querySelector('.decision-review-rules');
    const control = editor.querySelector('textarea');
    const rect = editor.getBoundingClientRect();
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,editor:{x:rect.x,width:rect.width,right:rect.right},dark:document.body.hasAttribute('data-ds-dark-theme'),inputFill:getComputedStyle(control).backgroundColor,inputColor:getComputedStyle(control).color};
  })()`)
  assert.equal(metrics.scrollWidth, metrics.width)
  assert.ok(metrics.editor.x >= 0 && metrics.editor.right <= metrics.width)
  assert.ok(metrics.editor.width >= 250, 'Rule editor is obstructed by host chrome')
  await view.scrollTo('textarea')
  await until(`(() => {
    const control = document.querySelector('textarea');
    const rect = control.getBoundingClientRect();
    return [rect.x + 8, rect.x + rect.width / 2, rect.right - 8].every(x =>
      document.elementFromPoint(x, rect.y + Math.min(rect.height / 2, 20)) === control);
  })()`)
  await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await Bun.write(`${directory}/${name}.png`, await view.screenshot({ format: 'png' }))
  checks.push({ name, metrics })
}
try {
  await mkdir(directory, { recursive: true })
  view = new Bun.WebView({
    width: 1280,
    height: 1000,
    // A disposable HOME has no user keychain; keep synthetic cookies in this browser only.
    backend: { type: 'chrome', url: false, argv: ['--use-mock-keychain', '--password-store=basic'] },
    console: (type, ...args) => events.push({ type, args }),
  })
  console.log('Host browser starting')
  await view.navigate('about:blank')
  console.log('Host browser ready')
  await view.cdp('Network.enable')
  console.log('Host network ready')
  await view.cdp('Runtime.enable')
  console.log('Host runtime ready')
  view.addEventListener('Network.requestWillBeSent', ({ data: event }) => {
    const url = new URL(event.request.url)
    if (url.searchParams.has('token')) url.searchParams.set('token', 'REDACTED')
    requests.push({ url: url.toString(), method: event.request.method })
  })
  view.addEventListener('Runtime.exceptionThrown', ({ data }) => errors.push(data))
  for (const cookie of session.cookie.split('; ')) {
    const separator = cookie.indexOf('=')
    const response = await view.cdp('Network.setCookie', {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: target.origin,
      httpOnly: true,
    })
    assert.equal(response.success, true)
  }
  console.log('Host media and session ready')
  await Promise.race([
    view.navigate(target.href),
    Bun.sleep(15000).then(() => {
      throw new Error('Host browser navigation timeout')
    }),
  ])
  console.log('Host browser navigated')
  await until('!!document.querySelector(\'button[aria-label="插件"]\')')
  await clickText('继续')
  console.log('Opening host config')
  await openConfig()
  console.log('Host config open')
  assert.equal(await view.evaluate('document.querySelectorAll("style[data-decision-review]").length'), 1)
  const release = await view.evaluate('window.__DSH_BOOT__.release')
  checks.push({ name: 'Installed host rendered real shared rule editor with one scoped stylesheet', release })
  await clickText('添加规则')
  assert.equal(await view.evaluate('document.activeElement.tagName'), 'TEXTAREA')
  const multiline = '  第一行\n\n  npm test -- --runInBand\nlast line | 保留空格  \n'
  await view.type(multiline)
  assert.equal(await view.evaluate('document.querySelector("textarea").value'), multiline)
  await view.press('Tab', { modifiers: ['Shift'] })
  assert.equal(await view.evaluate('document.activeElement.tagName'), 'SELECT')
  await view.press('拒')
  await view.press('Tab')
  assert.equal(await view.evaluate('document.querySelector(".decision-review-rule select").value'), 'deny')
  assert.equal(await view.evaluate('getComputedStyle(document.activeElement).outlineWidth'), '2px')
  await clickText('保存')
  await until('document.body.innerText.includes("设置已保存。")')
  await view.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await until('!document.body.hasAttribute("data-ds-dark-theme")')
  await capture('zh-light-rules')
  await view.scrollTo('button[aria-label="返回 决策评审"]')
  await view.click('button[aria-label="返回 决策评审"]')
  await until('!document.querySelector(".decision-review-panel")')
  await view.scrollTo('button[aria-label="配置 决策评审"]')
  await view.click('button[aria-label="配置 决策评审"]')
  await until('!!document.querySelector("textarea")')
  assert.equal(await view.evaluate('document.querySelector("textarea").value'), multiline)
  assert.equal(await view.evaluate('document.querySelector(".decision-review-rule select").value'), 'deny')
  checks.push({
    name: 'Keyboard verdict and exact multiline text persisted across closing/reopening host config',
    multiline,
  })
  await clickText('添加规则')
  await clickText('保存')
  await until('document.body.innerText.includes("请修正有提示的规则后再保存。")')
  assert.equal(
    await view.evaluate('[...document.querySelectorAll("textarea")].at(-1).getAttribute("aria-invalid")'),
    'true',
  )
  await view.click('.decision-review-rule-remove')
  assert.equal(await view.evaluate('document.activeElement===document.querySelector("textarea")'), true)
  await view.click('.decision-review-rule-remove')
  assert.equal(
    await view.evaluate('document.activeElement===document.querySelector(".decision-review-rules-add")'),
    true,
  )
  await clickText('添加规则')
  await view.type(multiline)
  await view.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await until('document.body.hasAttribute("data-ds-dark-theme")')
  await capture('zh-dark-rules')
  await view.resize(390, 844)
  await until('document.querySelector(".decision-review-rules").getBoundingClientRect().width >= 250')
  await capture('zh-dark-narrow-rules')
  checks.push({
    name: 'Validation, adjacent/empty focus restoration, live host theme and 390px viewport with collapsed sidebar passed',
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(
    events.filter(({ type }) => ['error', 'warn', 'warning'].includes(type)),
    [],
  )
  assert.ok(requests.every(({ url }) => url.startsWith(target.origin) || url.startsWith('data:')))
  assert.ok(requests.every(({ url }) => !url.includes('/api/decision-review/test')))
  await Bun.write(
    `${directory}/acceptance.json`,
    JSON.stringify({ status: 'passed', checks, requests, events, errors }, null, 2),
  )
  console.log(`Host rules browser acceptance passed: ${checks.length} groups`)
} catch (error) {
  failure = error
  await recordFailure(error)
  if (view) {
    try {
      await Bun.write(`${directory}/failure.png`, await view.screenshot({ format: 'png' }))
    } catch (screenshotError) {
      console.error('Cannot capture host failure screenshot:', screenshotError)
    }
  }
} finally {
  try {
    await view?.close()
  } catch (closeError) {
    if (failure) console.error('Cannot close host browser after failure:', closeError)
    else {
      failure = closeError
      await recordFailure(closeError)
    }
  }
}
if (failure) throw failure

async function recordFailure(error) {
  try {
    await Bun.write(
      `${directory}/acceptance.json`,
      JSON.stringify({ status: 'failed', message: String(error), checks, requests, events, errors }, null, 2),
    )
  } catch (writeError) {
    console.error('Cannot write host failure evidence:', writeError)
  }
}
