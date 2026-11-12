import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { withHmrEdits } from './preview-source-edits.mjs'
const args = process.argv.slice(2).filter((argument) => argument !== '--')
const target = new URL(args.find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:4317')
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname))
  throw new Error('Browser acceptance requires a localhost HTTP preview URL')
const origin = target.origin
const checkHmr = process.argv.includes('--hmr')
const failures = []
const evidenceDirectory = 'artifacts/browser'
const events = []
const requests = []
const checks = []
const errors = []
let navigations = 0
const view = new Bun.WebView({
  width: 1280,
  height: 1000,
  backend: { type: 'chrome', url: false },
  console: (type, ...args) => events.push({ type, args }),
})
const body = () => view.evaluate('document.body.innerText')
async function until(expression, timeout = 8000) {
  const deadline = Date.now() + timeout
  do {
    if (await view.evaluate(expression)) return
    await Bun.sleep(60)
  } while (Date.now() < deadline)
  throw new Error(`Browser condition timed out: ${expression}
${await body()}`)
}
function textIncludes(text) {
  return `document.body.innerText.includes(${JSON.stringify(text)})`
}
async function field(label) {
  return await view.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(element => element.textContent.startsWith(${JSON.stringify(label)}));
    const control = label?.querySelector('input,select,textarea');
    if (!control) throw new Error('Missing control: '+${JSON.stringify(label)});
    document.querySelector('[data-evidence-control]')?.removeAttribute('data-evidence-control');
    control.setAttribute('data-evidence-control','');
    return '[data-evidence-control]';
  })()`)
}
async function value(label) {
  const selector = await field(label)
  return await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
}
async function fill(label, value) {
  const selector = await field(label)
  await view.scrollTo(selector)
  await view.click(selector)
  await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`)
  await view.type(value)
  assert.equal(await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value)
}
async function choose(label, value) {
  const selector = await field(label)
  await view.evaluate(
    `(() => { const control = document.querySelector(${JSON.stringify(selector)}); if (![...control.options].some(option=>option.value===${JSON.stringify(value)})) throw new Error('Missing option'); control.value=${JSON.stringify(value)}; control.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  )
  await Bun.sleep(80)
}
async function click(text) {
  const selector = await view.evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim().replace(/^\\+ /,'')===${JSON.stringify(text)});
    if (!button) throw new Error('Missing button: '+${JSON.stringify(text)});
    document.querySelector('[data-evidence-button]')?.removeAttribute('data-evidence-button');
    button.setAttribute('data-evidence-button',''); return '[data-evidence-button]';
  })()`)
  await view.scrollTo(selector)
  await view.click(selector)
}
async function disabled(text) {
  return await view.evaluate(
    `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})?.disabled`,
  )
}
async function scene(id, wait = true) {
  await choose('预览场景', id)
  if (wait) await until(`!!document.querySelector('.decision-review-panel')`)
}
async function capture(name) {
  const metrics = await view.evaluate(
    '({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, surfaceWidth: document.querySelector(".preview-surface").getBoundingClientRect().width })',
  )
  assert.equal(metrics.scrollWidth, metrics.width, `Horizontal overflow in ${name}`)
  const screenshot = await view.cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  })
  await Bun.write(`${evidenceDirectory}/${name}.png`, Buffer.from(screenshot.data, 'base64'))
  return metrics
}
function passed(name, details) {
  checks.push({ name, details })
  console.log('PASS', name, details ?? '')
}
try {
  await mkdir(evidenceDirectory, { recursive: true })
  await view.navigate('about:blank')
  await view.cdp('Network.enable')
  await view.cdp('Runtime.enable')
  view.addEventListener('Network.requestWillBeSent', (event) =>
    requests.push({ url: event.data.request.url, method: event.data.request.method }),
  )
  view.addEventListener('Network.responseReceived', (event) => {
    const request = requests.findLast((request) => request.url === event.data.response.url)
    if (request) request.status = event.data.response.status
  })
  view.addEventListener('Runtime.exceptionThrown', (event) => errors.push(event.data))
  view.onNavigated = () => navigations++
  await view.navigate(origin)
  await until(textIncludes('自动评审 12 次'))
  assert.match(await body(), /授权评审/)
  await click('运行冒烟测试（3 个场景）')
  await until('document.querySelectorAll("tbody tr").length===3')
  passed('Chinese/light/wide Decisions and three synthetic smoke results', await capture('zh-light-wide-results'))
  await fill('Decisions 模型', 'unsaved-preview-draft')
  assert.equal(await disabled('运行冒烟测试（3 个场景）'), true)
  await choose('界面语言', 'en')
  await choose('主题', 'dark')
  await choose('预览宽度', 'narrow')
  await view.resize(390, 844)
  assert.equal(await value('Decisions model'), 'unsaved-preview-draft')
  assert.match(await body(), /Save your changes first/)
  passed('Language/theme/width preserve unsaved draft; real narrow viewport', await capture('en-dark-narrow-dirty'))
  await click('Save')
  await until(textIncludes('Settings saved.'))
  await click('重新加载已保存配置')
  await until(
    `document.querySelector('.decision-review-panel') && [...document.querySelectorAll('input')].some(input=>input.value==='unsaved-preview-draft')`,
  )
  passed('Successful save and HTTP reload persist normalized values')
  await scene('session')
  assert.equal(await value('Review engine'), 'session')
  assert.equal(await disabled('Run smoke test (3 scenarios)'), true)
  assert.doesNotMatch(await body(), /Decisions API URL/)
  await choose('主题', 'light')
  passed('English/light/narrow Follow session', await capture('en-light-session'))
  await choose('界面语言', 'zh')
  await view.resize(1280, 1000)
  await choose('预览宽度', 'wide')
  await scene('load-error', false)
  await until(textIncludes('无法加载设置。'))
  await click('恢复接口')
  await until('!!document.querySelector(".decision-review-panel")')
  passed('Config HTTP 503 recovers by restoring endpoint and reloading')
  await scene('save-error')
  await fill('Decisions 模型', 'save-recovery-draft')
  await click('保存')
  await until(textIncludes('无法保存设置。'))
  assert.equal(await value('Decisions 模型'), 'save-recovery-draft')
  await capture('zh-save-failed')
  await click('恢复接口')
  assert.equal(await value('Decisions 模型'), 'save-recovery-draft')
  await click('保存')
  await until(textIncludes('设置已保存。'))
  passed('Save HTTP 503 preserves draft; recovery and retry succeed')
  await scene('multiline')
  const multiline = `  第一行

  npm test -- --runInBand
last line | 保留空格  
`
  await fill('匹配条件', multiline)
  await click('保存')
  await until(textIncludes('设置已保存。'))
  await click('重新加载已保存配置')
  await until('!!document.querySelector("textarea")')
  assert.equal(await value('匹配条件'), multiline)
  await view.scrollTo('textarea')
  await view.click('textarea')
  await view.press('Tab', { modifiers: ['Shift'] })
  assert.equal(await view.evaluate('document.activeElement.tagName'), 'SELECT')
  await view.press('拒')
  assert.equal(await value('评审结论'), 'deny')
  await view.press('Tab')
  assert.equal(await view.evaluate('document.activeElement.tagName'), 'TEXTAREA')
  assert.equal(await view.evaluate('getComputedStyle(document.activeElement).outlineWidth'), '2px')
  const semantics = await view.evaluate(`(() => {
    const control = document.querySelector('textarea');
    return {label: control.labels[0].textContent, required: control.getAttribute('aria-required'), descriptions: control.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id)?.textContent)};
  })()`)
  assert.match(semantics.label, /匹配条件/)
  assert.equal(semantics.required, 'true')
  assert.ok(semantics.descriptions.every(Boolean))
  await click('保存')
  await until(textIncludes('设置已保存。'))
  await capture('zh-rules-keyboard')
  await choose('界面语言', 'en')
  await choose('主题', 'dark')
  await view.resize(390, 844)
  await choose('预览宽度', 'narrow')
  assert.equal(await value('Condition'), multiline)
  await capture('en-dark-narrow-rules')
  const longCondition = 'Long rule condition 中文 | '.repeat(17)
  await fill('Condition', longCondition)
  assert.equal(await view.evaluate('document.querySelector("textarea").getAttribute("aria-invalid")'), 'true')
  await capture('en-dark-narrow-long-rule')
  await fill('Condition', multiline)
  await choose('界面语言', 'zh')
  await choose('主题', 'light')
  await view.resize(1280, 1000)
  await choose('预览宽度', 'wide')
  await click('添加规则')
  assert.equal(
    await view.evaluate('document.activeElement === [...document.querySelectorAll("textarea")].at(-1)'),
    true,
  )
  await click('保存')
  await until(textIncludes('请修正有提示的规则后再保存。'))
  const invalid = await view.evaluate(`(() => {
    const control = [...document.querySelectorAll('textarea')].at(-1);
    return {invalid:control.getAttribute('aria-invalid'),descriptions:control.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id)?.textContent)};
  })()`)
  assert.equal(invalid.invalid, 'true')
  assert.match(invalid.descriptions.join(' '), /条件/)
  assert.ok(invalid.descriptions.every(Boolean))
  await capture('zh-multiline-validation')
  passed('Multiline text survives save/reload byte-for-byte; blank rule blocks save', { multiline })
  await view.click('.decision-review-rule-remove')
  assert.equal(await view.evaluate('document.activeElement === document.querySelector("textarea")'), true)
  await view.click('.decision-review-rule-remove')
  assert.equal(
    await view.evaluate('document.activeElement === document.querySelector(".decision-review-rules-add")'),
    true,
  )
  passed('Keyboard select, focus ring, linked errors, add/remove focus and bilingual narrow rules', {
    semantics,
    invalid,
  })
  await scene('invalid')
  assert.equal(await value('评审引擎'), 'session')
  assert.equal(await value('Decisions API 地址'), '')
  assert.equal(await value('Decisions 模型'), '')
  assert.match(await body(), /已保存的设置无效/)
  await click('保存')
  await until(textIncludes('无法保存设置。'))
  await fill('Decisions API 地址', 'https://fixed.example.invalid/decisions')
  await fill('Decisions 模型', 'repaired-synthetic-reviewer')
  await click('保存')
  await until(textIncludes('设置已保存。'))
  assert.doesNotMatch(await body(), /已保存的设置无效/)
  assert.equal(await value('评审引擎'), 'session')
  passed('Invalid stored route/model require real validation and repair while keeping session engine')
  await scene('slow', false)
  await until(textIncludes('正在加载设置…'))
  await scene('session')
  await Bun.sleep(2100)
  assert.equal(await value('评审引擎'), 'session')
  passed('Switch during delayed load cancels old scene without stale form')
  await scene('slow')
  await fill('Decisions 模型', 'submitted-before-edit')
  await click('添加规则')
  await fill('匹配条件', multiline)
  await click('保存')
  await until(textIncludes('正在保存…'))
  assert.equal(await disabled('运行冒烟测试（3 个场景）'), true)
  await capture('zh-saving')
  await fill('Decisions 模型', 'edited-during-save')
  await fill('匹配条件', multiline + 'New edit after submission')
  await until(`![...document.querySelectorAll('button')].some(button=>button.textContent==='正在保存…')`)
  assert.equal(await value('Decisions 模型'), 'edited-during-save')
  assert.match(await body(), /请先保存修改/)
  assert.equal(await value('匹配条件'), multiline + 'New edit after submission')
  await click('重新加载已保存配置')
  await until(
    `document.querySelector('.decision-review-panel') && [...document.querySelectorAll('input')].some(input=>input.value==='submitted-before-edit')`,
  )
  assert.equal(await value('匹配条件'), multiline)
  passed('Saving state is visible; model and multiline rule edits made during save are not overwritten')
  await click('运行冒烟测试（3 个场景）')
  await until(textIncludes('正在测试…'))
  await scene('session')
  await Bun.sleep(2100)
  assert.equal(await view.evaluate('document.querySelectorAll("tbody tr").length'), 0)
  passed('Switch during delayed smoke cancels old results')
  await scene('test-error')
  await click('运行冒烟测试（3 个场景）')
  await until(textIncludes('无法运行冒烟测试。'))
  await click('恢复接口')
  await click('运行冒烟测试（3 个场景）')
  await until('document.querySelectorAll("tbody tr").length===3')
  await scene('test-mixed')
  await click('运行冒烟测试（3 个场景）')
  await until('document.querySelectorAll("tbody tr").length===3')
  assert.match(await body(), /评审未能完成此场景/)
  passed('Test request error recovers; mixed synthetic row error renders')
  await scene('stats-error')
  await Bun.sleep(250)
  assert.doesNotMatch(await body(), /自动评审 12 次/)
  await click('恢复接口')
  await until(textIncludes('自动评审 12 次'), 6500)
  await scene('stats-empty')
  await Bun.sleep(250)
  assert.doesNotMatch(await body(), /自动评审 12 次/)
  passed('Stats failure recovers on polling; zero-review fixture hides pill')
  if (checkHmr) {
    await scene('decisions')
    await fill('Decisions 模型', 'hot-refresh-unsaved')
    const before = await view.evaluate('({timeOrigin:performance.timeOrigin})')
    const panelPath = 'src/client/panel.tsx'
    const cssPath = 'src/client/styles.css'
    const htmlPath = 'preview/index.html'
    const changes = [
      {
        path: panelPath,
        transform: (source) => source.replace("{t('panel.title')}", "{t('panel.title')}<span> · TSX HMR</span>"),
      },
      {
        path: cssPath,
        transform: (source) =>
          source.replace(
            '.decision-review-panel {',
            `.decision-review-panel {
  outline: 3px solid rgb(231, 101, 27);`,
          ),
      },
      { path: htmlPath, transform: (source) => source.replace('开发预览</title>', '开发预览 HTML HMR</title>') },
    ]
    const beforeNavigations = navigations
    await withHmrEdits(changes, async ({ apply, restore }) => {
      await apply(panelPath)
      await until(textIncludes('TSX HMR'))
      assert.equal(await value('Decisions 模型'), 'hot-refresh-unsaved')
      assert.equal(await view.evaluate('performance.timeOrigin'), before.timeOrigin)
      const tsxNavigations = navigations
      await apply(cssPath)
      await until(
        `getComputedStyle(document.querySelector('.decision-review-panel')).outlineColor==='rgb(231, 101, 27)'`,
      )
      assert.equal(await value('Decisions 模型'), 'hot-refresh-unsaved')
      assert.equal(navigations, beforeNavigations)
      await capture('shared-tsx-css-hmr')
      passed('Actual shared TSX and CSS HMR retain draft and do not navigate', {
        beforeNavigations,
        tsxNavigations,
        cssNavigations: navigations,
        timeOrigin: before.timeOrigin,
      })
      await restore([panelPath, cssPath])
      await until(`!${textIncludes('TSX HMR')}`)
      await apply(htmlPath)
      await until('document.title.includes("HTML HMR")')
      await until('!!document.querySelector(".decision-review-panel")')
      assert.notEqual(await view.evaluate('performance.timeOrigin'), before.timeOrigin)
      assert.equal(await value('Decisions 模型'), 'synthetic-reviewer')
      passed('HTML entry edit triggers full reload and resets draft', { navigations })
    })
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every((request) => new URL(request.url).origin === origin))
  passed('All browser requests remain localhost; no uncaught runtime exceptions')
} catch (error) {
  failures.push(error)
} finally {
  try {
    view.close()
  } catch (error) {
    failures.push(error)
  }
  try {
    await Bun.write(
      `${evidenceDirectory}/acceptance.json`,
      JSON.stringify(
        {
          status: failures.length ? 'failed' : 'passed',
          revision: Bun.revision,
          checks,
          requests,
          console: events,
          errors,
          navigations,
          failures: [...new Set(failures.flatMap(failureMessages))],
        },
        null,
        2,
      ) + '\n',
    )
  } catch (error) {
    failures.push(error)
  }
  console.log('CHECKS', checks.length, 'UNCAUGHT', errors.length, 'STATUS', failures.length ? 'failed' : 'passed')
}
if (failures.length) throw new AggregateError(failures, 'Preview verification failed')

function failureMessages(error) {
  return error instanceof AggregateError ? error.errors.flatMap(failureMessages) : [String(error.stack ?? error)]
}
