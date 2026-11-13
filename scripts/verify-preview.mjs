import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { withHmrEdits } from './preview-source-edits.mjs'
const args = process.argv.slice(2).filter((argument) => argument !== '--')
const target = new URL(args.find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:4317')
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname))
  throw new Error('Browser acceptance requires a localhost HTTP preview URL')
const origin = target.origin
const checkHmr = process.argv.includes('--hmr')
const configSlot = 'plugins.row.config'
const statsSlot = 'conversation.composer.dock'
const statsTrigger = '.decision-review-stats-trigger'
const statsCard = '.decision-review-stats [role=dialog]'
const statsPill = `document.querySelector('${statsTrigger}')`
const statsExpanded = `${statsPill}?.getAttribute('aria-expanded') === 'true'`
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
async function statsDetails() {
  return view.evaluate(`(() => {
    const popup = document.querySelector('${statsCard}');
    return { title: document.getElementById(popup.getAttribute('aria-labelledby')).textContent.trim(),
      total: popup.querySelector('.decision-review-stats-total').textContent,
      metrics: Object.fromEntries([...popup.querySelectorAll('dl > div')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])) };
  })()`)
}
async function statsGeometry() {
  await until(
    `document.querySelector('${statsCard}')?.closest('[data-side="top"]')?.getBoundingClientRect().bottom < ${statsPill}.getBoundingClientRect().top`,
  )
  const metrics = await view.evaluate(`(() => {
    const popup = document.querySelector('${statsCard}');
    const trigger = ${statsPill}.getBoundingClientRect();
    const card = popup.getBoundingClientRect();
    const frame = document.querySelector('.preview-window').getBoundingClientRect();
    const cardX = card.x + card.width / 2;
    const cardY = card.y + card.height / 2;
    return { fits: card.left >= frame.left && card.right <= frame.right && card.top >= frame.top && card.bottom <= frame.bottom,
      above: card.bottom < trigger.top, clickable: popup.contains(document.elementFromPoint(cardX, cardY)), cardX, cardY,
      scale: frame.width / document.querySelector('.preview-window').offsetWidth, background: getComputedStyle(popup).backgroundColor };
  })()`)
  assert.ok(metrics.fits && metrics.above && metrics.clickable, JSON.stringify(metrics))
  return metrics
}
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
    const control = label?.control;
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
const thresholds = '.decision-review-thresholds'
const thresholdSummary = thresholds + ' > summary'
async function openThresholds() {
  if (!(await view.evaluate(`document.querySelector('${thresholds}')?.open`))) {
    await view.scrollTo(thresholdSummary)
    await view.click(thresholdSummary)
  }
}
async function threshold(name) {
  const row = await view.evaluate(`(() => {
    const control = [...document.querySelectorAll('${thresholds} input[type=range]')].find(input =>
      document.getElementById(input.getAttribute('aria-labelledby'))?.textContent.startsWith(${JSON.stringify(name + ' — ')}));
    if (!control) throw new Error('Missing threshold: ' + ${JSON.stringify(name)});
    document.querySelector('[data-evidence-threshold]')?.removeAttribute('data-evidence-threshold');
    control.closest('.decision-review-threshold').setAttribute('data-evidence-threshold', '');
    return '[data-evidence-threshold]';
  })()`)
  return row
}
async function thresholdState(name) {
  const row = await threshold(name)
  return await view.evaluate(`(() => {
    const row = document.querySelector('${row}');
    const input = row.querySelector('input[type=range]');
    const label = document.getElementById(input.getAttribute('aria-labelledby')).textContent;
    return { value: Number(input.getAttribute('aria-valuenow')), spoken: input.getAttribute('aria-valuetext'),
      min: Number(input.min), max: Number(input.max), step: Number(input.step), label,
      flags: [...row.querySelectorAll('[data-flag]')].map(flag => flag.textContent.trim()) };
  })()`)
}
async function exactThreshold(name, score) {
  const row = await threshold(name)
  const input = row + ' input.decision-review-threshold-value'
  await view.scrollTo(input)
  await view.click(input)
  await view.evaluate(`document.querySelector('${input}').select()`)
  if (score) await view.type(score)
  else await view.press('Backspace')
  assert.equal(await view.evaluate(`document.querySelector('${input}').value`), score)
}
async function pressThreshold(name, key) {
  const row = await threshold(name)
  await view.evaluate(`document.querySelector('${row} input[type=range]').focus()`)
  await view.press(key)
}
async function dragThreshold(name, to) {
  const row = await threshold(name)
  await view.scrollTo(row)
  const { start, end } = await view.evaluate(`(() => {
    const row = document.querySelector('${row}');
    const thumb = row.querySelector('[data-slot=slider-thumb]').getBoundingClientRect();
    const track = row.querySelector('[data-slot=slider-track]').getBoundingClientRect();
    const y = track.top + track.height / 2;
    return { start: { x: thumb.left + thumb.width / 2, y }, end: { x: track.left + track.width * ${to}, y } };
  })()`)
  await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...start })
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...end })
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...end })
  await until(`Number(document.querySelector('${row} input[type=range]').getAttribute('aria-valuenow')) === ${to}`)
}
async function thresholdGeometry(name, scores) {
  const row = await threshold(name)
  const geometry = await view.evaluate(`(() => {
    const row = document.querySelector('${row}');
    const track = row.querySelector('[data-slot=slider-track]').getBoundingClientRect();
    const flags = [...row.querySelectorAll('[data-flag]')].map(flag => {
      const stem = flag.querySelector('.decision-review-threshold-flag-stem').getBoundingClientRect();
      const label = flag.querySelector('.decision-review-threshold-flag-label').getBoundingClientRect();
      return { score: (stem.left - track.left) / track.width, left: label.left, right: label.right, top: label.top, bottom: label.bottom };
    });
    const score = row.querySelector('.decision-review-threshold-value');
    return { left: track.left, right: track.right, flags,
      scoreFits: score.scrollWidth <= score.clientWidth && score.scrollHeight <= score.clientHeight };
  })()`)
  assert.equal(geometry.scoreFits, true, 'The current score should fit on one line')
  assert.equal(geometry.flags.length, scores.length)
  geometry.flags.forEach((flag, i) => {
    assert.ok(Math.abs(flag.score - scores[i]) < 0.01, JSON.stringify(geometry))
    assert.ok(flag.left >= geometry.left - 1 && flag.right <= geometry.right + 1, JSON.stringify(geometry))
  })
  if (geometry.flags.length === 2) assert.ok(geometry.flags[0].bottom <= geometry.flags[1].top)
  return geometry
}
async function description(label) {
  const selector = await field(label)
  return await view.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')`,
  )
}
async function radioGroup(label) {
  return await view.evaluate(`(() => {
    const group = [...document.querySelectorAll('[role=radiogroup]')].find(candidate => document.getElementById(candidate.getAttribute('aria-labelledby'))?.textContent === ${JSON.stringify(label)});
    if (!group) throw new Error('Missing radio group: ' + ${JSON.stringify(label)});
    document.querySelector('[data-evidence-group]')?.removeAttribute('data-evidence-group');
    group.setAttribute('data-evidence-group', '');
    return '[data-evidence-group]';
  })()`)
}
async function checkedRadio(label) {
  const group = await radioGroup(label)
  const checked = await view.evaluate(
    `[...document.querySelectorAll('${group} [role=radio][aria-checked=true]')].map(node => node.textContent)`,
  )
  assert.equal(checked.length, 1, 'Expected one selected option: ' + label)
  return checked[0]
}
async function selectText(label) {
  const selector = await field(label)
  return await view.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).querySelector('[data-slot="select-value"]').textContent`,
  )
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
async function openSelect(label) {
  const selector = await field(label)
  await view.scrollTo(selector)
  await view.click(selector)
  await until(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded') === 'true'`)
  return selector
}
async function chooseOption(text) {
  await view.evaluate(`(() => {
    document.querySelector('[data-evidence-option]')?.removeAttribute('data-evidence-option');
    const option = [...document.querySelectorAll('[role=option]')].find(option => option.textContent === ${JSON.stringify(text)});
    if (!option) throw new Error('Missing option: '+${JSON.stringify(text)});
    option.setAttribute('data-evidence-option', '');
  })()`)
  await view.click('[data-evidence-option]')
  await until('!document.querySelector("[role=combobox][aria-expanded=true]")')
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
const statsRequests = () => requests.filter(({ url }) => url.includes('/decision-review/stats'))
async function expectStatsResponse(after, status) {
  const deadline = Date.now() + 8000
  do {
    if (
      statsRequests()
        .slice(after)
        .some((request) => request.status === status)
    )
      return
    await Bun.sleep(60)
  } while (Date.now() < deadline)
  throw new Error(`Did not receive stats response HTTP ${status}`)
}
const canvas = () =>
  view.evaluate(`(() => {
    const frame = document.querySelector('.preview-window');
    const {width: visualWidth, height: visualHeight} = frame.getBoundingClientRect();
    return {
      width: frame.offsetWidth, height: frame.offsetHeight, visualWidth, visualHeight,
      sidebar: document.querySelector('.preview-sidebar').offsetWidth,
      inset: getComputedStyle(document.querySelector('.preview-plugin-page')).paddingLeft,
    };
  })()`)
async function dragResize(dx, dy) {
  const start = await view.evaluate(`(() => {
    const grip = document.querySelector('.preview-resize').getBoundingClientRect();
    return {x: grip.x + grip.width / 2, y: grip.y + grip.height / 2};
  })()`)
  const end = { x: start.x + dx, y: start.y + dy }
  await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...start })
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...end })
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...end })
}
async function enterDimension(label, value) {
  await view.evaluate(`(() => {
    const control = document.querySelector('input[aria-label="${label}"]');
    control.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(control, '${value}');
    control.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await view.press('Enter')
}
async function capture(name) {
  const metrics = await view.evaluate(
    '({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight })',
  )
  assert.equal(metrics.scrollWidth, metrics.width, `Page horizontal overflow in ${name}`)
  assert.equal(metrics.scrollHeight, metrics.height, `Page vertical overflow in ${name}`)
  const screenshot = await view.cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  })
  await Bun.write(`${evidenceDirectory}/${name}.png`, Buffer.from(screenshot.data, 'base64'))
  return { ...metrics, canvas: await canvas() }
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
  await until(`!!document.querySelector('.decision-review-panel')`)
  assert.equal(await view.evaluate('document.querySelector(".decision-review-panel h2").textContent'), '决策评审')
  const desktop = await canvas()
  assert.equal(desktop.width, 1280)
  assert.equal(desktop.height, 820)
  assert.equal(desktop.sidebar, 280)
  assert.equal(statsRequests().length, 0, 'Config slot must not mount the statistics poller')
  await capture('zh-light-desktop-config')
  await choose('缩放', '0.5')
  const half = await canvas()
  assert.equal(half.visualWidth, 640)
  assert.equal(half.sidebar, 280, 'Visual zoom must not change the logical sidebar breakpoint')
  await dragResize(-80, -30)
  assert.equal((await canvas()).width, 1120)
  assert.equal((await canvas()).height, 760)
  await dragResize(-400, -240)
  const minimum = await canvas()
  assert.equal(minimum.width, 520)
  assert.equal(minimum.height, 600)
  assert.equal(minimum.sidebar, 0)
  assert.equal(minimum.inset, '20px')
  await enterDimension('宽度', 1023)
  assert.equal((await canvas()).width, 1023)
  assert.equal((await canvas()).sidebar, 0)
  await enterDimension('宽度', 1024)
  assert.equal((await canvas()).width, 1024)
  assert.equal((await canvas()).sidebar, 280)
  await enterDimension('高度', 400)
  assert.equal((await canvas()).height, 600)
  await choose('缩放', 'fit')
  await enterDimension('宽度', 3840)
  const large = await canvas()
  assert.equal(large.width, 3840)
  assert.ok(large.visualWidth < large.width)
  await click('桌面尺寸')
  passed('Scaled pointer resize, numeric size, host breakpoints and normal-window clamps', { desktop, half, minimum })
  await click('运行冒烟测试（3 个场景）')
  await until('document.querySelectorAll("tbody tr").length===3')
  await view.scrollTo('tbody')
  passed('Chinese/light/wide Decisions and three synthetic smoke results', await capture('zh-light-wide-results'))
  await fill('Decisions 模型', 'unsaved-preview-draft')
  assert.equal(await disabled('运行冒烟测试（3 个场景）'), true)
  await choose('宿主槽位', statsSlot)
  await until(`${statsPill}?.textContent.includes('自动评审 12 次')`)
  assert.equal(await view.evaluate(`${statsPill}.hasAttribute('title')`), false)
  const dock = await view.evaluate(`(() => {
    const stats = document.querySelector('.preview-stats-dock');
    const composer = document.querySelector('.preview-composer-card');
    return {
      belowComposer: stats.getBoundingClientRect().top >= composer.getBoundingClientRect().bottom,
      pillFilter: getComputedStyle(stats.lastElementChild).filter,
      contextFilter: getComputedStyle(composer).filter,
      formHidden: document.querySelector('.decision-review-panel').getClientRects().length === 0,
    };
  })()`)
  assert.equal(dock.belowComposer, true)
  assert.equal(dock.pillFilter, 'none')
  assert.match(dock.contextFilter, /blur\(/)
  assert.equal(dock.formHidden, true)
  await capture('zh-light-desktop-dock')
  const triggerCenter = await view.evaluate(`(() => {
    const rect = ${statsPill}.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...triggerCenter })
  await Bun.sleep(450)
  assert.equal(await view.evaluate(statsExpanded), false)
  assert.equal(await view.evaluate(`!!document.querySelector('${statsCard}')`), false)
  await view.click(statsTrigger)
  await until(statsExpanded)
  assert.deepEqual(await statsDetails(), {
    title: '评审统计',
    total: '12',
    metrics: { 自动放行率: '67%', 自动放行: '8', 转人工审批: '2', 阻止: '1', 评审失败: '1' },
  })
  const light = await statsGeometry()
  await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: light.cardX, y: light.cardY })
  assert.equal(await view.evaluate(statsExpanded), true)
  await view.click(statsTrigger)
  await until(`!(${statsExpanded})`)
  await view.evaluate(`${statsPill}.focus()`)
  await view.press('Enter')
  await until(statsExpanded)
  await view.press('Escape')
  await until(`!(${statsExpanded}) && document.activeElement.matches('${statsTrigger}')`)
  await view.press('Space')
  await until(statsExpanded)
  const outside = await view.evaluate(`(() => {
    const frame = document.querySelector('.preview-window').getBoundingClientRect();
    return { x: frame.right - 35, y: frame.top + 80 };
  })()`)
  await view.click(outside.x, outside.y)
  await until(`!(${statsExpanded})`)

  await choose('主题', 'dark')
  await view.click(statsTrigger)
  await until(statsExpanded)
  const dark = await statsGeometry()
  assert.notEqual(dark.background, light.background)
  await capture('zh-dark-desktop-review-stats')
  await choose('界面语言', 'en')
  await until(`${statsPill}?.textContent === '12 reviewed · 67% auto-passed'`)
  await click('最小窗口')
  await choose('缩放', '0.5')
  await view.resize(390, 844)
  if (!(await view.evaluate(statsExpanded))) await view.click(statsTrigger)
  await until(statsExpanded)
  assert.deepEqual(await statsDetails(), {
    title: 'Review stats',
    total: '12',
    metrics: {
      'Auto-pass rate': '67%',
      'Auto-passed': '8',
      'Sent for approval': '2',
      Blocked: '1',
      'Review failures': '1',
    },
  })
  const minimumStats = await statsGeometry()
  assert.equal(minimumStats.scale, 0.5)
  await capture('en-dark-minimum-review-stats')
  await view.resize(1280, 1000)
  await click('桌面尺寸')
  await choose('缩放', 'fit')
  passed(
    'Dock opens only on press; click, Escape and outside dismiss; localized details stay within the canvas at 50%',
    { dock, light, dark, minimumStats },
  )
  await choose('宿主槽位', configSlot)
  await until(`!document.querySelector('.preview-stats-dock') && !document.querySelector('${statsCard}')`)
  const requestsAfterLeavingDock = statsRequests().length
  await choose('主题', 'dark')
  await view.resize(390, 844)
  assert.equal((await canvas()).width, 1280)
  assert.equal((await canvas()).sidebar, 280)
  await click('最小窗口')
  assert.equal((await canvas()).width, 520)
  assert.equal((await canvas()).sidebar, 0)
  assert.equal(await value('Decisions model'), 'unsaved-preview-draft')
  assert.match(await body(), /Save your changes first/)
  await view.scrollTo('.decision-review-panel')
  passed(
    'Slot/language/theme/size preserve draft; 390px browser viewport still uses logical host width',
    await capture('en-dark-narrow-dirty'),
  )
  await openThresholds()
  await view.scrollTo(await threshold('tMedPred'))
  assert.match(await body(), /Medium risk signal when classification confidence is low/)
  assert.match(await body(), /The flags show the default and last saved scores/)
  assert.match(await description('Request timeout (seconds)'), /Applies to both engines.*5 to 600 seconds/)
  const defaults = { tConf: 0.75, tHighPred: 0.85, tMedPred: 0.5, tStrongPred: 0.8, tAuth: 0.7 }
  for (const [name, score] of Object.entries(defaults)) {
    const state = await thresholdState(name)
    assert.equal(state.value, score)
    assert.equal(state.spoken, String(score))
    assert.deepEqual([state.min, state.max, state.step], [0, 1, 0.01])
    assert.deepEqual(state.flags, [`Default / Saved ${score}`])
  }
  await dragThreshold('tMedPred', 0.51)
  assert.deepEqual((await thresholdState('tMedPred')).flags, ['Default / Saved 0.5'])
  await choose('缩放', '0.5')
  await dragThreshold('tStrongPred', 0.67)
  await pressThreshold('tConf', 'Home')
  await pressThreshold('tHighPred', 'End')
  assert.equal((await thresholdState('tConf')).value, 0)
  assert.equal((await thresholdState('tHighPred')).value, 1)
  assert.deepEqual((await thresholdState('tStrongPred')).flags, ['Default / Saved 0.8'])
  await choose('缩放', 'fit')
  await click('Save')
  await until(textIncludes('Settings saved.'))
  await click('重新加载已保存配置')
  await until(
    `document.querySelector('.decision-review-panel') && [...document.querySelectorAll('input')].some(input=>input.value==='unsaved-preview-draft')`,
  )
  await openThresholds()
  assert.deepEqual((await thresholdState('tMedPred')).flags, ['Default 0.5', 'Saved 0.51'])
  assert.deepEqual((await thresholdState('tStrongPred')).flags, ['Default 0.8', 'Saved 0.67'])
  const minFlag = await thresholdGeometry('tConf', [0.75, 0])
  const maxFlag = await thresholdGeometry('tHighPred', [0.85, 1])
  const closeFlags = await thresholdGeometry('tMedPred', [0.5, 0.51])
  const sameFlag = await thresholdGeometry('tAuth', [0.7])
  const firstThreshold = await threshold('tConf')
  await view.evaluate(`(() => {
    const card = document.querySelector('${firstThreshold}');
    card.scrollIntoView({ block: 'start' });
    document.querySelector('.preview-plugin-page').scrollTop -= 36;
  })()`)
  await capture('en-dark-minimum-threshold-flags')
  passed('Five thresholds, real drag at fit and 50%, keyboard endpoints, and nonoverlapping persisted flags', {
    minFlag,
    maxFlag,
    closeFlags,
    sameFlag,
  })
  passed('Successful save and HTTP reload persist normalized values')
  await exactThreshold('tConf', '0.756')
  await click('Save')
  await until(textIncludes('Settings saved.'))
  assert.deepEqual((await thresholdState('tConf')).flags, ['Default 0.75', 'Saved 0.756'])
  await pressThreshold('tConf', 'ArrowRight')
  assert.equal((await thresholdState('tConf')).value, 0.77)
  await pressThreshold('tConf', 'ArrowLeft')
  assert.equal((await thresholdState('tConf')).value, 0.76)
  assert.deepEqual((await thresholdState('tConf')).flags, ['Default 0.75', 'Saved 0.756'])

  await fill('Request timeout (seconds)', '4.999')
  await exactThreshold('tConf', '')
  const requestsBeforeFieldError = requests.filter(({ url }) => url.endsWith('/decision-review/save')).length
  await click('Save')
  const alertNearSave = await view.evaluate(`(() => {
    const save = [...document.querySelectorAll('.decision-review-panel button')].find(node => node.textContent === 'Save');
    const notice = save.parentElement.querySelector('[role=alert]');
    const bounds = notice.getBoundingClientRect();
    const frame = document.querySelector('.preview-window').getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { text: notice.textContent, visible: bounds.top >= frame.top && bounds.bottom <= frame.bottom && notice.contains(hit) };
  })()`)
  assert.equal(alertNearSave.visible, true)
  assert.match(alertNearSave.text, /Request timeout \(seconds\), tConf/)
  assert.equal(requests.filter(({ url }) => url.endsWith('/decision-review/save')).length, requestsBeforeFieldError)
  const errorJump = '.decision-review-field-error-link'
  await capture('en-dark-visible-save-validation')
  await view.click(errorJump)
  const timeoutFocused = await view.evaluate(`(() => {
    const input = document.activeElement;
    const rect = input.getBoundingClientRect();
    return input.matches('input.decision-review-timeout[aria-invalid=true]') &&
      input.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })()`)
  assert.equal(timeoutFocused, true)
  const invalidExact = await threshold('tConf')
  assert.equal(
    await view.evaluate(
      `document.querySelector('${invalidExact} input.decision-review-threshold-value').getAttribute('aria-invalid')`,
    ),
    'true',
  )
  await choose('界面语言', 'zh')
  assert.match(await body(), /保存前请修正这些设置：请求超时（秒）, tConf/)
  await choose('界面语言', 'en')
  await fill('Request timeout (seconds)', '60')
  await exactThreshold('tConf', '0.756')
  await exactThreshold('tAuth', '0.70000123456789')
  await click('Save')
  await until(textIncludes('Settings saved.'))
  await click('重新加载已保存配置')
  await openThresholds()
  assert.equal((await thresholdState('tConf')).value, 0.756)
  assert.equal((await thresholdState('tAuth')).value, 0.70000123456789)
  assert.deepEqual((await thresholdState('tConf')).flags, ['Default 0.75', 'Saved 0.756'])
  await view.scrollTo(await threshold('tConf'))
  await capture('en-dark-exact-threshold')
  passed(
    'Exact thresholds restore off-grid values; invalid settings block requests and remain visible beside Save',
    alertNearSave,
  )
  await scene('session')
  assert.equal(await view.evaluate(`!!document.querySelector('${thresholds}')`), false)
  assert.equal(await checkedRadio('Review engine'), 'Follow session (use the session model)')
  assert.equal(await disabled('Run smoke test (3 scenarios)'), true)
  assert.doesNotMatch(await body(), /Decisions API URL/)
  assert.match(await body(), /the approval setting above still applies/)
  await choose('主题', 'light')
  passed('English/light/narrow Follow session', await capture('en-light-session'))
  await choose('界面语言', 'zh')
  await view.resize(1280, 1000)
  await click('桌面尺寸')
  await scene('load-error', false)
  await until(textIncludes('无法加载设置。'))
  await click('恢复接口')
  await until('!!document.querySelector(".decision-review-panel")')
  passed('Config HTTP 503 recovers by restoring endpoint and reloading')
  await scene('save-error')
  await fill('Decisions 模型', 'save-recovery-draft')
  await openThresholds()
  await pressThreshold('tConf', 'ArrowRight')
  await click('保存')
  await until(textIncludes('无法保存设置。'))
  assert.equal(await value('Decisions 模型'), 'save-recovery-draft')
  assert.equal((await thresholdState('tConf')).value, 0.76)
  assert.deepEqual((await thresholdState('tConf')).flags, ['默认 / 已保存 0.75'])
  await capture('zh-save-failed')
  await click('恢复接口')
  assert.equal(await value('Decisions 模型'), 'save-recovery-draft')
  await click('保存')
  await until(textIncludes('设置已保存。'))
  assert.deepEqual((await thresholdState('tConf')).flags, ['默认 0.75', '已保存 0.76'])
  passed('Save HTTP 503 preserves draft and flags; successful retry advances saved flag')
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
  // Chromium snaps outlines to display pixels. Check the CSS width at 1:1.
  await choose('缩放', '1')
  await view.scrollTo('textarea')
  await view.click('textarea')
  await view.press('Tab', { modifiers: ['Shift'] })
  assert.equal(await view.evaluate('document.activeElement.getAttribute("role")'), 'combobox')
  await view.press('Enter')
  await until('document.activeElement.getAttribute("role")==="option"')
  await view.press('Escape')
  await until(
    'document.activeElement.getAttribute("role")==="combobox" && document.activeElement.getAttribute("aria-expanded")==="false"',
  )
  await view.press('Enter')
  await until('document.activeElement.getAttribute("role")==="option"')
  await view.press('End')
  await until('document.activeElement.textContent==="拒绝"')
  await view.press('Enter')
  await until(
    'document.activeElement.getAttribute("role")==="combobox" && document.activeElement.getAttribute("aria-expanded")==="false"',
  )
  assert.equal(await selectText('评审结论'), '拒绝')
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
  await choose('缩放', 'fit')
  await capture('zh-rules-keyboard')
  await choose('界面语言', 'en')
  await choose('主题', 'dark')
  await view.resize(390, 844)
  await click('最小窗口')
  assert.equal(await value('Condition'), multiline)
  await capture('en-dark-narrow-rules')
  // Put the trigger at the bottom of a zoomed minimum canvas and verify both containment and clickability.
  await choose('缩放', '0.5')
  const verdictTrigger = await field('Verdict')
  await view.evaluate(`(() => {
    const page = document.querySelector('.preview-plugin-page');
    const trigger = document.querySelector(${JSON.stringify(verdictTrigger)});
    page.scrollTop += (trigger.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom + 6) / 0.5;
  })()`)
  await view.click(verdictTrigger)
  await until(
    '!!document.querySelector("[role=combobox][aria-expanded=true]") && !!document.querySelector("[data-side=top] [role=listbox]")',
  )
  const popup = await view.evaluate(`(() => {
    const frame = document.querySelector('.preview-window').getBoundingClientRect();
    const trigger = document.querySelector('[role=combobox][aria-expanded=true]').getBoundingClientRect();
    const list = document.querySelector('.decision-review-overlays [role=listbox]');
    const surface = list.closest('[data-slot=select-content]');
    const bounds = surface.getBoundingClientRect();
    const inFrame = bounds.left >= frame.left && bounds.right <= frame.right && bounds.top >= frame.top && bounds.bottom <= frame.bottom;
    const optionsClickable = [...list.querySelectorAll('[role=option]')].every(option => {
      const rect = option.getBoundingClientRect();
      return option.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    return { inFrame, optionsClickable, gap: trigger.top - bounds.bottom, offset: bounds.left - trigger.left, sameTheme: getComputedStyle(surface).backgroundColor === getComputedStyle(document.querySelector('textarea')).backgroundColor, scale: frame.width / 520 };
  })()`)
  assert.deepEqual(
    { inFrame: popup.inFrame, optionsClickable: popup.optionsClickable, sameTheme: popup.sameTheme },
    {
      inFrame: true,
      optionsClickable: true,
      sameTheme: true,
    },
  )
  assert.equal(popup.scale, 0.5)
  assert.ok(popup.gap >= 0 && popup.gap < 5 && Math.abs(popup.offset) < 2, JSON.stringify(popup))
  await capture('en-dark-minimum-select')
  await chooseOption('Allow only with explicit authorization')
  assert.equal(await selectText('Verdict'), 'Allow only with explicit authorization')
  await openSelect('Verdict')
  await view.press('Tab')
  await until(
    'document.activeElement.tagName==="TEXTAREA" && !document.querySelector("[role=combobox][aria-expanded=true]")',
  )
  await choose('缩放', 'fit')
  passed(
    'Dark Select flips inside a 520 × 600 canvas at 50%; items receive pointer input and Tab returns to form order',
    popup,
  )
  const longCondition = 'Long rule condition 中文 | '.repeat(17)
  await fill('Condition', longCondition)
  assert.equal(await view.evaluate('document.querySelector("textarea").getAttribute("aria-invalid")'), 'true')
  await capture('en-dark-narrow-long-rule')
  await choose('界面语言', 'zh')
  assert.equal(await value('匹配条件'), longCondition)
  assert.match(await body(), /每条匹配条件最多 400 个字符/)
  assert.equal(
    await view.evaluate('document.querySelector(".decision-review-rule-remove").getAttribute("aria-label")'),
    '移除规则 1',
  )
  await view.scrollTo('textarea')
  passed(
    'Chinese rule copy and accessible names switch without editing the long draft',
    await capture('zh-dark-narrow-long-rule'),
  )
  await choose('界面语言', 'en')
  await fill('Condition', multiline)
  await choose('界面语言', 'zh')
  await choose('主题', 'light')
  await view.resize(1280, 1000)
  await click('桌面尺寸')
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
  await view.scrollTo('.decision-review-rule-remove')
  await view.click('.decision-review-rule-remove')
  assert.equal(await view.evaluate('document.activeElement === document.querySelector("textarea")'), true)
  await view.scrollTo('.decision-review-rule-remove')
  await view.click('.decision-review-rule-remove')
  assert.equal(
    await view.evaluate('document.activeElement === document.querySelector(".decision-review-rules-add")'),
    true,
  )
  passed('Keyboard select, focus ring, linked errors, add/remove focus and bilingual narrow rules', {
    semantics,
    invalid,
  })
  await scene('decisions')
  await click('最小窗口')
  await choose('缩放', '1')
  const engineGroup = await radioGroup('评审引擎')
  const engineOptions = await view.evaluate(`(() => {
    const group = document.querySelector('${engineGroup}');
    const options = [...group.querySelectorAll('[role=radio]')];
    return { required: group.getAttribute('aria-required'), count: options.length,
      tabStops: options.filter(option => option.tabIndex === 0).length,
      description: document.getElementById(group.getAttribute('aria-describedby'))?.textContent,
      fits: options.every(option => option.scrollWidth <= option.clientWidth && option.offsetWidth <= group.clientWidth) };
  })()`)
  assert.equal(engineOptions.required, 'true')
  assert.equal(engineOptions.count, 2)
  assert.equal(engineOptions.tabStops, 1)
  assert.ok(engineOptions.description && engineOptions.fits)
  assert.equal(await checkedRadio('评审引擎'), 'Decisions（独立 API）')
  await view.scrollTo(`${engineGroup} [aria-checked=true]`)
  await view.click(`${engineGroup} [aria-checked=true]`)
  await view.press('ArrowRight')
  await until(
    'document.activeElement.getAttribute("role")==="radio" && document.activeElement.textContent==="跟随会话（使用会话模型）"',
  )
  assert.equal(await checkedRadio('评审引擎'), '跟随会话（使用会话模型）')
  assert.equal(await view.evaluate('!!document.querySelector("input[type=password]")'), false)
  await view.press('Tab')
  await until(
    'document.activeElement.getAttribute("role")==="radio" && document.activeElement.textContent==="会话允许时转人工审批"',
  )
  await view.press('ArrowDown')
  const deny = '直接拒绝，并将原因返回给会话模型'
  await until(`document.activeElement.textContent===${JSON.stringify(deny)}`)
  assert.equal(await checkedRadio('评审拒绝调用时'), deny)
  await view.press('Space')
  assert.equal(await checkedRadio('评审拒绝调用时'), deny)
  await view.press('Tab')
  const timeoutField = await field('请求超时（秒）')
  assert.equal(await view.evaluate(`document.activeElement.matches('${timeoutField}')`), true)
  assert.equal(await value('请求超时（秒）'), '60')
  await fill('请求超时（秒）', '5.0001')
  const invalidSaveCount = requests.filter(({ url }) => url.endsWith('/decision-review/save')).length
  await click('保存')
  await until(textIncludes('请输入 5 到 600 秒之间的超时时间'))
  assert.match(await description('请求超时（秒）'), /请输入 5 到 600 秒/)
  assert.equal(requests.filter(({ url }) => url.endsWith('/decision-review/save')).length, invalidSaveCount)
  await choose('界面语言', 'en')
  assert.match(await description('Request timeout (seconds)'), /Enter a timeout from 5 to 600 seconds/)
  assert.equal(await value('Request timeout (seconds)'), '5.0001')
  await fill('Request timeout (seconds)', '5.001')
  await click('Save')
  await until(textIncludes('Settings saved.'))
  await click('重新加载已保存配置')
  await until('!!document.querySelector(".decision-review-panel [role=radiogroup]")')
  assert.equal(
    await checkedRadio('When the reviewer denies a call'),
    'Deny the call and send the reason to the session model',
  )
  assert.equal(await value('Request timeout (seconds)'), '5.001')
  const englishEngine = await radioGroup('Review engine')
  await view.scrollTo(`${englishEngine} [role=radio]:first-child`)
  await view.click(`${englishEngine} [role=radio]:first-child`)
  assert.equal(await checkedRadio('Review engine'), 'Decisions (separate API)')
  assert.equal(await view.evaluate('!!document.querySelector("input[type=password]")'), true)
  await choose('界面语言', 'zh')
  await choose('缩放', 'fit')
  await click('桌面尺寸')
  passed(
    'Two required radio groups accept arrows and one Tab stop; timeout rejects extra precision and persists 5.001 s',
    engineOptions,
  )

  await scene('decisions')
  const danger = '.decision-review-panel button[data-variant=destructive]'
  const dangerColors = async () =>
    view.evaluate(`(() => {
      const button = document.querySelector('${danger}');
      const style = getComputedStyle(button);
      const probe = document.createElement('span');
      probe.style.color = 'var(--decision-review-error)';
      button.parentElement.append(probe);
      const dangerColor = getComputedStyle(probe).color;
      probe.remove();
      return { color: style.color, background: style.backgroundColor, dangerColor };
    })()`)
  await view.scrollTo(await field('请求超时（秒）'))
  const lightDanger = await dangerColors()
  assert.equal(lightDanger.color, lightDanger.dangerColor)
  await view.evaluate(`(() => {
    const heading = document.querySelector('.decision-review-field-title');
    heading.scrollIntoView({ block: 'start' });
  })()`)
  await capture('zh-light-config-binary-seconds-danger')
  await choose('主题', 'dark')
  const darkDanger = await dangerColors()
  assert.equal(darkDanger.color, darkDanger.dangerColor)
  assert.notEqual(darkDanger.color, lightDanger.color)
  await capture('zh-dark-config-binary-seconds-danger')
  const removalSaveCount = requests.filter(({ url }) => url.endsWith('/decision-review/save')).length
  await click('移除已保存的密钥')
  await until(textIncludes('保存时将移除已保存的密钥'))
  assert.equal(await view.evaluate('document.querySelector("input[type=password]").disabled'), true)
  assert.equal(await view.evaluate(`!!document.querySelector('${danger}')`), false)
  assert.equal(requests.filter(({ url }) => url.endsWith('/decision-review/save')).length, removalSaveCount)
  await click('保留已保存的密钥')
  assert.equal(await view.evaluate('document.querySelector("input[type=password]").disabled'), false)
  assert.equal(await view.evaluate(`!!document.querySelector('${danger}')`), true)
  assert.equal(requests.filter(({ url }) => url.endsWith('/decision-review/save')).length, removalSaveCount)
  await choose('主题', 'light')
  passed('Saved key removal uses the theme danger color and remains cancellable before Save', {
    lightDanger,
    darkDanger,
  })
  await scene('invalid')
  assert.equal(await checkedRadio('评审引擎'), '跟随会话（使用会话模型）')
  assert.equal(await value('Decisions API 地址'), '')
  assert.equal(await value('Decisions 模型'), '')
  assert.match(await body(), /已保存的设置无效/)
  const storedAlert = '.decision-review-panel > :nth-child(1 of [role="alert"])'
  const storedDetails = '.decision-review-panel [role="alert"] summary'
  await view.scrollTo(storedDetails)
  await view.click(storedDetails)
  const alertText = (selector) => view.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText`)
  const storedText = await alertText(storedAlert)
  assert.match(storedText, /Decisions API 地址必须是/)
  assert.match(storedText, /请输入 Decisions 模型名称/)
  const saveAlert = '.decision-review-panel > :nth-child(2 of [role="alert"])'
  await click('保存')
  await until(textIncludes('无法保存设置。'))
  assert.match(await alertText(saveAlert), /Decisions API 地址必须是/)
  await view.scrollTo(saveAlert)
  await capture('zh-invalid-settings')
  const savesBeforeLanguageSwitch = requests.filter(({ url }) => url.endsWith('/decision-review/save')).length
  await choose('界面语言', 'en')
  await until(textIncludes('Could not save settings.'))
  assert.match(await alertText(saveAlert), /The Decisions API URL must be an absolute HTTP or HTTPS URL/)
  assert.match(await alertText(storedAlert), /The Decisions API URL must be an absolute HTTP or HTTPS URL/)
  assert.equal(requests.filter(({ url }) => url.endsWith('/decision-review/save')).length, savesBeforeLanguageSwitch)
  await capture('en-invalid-settings')
  passed('Stored and submitted settings issues switch language without resubmitting')
  await choose('界面语言', 'zh')
  await fill('Decisions API 地址', 'https://fixed.example.invalid/decisions')
  await fill('Decisions 模型', 'repaired-synthetic-reviewer')
  await click('保存')
  await until(textIncludes('设置已保存。'))
  assert.doesNotMatch(await body(), /已保存的设置无效/)
  assert.equal(await checkedRadio('评审引擎'), '跟随会话（使用会话模型）')
  passed('Invalid stored route/model require real validation and repair while keeping session engine')
  await scene('slow', false)
  await until(textIncludes('正在加载设置…'))
  await scene('session')
  await Bun.sleep(2100)
  assert.equal(await checkedRadio('评审引擎'), '跟随会话（使用会话模型）')
  passed('Switch during delayed load cancels old scene without stale form')
  await scene('slow')
  await fill('Decisions 模型', 'submitted-before-edit')
  await click('添加规则')
  await fill('匹配条件', multiline)
  await openThresholds()
  await pressThreshold('tConf', 'ArrowRight')
  const previousSave = requests.findLast(({ url }) => url.endsWith('/decision-review/save'))
  await click('保存')
  await until(textIncludes('正在保存…'))
  const pendingSave = requests.findLast(({ url }) => url.endsWith('/decision-review/save'))
  assert.ok(pendingSave && pendingSave !== previousSave, 'Expected a new save request before editing')
  assert.equal(await disabled('运行冒烟测试（3 个场景）'), true)
  await fill('Decisions 模型', 'edited-during-save')
  await fill('匹配条件', multiline + 'New edit after submission')
  await pressThreshold('tConf', 'ArrowRight')
  assert.equal((await thresholdState('tConf')).value, 0.77)
  assert.deepEqual((await thresholdState('tConf')).flags, ['默认 / 已保存 0.75'])
  const savingAfterEdits = await view.evaluate(
    `[...document.querySelectorAll('button')].some(button=>button.textContent==='正在保存…' && button.disabled)`,
  )
  const responsePendingAfterEdits = pendingSave.status === undefined
  assert.equal(savingAfterEdits, true, 'Model, rule and threshold edits must finish while the form is still saving')
  assert.equal(responsePendingAfterEdits, true, 'Model, rule and threshold edits must finish before the save response')
  await capture('zh-saving')
  await until(`![...document.querySelectorAll('button')].some(button=>button.textContent==='正在保存…')`)
  assert.equal(await value('Decisions 模型'), 'edited-during-save')
  assert.equal((await thresholdState('tConf')).value, 0.77)
  assert.deepEqual((await thresholdState('tConf')).flags, ['默认 0.75', '已保存 0.76'])
  assert.match(await body(), /请先保存修改/)
  assert.equal(await value('匹配条件'), multiline + 'New edit after submission')
  await click('重新加载已保存配置')
  await until(
    `document.querySelector('.decision-review-panel') && [...document.querySelectorAll('input')].some(input=>input.value==='submitted-before-edit')`,
  )
  assert.equal(await value('匹配条件'), multiline)
  await openThresholds()
  assert.equal((await thresholdState('tConf')).value, 0.76)
  assert.deepEqual((await thresholdState('tConf')).flags, ['默认 0.75', '已保存 0.76'])
  await view.scrollTo(await threshold('tMedPred'))
  await capture('zh-desktop-threshold-flags')
  passed('Saving state preserves newer model, rule and threshold drafts while flags track the saved response', {
    savingAfterEdits,
    responsePendingAfterEdits,
    responseStatus: pendingSave.status,
  })
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
  assert.equal(statsRequests().length, requestsAfterLeavingDock, 'Leaving the dock must stop stats polling')
  await choose('宿主槽位', statsSlot)
  const requestsBeforeError = statsRequests().length
  await scene('stats-error', false)
  await expectStatsResponse(requestsBeforeError, 503)
  assert.equal(await view.evaluate(`!!${statsPill}`), false)
  await click('恢复接口')
  await until(`${statsPill}?.textContent.includes('自动评审 12 次')`, 6500)
  const requestsBeforeEmpty = statsRequests().length
  await scene('stats-empty', false)
  await expectStatsResponse(requestsBeforeEmpty, 200)
  await until(`!${statsPill}`)
  assert.doesNotMatch(await body(), /自动评审 12 次/)
  passed('Stats failure recovers on polling; zero-review fixture hides pill')
  if (checkHmr) {
    await choose('宿主槽位', configSlot)
    await scene('decisions')
    await fill('Decisions 模型', 'hot-refresh-unsaved')
    const before = await view.evaluate('({timeOrigin:performance.timeOrigin})')
    const panelPath = 'src/client/panel.tsx'
    const cssPath = 'src/client/styles.css'
    const controlCssPath = 'src/client/ui/control-styles.css'
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
      {
        path: controlCssPath,
        transform: (source) => source + '\n.decision-review-panel { --decision-review-hmr-probe: refreshed; }\n',
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
      await apply(controlCssPath)
      await until(
        `document.querySelector('.decision-review-panel') && getComputedStyle(document.querySelector('.decision-review-panel')).getPropertyValue('--decision-review-hmr-probe').trim()==='refreshed'`,
      )
      assert.equal(await value('Decisions 模型'), 'hot-refresh-unsaved')
      assert.equal(await view.evaluate('performance.timeOrigin'), before.timeOrigin)
      assert.equal(navigations, beforeNavigations)
      await capture('shared-tsx-css-hmr')
      passed('Actual shared TSX, CSS and generated Tailwind HMR retain draft and do not navigate', {
        beforeNavigations,
        tsxNavigations,
        cssNavigations: navigations,
        timeOrigin: before.timeOrigin,
      })
      await restore([panelPath, cssPath, controlCssPath])
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
  // Bun inlines the synthetic plugin artwork in the preview stylesheet.
  assert.ok(requests.every(({ url }) => new URL(url).origin === origin || url.startsWith('data:image/svg+xml;')))
  passed('All network requests remain localhost; no uncaught runtime exceptions')
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
