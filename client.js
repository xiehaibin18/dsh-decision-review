/**
 * Client half of the decision-review bundle. The row configuration page
 * uses the bundle's authenticated, same-origin routes. The stored API key
 * is write-only: the host never sends it back.
 */
window.__ModuleLoader__.load({
  id: '@local/decision-review',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'decision-review';

    // The host loads this file as a classic script. Package metadata in
    // locale/*.json is a separate surface from the runtime dictionaries.
    const MESSAGES = {
      en: {
        'panel.title': 'Authorization review',
        'panel.desc': 'Review tool calls with the independent OpenAI Decisions API or with the model used by the current session.',
        'panel.loading': 'Loading settings…',
        'engine.label': 'Review engine',
        'engine.decisions': 'Decisions (independent reviewer)',
        'engine.session': 'Follow session (session model)',
        'engine.repair': 'Fix the saved Decisions API URL or model below to resume review. You can keep Follow session selected.',
        'endpoint.label': 'Decisions API URL',
        'apikey.label': 'API key',
        'apikey.hint': 'The key is stored in plaintext in the profile directory.',
        'apikey.saved': 'A key is saved. Leave this blank to keep it or enter a new one to replace it.',
        'apikey.placeholder': '•••••••• (saved)',
        'apikey.clear': 'Remove saved key',
        'apikey.clear.pending': 'The saved key will be removed when you save.',
        'apikey.clear.undo': 'Keep saved key',
        'model.label': 'Decisions model',
        'timeout.label': 'Request timeout (ms)',
        'timeout.hint': 'Enter an integer from 5,000 to 600,000. Applies to both engines.',
        'denialroute.label': 'When the reviewer denies a call',
        'denialroute.ask': 'Ask for approval in sessions that permit it',
        'denialroute.final': 'Deny the call and return the reason to the model',
        'thresholds.title': 'Decisions thresholds (advanced)',
        'thresholds.tConf': 'tConf — Minimum classification confidence',
        'thresholds.tHighPred': 'tHighPred — Data exfiltration threshold for high-risk classification',
        'thresholds.tMedPred': 'tMedPred — Weak signal threshold for medium risk',
        'thresholds.tStrongPred': 'tStrongPred — Strong signal threshold for medium risk',
        'thresholds.tAuth': 'tAuth — Authorization threshold for allowing medium risk',
        'save': 'Save',
        'saving': 'Saving…',
        'saved': 'Settings saved.',
        'save.invalid': 'Fix the highlighted rules before saving.',
        'load.error': 'Could not load settings.',
        'save.error': 'Could not save settings.',
        'error.http': 'HTTP status: {status}',
        'error.details': 'Technical details',
        'runtime.status': 'Runtime: {state}',
        'runtime.accepting': 'accepting reviews',
        'runtime.paused': 'review paused',
        'runtime.closed': 'closing',
        'runtime.pending': 'waiting for status',
        'runtime.active': '{state} · Active reviews: {count}',
        'problems.title': 'Stored settings are invalid',
        'problems.desc': 'Calls that need review are being denied. Check the settings below and save to resume review.',
        'rules.title': 'Custom rules',
        'rules.hint': 'Describe the action and the circumstances the reviewer should match.',
        'rules.engine.decisions': 'Decisions applies the selected verdict when the reviewer confidently matches a rule, within the engine’s risk limits. A matched “Deny” rule always stops the call, even when reviewer denials normally ask for approval.',
        'rules.engine.session': 'These rules guide the session reviewer. “Deny” tells the model to refuse the call; any refusal still follows your setting for reviewer denials.',
        'rules.summary': 'Rules: {count}/{maxCount} · Condition characters: {total}/{maxTotal}',
        'rules.empty.title': 'No custom rules yet',
        'rules.empty.desc': 'The engine uses its built-in policy. Add a rule to tailor how it handles a specific action.',
        'rules.add': 'Add rule',
        'rules.remove': 'Remove',
        'rules.remove.named': 'Remove rule {n}',
        'rules.item': 'Rule {n}',
        'rules.verdict.label': 'Verdict',
        'rules.verdict.allow': 'Allow',
        'rules.verdict.allow_if_requested': 'Allow if explicitly requested',
        'rules.verdict.ask': 'Ask for approval',
        'rules.verdict.deny': 'Deny',
        'rules.condition.label': 'Condition',
        'rules.condition.placeholder': 'Example: Deploy code or configuration to production.',
        'rules.condition.length': '{count}/{max} characters',
        'rules.error.verdict': 'Choose a verdict.',
        'rules.error.required': 'Enter a condition.',
        'rules.error.long': 'Use at most {max} characters for this condition.',
        'rules.error.count': 'Keep at most {max} rules.',
        'rules.error.total': 'Use at most {max} characters across all conditions.',
        'test.title': 'Smoke test',
        'test.run': 'Run smoke test (3 scenarios)',
        'test.running': 'Testing…',
        'test.sessions': 'The smoke test is available for the Decisions engine.',
        'test.unsaved': 'Save your changes first. The smoke test uses the saved settings.',
        'test.error': 'Could not run the smoke test.',
        'test.scenario': 'Scenario',
        'test.ms': 'Time (ms)',
        'test.verdict': 'Verdict',
        'test.basis': 'Reason',
        'test.scenario.allow': 'Run project tests',
        'test.scenario.exfil': 'Send credentials to an external URL',
        'test.scenario.install': 'Install a plugin',
        'test.scenario.unknown': 'Unknown scenario',
        'test.verdict.allow': 'Allowed',
        'test.verdict.deny': 'Denied',
        'test.verdict.error': 'Error',
        'test.risk.low': 'Low risk',
        'test.risk.medium': 'Medium risk',
        'test.risk.high': 'High risk',
        'test.risk.unknown': 'Unknown risk',
        'test.basis.allow': 'The reviewer approved this call.',
        'test.basis.deny': 'The reviewer denied this call.',
        'test.basis.rule_allow': 'A matching custom rule allows this call: {condition}',
        'test.basis.error': 'The reviewer could not complete this scenario.',
        'pill.label': '{n} reviewed · {p}% auto-passed',
        'pill.title': 'Auto review this session: {n} calls · {auto} auto-passed · {asked} asked · {denied} denied',
      },
      zh: {
        'panel.title': '授权评审',
        'panel.desc': '使用独立的 OpenAI Decisions API 或当前会话的模型评审工具调用。',
        'panel.loading': '正在加载设置…',
        'engine.label': '评审引擎',
        'engine.decisions': 'Decisions（独立评审）',
        'engine.session': '跟随会话（使用会话模型）',
        'engine.repair': '请在下方修正已保存的 Decisions API 地址或模型，以恢复评审。评审引擎可保持为「跟随会话」。',
        'endpoint.label': 'Decisions API 地址',
        'apikey.label': 'API 密钥',
        'apikey.hint': '密钥以明文保存在配置目录中。',
        'apikey.saved': '已保存密钥。留空可保留现有密钥，也可以输入新密钥替换。',
        'apikey.placeholder': '••••••••（已保存）',
        'apikey.clear': '移除已保存的密钥',
        'apikey.clear.pending': '保存时将移除已保存的密钥。',
        'apikey.clear.undo': '保留已保存的密钥',
        'model.label': 'Decisions 模型',
        'timeout.label': '请求超时（毫秒）',
        'timeout.hint': '输入 5,000 到 600,000 之间的整数。对两种引擎都生效。',
        'denialroute.label': '评审拒绝调用时',
        'denialroute.ask': '在允许审批的会话中请求审批',
        'denialroute.final': '直接拒绝，并将原因返回给模型',
        'thresholds.title': 'Decisions 阈值（高级）',
        'thresholds.tConf': 'tConf — 分类置信度下限',
        'thresholds.tHighPred': 'tHighPred — 数据外传高风险判定阈值',
        'thresholds.tMedPred': 'tMedPred — 中风险弱信号阈值',
        'thresholds.tStrongPred': 'tStrongPred — 中风险强信号阈值',
        'thresholds.tAuth': 'tAuth — 中风险放行的授权阈值',
        'save': '保存',
        'saving': '正在保存…',
        'saved': '设置已保存。',
        'save.invalid': '请修正有提示的规则后再保存。',
        'load.error': '无法加载设置。',
        'save.error': '无法保存设置。',
        'error.http': 'HTTP 状态码：{status}',
        'error.details': '技术详情',
        'runtime.status': '运行状态：{state}',
        'runtime.accepting': '正在受理评审',
        'runtime.paused': '评审已暂停',
        'runtime.closed': '正在关闭',
        'runtime.pending': '正在获取状态',
        'runtime.active': '{state} · 进行中的评审：{count}',
        'problems.title': '已保存的设置无效',
        'problems.desc': '所有需要评审的调用都会被拒绝。请检查下方设置并保存，以恢复评审。',
        'rules.title': '自定义规则',
        'rules.hint': '描述要匹配的操作及其适用情形。',
        'rules.engine.decisions': '评审模型有把握地匹配到规则后，Decisions 会在引擎的风险限制内执行所选结论。命中「拒绝」规则时会直接阻止调用，即使一般的评审拒绝会转人工审批。',
        'rules.engine.session': '规则用于指导会话评审模型。「拒绝」会要求模型拒绝调用；模型给出的拒绝仍按上方的评审拒绝设置处理。',
        'rules.summary': '规则：{count}/{maxCount} 条 · 条件总长：{total}/{maxTotal} 个字符',
        'rules.empty.title': '还没有自定义规则',
        'rules.empty.desc': '评审引擎目前使用内置策略。添加规则，可指定某类操作的处理方式。',
        'rules.add': '添加规则',
        'rules.remove': '移除',
        'rules.remove.named': '移除规则 {n}',
        'rules.item': '规则 {n}',
        'rules.verdict.label': '评审结论',
        'rules.verdict.allow': '放行',
        'rules.verdict.allow_if_requested': '明确要求时放行',
        'rules.verdict.ask': '请求审批',
        'rules.verdict.deny': '拒绝',
        'rules.condition.label': '匹配条件',
        'rules.condition.placeholder': '例如：向生产环境部署代码或配置。',
        'rules.condition.length': '{count}/{max} 个字符',
        'rules.error.verdict': '请选择评审结论。',
        'rules.error.required': '请输入匹配条件。',
        'rules.error.long': '每条匹配条件最多 {max} 个字符。',
        'rules.error.count': '最多保留 {max} 条规则。',
        'rules.error.total': '所有匹配条件合计最多 {max} 个字符。',
        'test.title': '冒烟测试',
        'test.run': '运行冒烟测试（3 个场景）',
        'test.running': '正在测试…',
        'test.sessions': '只有 Decisions 引擎支持冒烟测试。',
        'test.unsaved': '请先保存修改。冒烟测试使用已保存的设置。',
        'test.error': '无法运行冒烟测试。',
        'test.scenario': '场景',
        'test.ms': '耗时（毫秒）',
        'test.verdict': '结论',
        'test.basis': '原因',
        'test.scenario.allow': '运行项目测试',
        'test.scenario.exfil': '向外部地址发送凭据',
        'test.scenario.install': '安装插件',
        'test.scenario.unknown': '未知场景',
        'test.verdict.allow': '放行',
        'test.verdict.deny': '拒绝',
        'test.verdict.error': '出错',
        'test.risk.low': '低风险',
        'test.risk.medium': '中风险',
        'test.risk.high': '高风险',
        'test.risk.unknown': '未知风险',
        'test.basis.allow': '评审通过了这次调用。',
        'test.basis.deny': '评审拒绝了这次调用。',
        'test.basis.rule_allow': '命中的自定义规则允许这次调用：{condition}',
        'test.basis.error': '评审未能完成此场景。',
        'pill.label': '自动评审 {n} 次 · 自动放行率 {p}%',
        'pill.title': '本次会话自动评审 {n} 次：自动放行 {auto} · 请求审批 {asked} · 拒绝 {denied}',
      },
    };

    const API_BASE = '/api/decision-review';
    const RULE_VERDICTS = ['allow', 'allow_if_requested', 'ask', 'deny'];
    // Same caps as the host enforces when it saves.
    const RULE_MAX_COUNT = 20;
    const RULE_MAX_CONDITION = 400;
    const RULE_MAX_TOTAL = 2000;
    const THRESHOLDS = ['tConf', 'tHighPred', 'tMedPred', 'tStrongPred', 'tAuth'];

    const BORDER = 'var(--dsw-alias-border-l4, #8885)';
    const MUTED = 'var(--dsw-alias-label-secondary, GrayText)';
    const DANGER = 'var(--dsw-alias-state-error-primary, #d13d37)';
    const RADIUS = 'var(--dsw-radius-md, 8px)';
    const INPUT = {
      display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px 10px',
      border: '1px solid ' + BORDER, borderRadius: RADIUS, font: 'inherit',
      background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit',
    };
    const BUTTON = {
      padding: '6px 12px', borderRadius: RADIUS, border: '1px solid ' + BORDER,
      background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit', font: 'inherit', cursor: 'pointer',
    };
    const PRIMARY_BUTTON = {
      ...BUTTON, background: 'var(--dsw-alias-state-business-primary, #365cda)',
      color: 'var(--dsw-alias-label-primary-foreground, #fff)', borderColor: 'transparent', fontWeight: 600,
    };
    const ROW = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 };
    const STACK = { display: 'grid', gap: 12, minWidth: 0 };
    const HEADING = { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4 };
    const NOTE = { margin: 0, fontSize: 12, color: MUTED, overflowWrap: 'anywhere' };
    const ERROR_NOTE = { ...NOTE, color: DANGER };
    const CARD = { display: 'grid', gap: 10, minWidth: 0, padding: 12, border: '1px solid ' + BORDER, borderRadius: RADIUS };
    const ACTION_BAR = { ...ROW, borderTop: '1px solid ' + BORDER, paddingTop: 14 };

    function Field({ label, children, hint }) {
      return h('div', { style: { minWidth: 0 } },
        h('label', { style: { display: 'grid', gap: 4 } }, h('span', null, label), children),
        hint ? h('div', { style: { ...NOTE, marginTop: 4 } }, hint) : null);
    }

    function buttonStyle(disabled, style = BUTTON) {
      return disabled ? { ...style, opacity: 0.55, cursor: 'default' } : style;
    }

    function TechnicalDetails({ t, detail }) {
      if (!detail) return null;
      return h('details', { style: { ...NOTE, marginTop: 4 } },
        h('summary', { style: { cursor: 'pointer' } }, t('error.details')),
        h('div', { style: { whiteSpace: 'pre-wrap' } }, detail));
    }

    /** A body makes an authenticated, same-origin call a JSON POST. */
    async function callApi(path, body) {
      const res = await fetch(API_BASE + path, body === undefined ? undefined : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload = null;
      try { payload = await res.json(); } catch (_) { /* non-JSON body */ }
      if (payload?.error) throw new Error(payload.error);
      if (!res.ok) throw Object.assign(new Error(), { status: res.status });
      return payload;
    }

    function reportError(key, error) {
      return error?.status
        ? { key, status: error.status }
        : { key, detail: error instanceof Error ? error.message : String(error) };
    }

    function RequestError({ t, error }) {
      return h('div', { role: 'alert', style: ERROR_NOTE },
        t(error.key),
        h(TechnicalDetails, { t, detail: error.status ? t('error.http', { status: error.status }) : error.detail }));
    }

    function ruleData(rules) {
      return rules.map(({ condition, verdict }) => ({ condition, verdict }));
    }

    function draftRules(rules, nextId, previous = []) {
      return (rules ?? []).map(({ condition, verdict }, i) => ({
        id: previous[i]?.id ?? nextId.current++, condition, verdict,
      }));
    }

    function formSnapshot(fields, rules, apiKeyInput, clearKey) {
      return JSON.stringify([fields, ruleData(rules), apiKeyInput, clearKey]);
    }

    function savedForm(fields, rules) {
      return {
        snapshot: formSnapshot(fields, rules, '', false),
        // The host exposes an invalid stored endpoint or model as an empty field.
        needsDecisionsRepair: fields.endpoint === '' || fields.model === '',
      };
    }

    function conditionProblem(condition) {
      if (condition.length > RULE_MAX_CONDITION) return 'rules.error.long';
      if (condition.trim() === '') return 'rules.error.required';
      return null;
    }

    function validateRules(rules) {
      const total = rules.reduce((sum, rule) => sum + rule.condition.length, 0);
      const countInvalid = rules.length > RULE_MAX_COUNT;
      const totalInvalid = total > RULE_MAX_TOTAL;
      const valid = !countInvalid && !totalInvalid && rules.every(({ verdict, condition }) =>
        RULE_VERDICTS.includes(verdict) && conditionProblem(condition) === null);
      return { total, countInvalid, totalInvalid, valid };
    }

    function RuleEditor({ t, rule, index, onChange, onRemove, showMissing, autoFocus, baseId }) {
      const n = index + 1;
      const headingId = baseId + '-heading';
      const lengthId = baseId + '-length';
      const conditionErrorId = baseId + '-condition-error';
      const verdictErrorId = baseId + '-verdict-error';
      const problem = conditionProblem(rule.condition);
      const conditionError = problem !== 'rules.error.required' || showMissing ? problem : null;
      const verdictInvalid = !RULE_VERDICTS.includes(rule.verdict);

      return h('section', { 'aria-labelledby': headingId, style: CARD },
        h('div', { style: { ...ROW, justifyContent: 'space-between' } },
          h('h3', { id: headingId, style: { ...HEADING, fontSize: 13 } }, t('rules.item', { n })),
          h('button', {
            type: 'button', onClick: onRemove, 'aria-label': t('rules.remove.named', { n }),
            style: { ...BUTTON, padding: '4px 9px', background: 'transparent' },
          }, t('rules.remove'))),
        h(Field, { label: t('rules.verdict.label') },
          h('select', {
            value: verdictInvalid ? '' : rule.verdict,
            onChange: (event) => onChange({ verdict: event.target.value }),
            'aria-invalid': verdictInvalid || undefined,
            'aria-describedby': verdictInvalid ? verdictErrorId : undefined,
            style: INPUT,
          },
            verdictInvalid ? h('option', { value: '', disabled: true }, t('rules.error.verdict')) : null,
            RULE_VERDICTS.map((verdict) => h('option', { value: verdict, key: verdict }, t('rules.verdict.' + verdict))))),
        verdictInvalid ? h('div', { id: verdictErrorId, style: ERROR_NOTE }, t('rules.error.verdict')) : null,
        h(Field, { label: t('rules.condition.label') },
          h('textarea', {
            value: rule.condition,
            onChange: (event) => onChange({ condition: event.target.value }),
            placeholder: t('rules.condition.placeholder'),
            rows: 3,
            autoFocus,
            'aria-required': true,
            'aria-invalid': conditionError ? true : undefined,
            'aria-describedby': lengthId + (conditionError ? ' ' + conditionErrorId : ''),
            style: { ...INPUT, resize: 'vertical', borderColor: conditionError ? DANGER : BORDER },
          })),
        h('div', { style: { ...ROW, justifyContent: 'space-between', alignItems: 'baseline', marginTop: -4 } },
          conditionError ? h('span', { id: conditionErrorId, style: ERROR_NOTE },
            t(conditionError, { max: RULE_MAX_CONDITION })) : null,
          h('span', { id: lengthId, style: { ...(problem === 'rules.error.long' ? ERROR_NOTE : NOTE), marginInlineStart: 'auto' } },
            t('rules.condition.length', { count: rule.condition.length, max: RULE_MAX_CONDITION }))));
    }

    function RulesEditor({ t, engine, rules, validation, onAdd, onChange, onRemove, showMissing, lastAddedId }) {
      const sectionId = React.useId();
      const atCountLimit = rules.length >= RULE_MAX_COUNT;
      const { total, countInvalid, totalInvalid } = validation;
      const add = h('button', { type: 'button', disabled: atCountLimit, style: buttonStyle(atCountLimit), onClick: onAdd },
        h('span', { 'aria-hidden': true }, '+ '), t('rules.add'));

      return h('section', { 'aria-labelledby': sectionId, style: { ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 } },
        h('div', { style: { display: 'grid', gap: 5 } },
          h('h2', { id: sectionId, style: HEADING }, t('rules.title')),
          h('p', { style: NOTE }, t('rules.hint')),
          h('p', { style: NOTE }, t('rules.engine.' + engine))),
        h('p', { style: countInvalid || totalInvalid ? ERROR_NOTE : NOTE },
          t('rules.summary', { count: rules.length, maxCount: RULE_MAX_COUNT, total, maxTotal: RULE_MAX_TOTAL })),
        countInvalid ? h('div', { style: ERROR_NOTE }, t('rules.error.count', { max: RULE_MAX_COUNT })) : null,
        totalInvalid ? h('div', { style: ERROR_NOTE }, t('rules.error.total', { max: RULE_MAX_TOTAL })) : null,
        rules.length === 0
          ? h('div', { style: { ...CARD, borderStyle: 'dashed', padding: 16 } },
            h('div', { style: { fontWeight: 600 } }, t('rules.empty.title')),
            h('p', { style: NOTE }, t('rules.empty.desc')),
            h('div', { style: ROW }, add))
          : h(React.Fragment, null,
            rules.map((rule, index) => h(RuleEditor, {
              key: rule.id, baseId: sectionId + '-rule-' + rule.id, t, rule, index, showMissing,
              autoFocus: rule.id === lastAddedId,
              onChange: (changes) => onChange(rule.id, changes),
              onRemove: () => onRemove(rule.id),
            })),
            h('div', { style: ROW }, add)));
    }

    function SmokeResults({ t, resolveText, results }) {
      const cell = { padding: '8px 6px', textAlign: 'start', verticalAlign: 'top', overflowWrap: 'anywhere' };
      return h('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } },
        h('thead', null, h('tr', null,
          ['test.scenario', 'test.ms', 'test.verdict', 'test.basis'].map((key) =>
            h('th', { key, scope: 'col', style: cell }, t(key))))),
        h('tbody', null, results.map((result) => {
          const { scenario, composed } = result;
          const scenarioKey = ['allow', 'exfil', 'install'].includes(scenario) ? scenario : 'unknown';
          const verdict = result.ok ? (composed.decision === 'allow' ? 'allow' : 'deny') : 'error';
          const risk = result.ok && ['low', 'medium', 'high'].includes(composed.risk) ? composed.risk : 'unknown';
          const rule = composed?.why?.code === 'rule_allow' ? composed.why : null;
          const display = composed?.display ? resolveText(composed.display) : null;
          const reason = display || (rule ? t('test.basis.rule_allow', { condition: rule.condition }) : t('test.basis.' + verdict));
          return h('tr', { key: scenario, style: { borderTop: '1px solid ' + BORDER } },
            h('td', { style: cell }, t('test.scenario.' + scenarioKey)),
            h('td', { style: cell }, result.ok ? String(result.ms) : '—'),
            h('td', { style: cell },
              h('div', { style: { fontWeight: 600, color: verdict === 'error' ? DANGER : 'inherit' } }, t('test.verdict.' + verdict)),
              result.ok ? h('div', { style: NOTE }, t('test.risk.' + risk)) : null),
            h('td', { style: { ...cell, color: MUTED, whiteSpace: 'pre-wrap' } },
              reason,
              h(TechnicalDetails, { t, detail: result.ok ? (display || rule ? null : composed.reason) : result.error })));
        })));
    }

    function SmokeTest({ t, resolveText, isDecisions, dirty, running, onRun, results }) {
      const disabled = running || !isDecisions || dirty;
      return h('section', { style: { ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 } },
        h('h2', { style: HEADING }, t('test.title')),
        h('div', { style: ROW },
          h('button', { type: 'button', onClick: onRun, disabled, style: buttonStyle(disabled) }, t(running ? 'test.running' : 'test.run')),
          !isDecisions ? h('span', { style: NOTE }, t('test.sessions'))
            : dirty ? h('span', { style: NOTE }, t('test.unsaved')) : null),
        isDecisions && results?.length ? h(SmokeResults, { t, resolveText, results }) : null);
    }

    function ConfigPanel({ t, resolveText }) {
      const [settings, setSettings] = React.useState(null);
      const [runtime, setRuntime] = React.useState(null);
      const [problems, setProblems] = React.useState([]);
      const [error, setError] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [saved, setSaved] = React.useState(false);
      const [testing, setTesting] = React.useState(false);
      const [results, setResults] = React.useState(null);
      const [rules, setRules] = React.useState([]);
      const [showMissing, setShowMissing] = React.useState(false);
      // The form only holds a typed replacement key or a request to remove it.
      const [apiKeyInput, setApiKeyInput] = React.useState('');
      const [clearKey, setClearKey] = React.useState(false);
      const [baseline, setBaseline] = React.useState(null);
      const nextRuleId = React.useRef(1);
      const lastAddedId = React.useRef(null);
      // A save response must not overwrite edits made while it was in flight.
      const editVersion = React.useRef(0);

      React.useEffect(function () {
        callApi('/config').then(function (payload) {
          const { rules: storedRules, ...fields } = payload.settings;
          const loaded = draftRules(storedRules, nextRuleId);
          setSettings(fields);
          setRules(loaded);
          setBaseline(savedForm(fields, loaded));
          setRuntime(payload.runtime);
          setProblems(Array.isArray(payload.problems) ? payload.problems : []);
        }, function (err) { setError(reportError('load.error', err)); });
      }, []);

      function setField(field, value) {
        editVersion.current += 1;
        setSettings((prev) => ({ ...prev, [field]: value }));
      }

      function addRule() {
        if (rules.length >= RULE_MAX_COUNT) return;
        const id = nextRuleId.current++;
        lastAddedId.current = id;
        editVersion.current += 1;
        setRules((prev) => [...prev, { id, condition: '', verdict: 'ask' }]);
      }

      function changeRule(id, changes) {
        editVersion.current += 1;
        setRules((prev) => prev.map((rule) => rule.id === id ? { ...rule, ...changes } : rule));
      }

      function removeRule(id) {
        editVersion.current += 1;
        setRules((prev) => prev.filter((rule) => rule.id !== id));
      }

      async function save() {
        if (!validation.valid) {
          setShowMissing(true);
          return;
        }
        const startVersion = editVersion.current;
        const { hasApiKey, ...fields } = settings;
        const update = { ...fields, rules: ruleData(rules) };
        if (apiKeyInput !== '') update.apiKey = apiKeyInput;
        if (clearKey) update.clearApiKey = true;
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
          const payload = await callApi('/save', { settings: update });
          const { rules: storedRules, ...savedFields } = payload.settings;
          const savedRules = draftRules(storedRules, nextRuleId, rules);
          setBaseline(savedForm(savedFields, savedRules));
          if (editVersion.current === startVersion) {
            setSettings(savedFields);
            setRules(savedRules);
            setApiKeyInput('');
            setClearKey(false);
            setShowMissing(false);
          } else {
            setSettings((prev) => ({ ...prev, hasApiKey: savedFields.hasApiKey }));
          }
          setSaved(true);
          setResults(null);
          setProblems(Array.isArray(payload.problems) ? payload.problems : []);
        } catch (err) {
          setError(reportError('save.error', err));
        } finally {
          setSaving(false);
        }
      }

      async function runTest() {
        setTesting(true);
        setResults(null);
        setError(null);
        try {
          const payload = await callApi('/test', {});
          setResults(payload.results);
        } catch (err) {
          setError(reportError('test.error', err));
        } finally {
          setTesting(false);
        }
      }

      if (settings === null) {
        return error ? h(RequestError, { t, error }) : h('p', { role: 'status', style: NOTE }, t('panel.loading'));
      }

      const isDecisions = settings.engine === 'decisions';
      const repairingDecisions = !isDecisions && baseline?.needsDecisionsRepair;
      const showDecisionsFields = isDecisions || repairingDecisions;
      const dirty = formSnapshot(settings, rules, apiKeyInput, clearKey) !== baseline?.snapshot;
      const validation = validateRules(rules);
      const textInput = (field, label, hint, inputMode) => h(Field, { key: field, label, hint },
        h('input', {
          type: 'text', inputMode, value: settings[field] ?? '', style: INPUT,
          onChange: (event) => setField(field, event.target.value),
        }));
      const keyStatus = clearKey ? t('apikey.clear.pending') : settings.hasApiKey ? t('apikey.saved') : '';
      const runtimeState = !runtime ? 'runtime.pending' : runtime.accepting ? 'runtime.accepting' : 'runtime.closed';
      // Both config and save return the current problems; runtime is only a load-time snapshot.
      const status = t(problems.length ? 'runtime.paused' : runtimeState);

      return h('div', { style: { ...STACK, width: '100%', maxWidth: 680, paddingBottom: 12, gap: 16, fontSize: 13, lineHeight: 1.5 } },
        h('div', { style: { display: 'grid', gap: 4 } },
          h('h2', { style: HEADING }, t('panel.title')),
          h('p', { style: NOTE }, t('panel.desc')),
          h('p', { style: NOTE }, t('runtime.status', {
            state: runtime?.active ? t('runtime.active', { state: status, count: runtime.active }) : status,
          }))),
        problems.length ? h('div', { role: 'alert', style: { ...CARD, gap: 4 } },
          h('div', { style: { fontWeight: 600, color: DANGER } }, t('problems.title')),
          h('p', { style: NOTE }, t('problems.desc')),
          h(TechnicalDetails, { t, detail: h('ul', { style: { paddingInlineStart: 20, marginBlock: 4 } },
            problems.map((text, i) => h('li', { key: i }, text))) })) : null,

        h(Field, { label: t('engine.label') },
          h('select', { value: settings.engine, onChange: (event) => setField('engine', event.target.value), style: INPUT },
            h('option', { value: 'decisions' }, t('engine.decisions')),
            h('option', { value: 'session' }, t('engine.session')))),
        repairingDecisions ? h('p', { style: NOTE }, t('engine.repair')) : null,
        showDecisionsFields ? textInput('endpoint', t('endpoint.label'), null, 'url') : null,
        isDecisions ? h('div', null,
            h(Field, { label: t('apikey.label'), hint: [keyStatus, t('apikey.hint')].filter(Boolean).join(' ') },
              h('input', {
                type: 'password', autoComplete: 'new-password', value: apiKeyInput,
                placeholder: settings.hasApiKey && !clearKey ? t('apikey.placeholder') : undefined,
                onChange: (event) => { editVersion.current += 1; setApiKeyInput(event.target.value); },
                disabled: clearKey, style: INPUT,
              })),
            settings.hasApiKey ? h('button', {
              type: 'button', style: { ...BUTTON, marginTop: 6 },
              onClick: () => { editVersion.current += 1; setApiKeyInput(''); setClearKey(!clearKey); },
            }, t(clearKey ? 'apikey.clear.undo' : 'apikey.clear')) : null) : null,
        showDecisionsFields ? textInput('model', t('model.label')) : null,
        h(Field, { label: t('denialroute.label') },
          h('select', {
            value: settings.denialRoute ?? 'ask',
            onChange: (event) => setField('denialRoute', event.target.value), style: INPUT,
          },
            h('option', { value: 'ask' }, t('denialroute.ask')),
            h('option', { value: 'final' }, t('denialroute.final')))),
        textInput('timeoutMs', t('timeout.label'), t('timeout.hint'), 'numeric'),

        h(RulesEditor, {
          t, engine: settings.engine, rules, validation, showMissing, lastAddedId: lastAddedId.current,
          onAdd: addRule, onChange: changeRule, onRemove: removeRule,
        }),
        isDecisions ? h('details', null,
          h('summary', { style: { fontWeight: 600, cursor: 'pointer' } }, t('thresholds.title')),
          h('div', { style: { ...STACK, marginTop: 8 } },
            THRESHOLDS.map((field) => textInput(field, t('thresholds.' + field), null, 'decimal')))) : null,

        h('div', { style: ACTION_BAR },
          h('button', { type: 'button', onClick: save, disabled: saving, style: buttonStyle(saving, PRIMARY_BUTTON) },
            t(saving ? 'saving' : 'save')),
          showMissing && !validation.valid ? h('span', { role: 'alert', style: ERROR_NOTE }, t('save.invalid'))
            : saved && !dirty ? h('span', { role: 'status', style: { ...NOTE, color: 'var(--dsw-alias-state-success-primary, #21783e)' } },
              t('saved')) : null),
        error ? h(RequestError, { t, error }) : null,
        h(SmokeTest, { t, resolveText, isDecisions, dirty, running: testing, onRun: runTest, results }));
    }

    /**
     * Composer dock pill: this session's cumulative approval asks and pass
     * rate, polled from the host route folding the decision-review JSONL
     * trail. Renders nothing until the session has at least one ask.
     */
    function ApprovalStatsPill({ t, sessionId }) {
      const [stats, setStats] = React.useState(null);

      React.useEffect(function () {
        if (!sessionId) {
          console.info('[decision-review] dock pill: no sessionId prop');
          return undefined;
        }
        let alive = true;
        let warned = false;
        // Trails key sessions by bare uuid; the client prop may carry the
        // `session-<uuid>` wire form.
        const id = String(sessionId).replace(/^session-/, '');
        async function tick() {
          if (document.hidden) return;
          try {
            const res = await fetch(API_BASE + '/stats?session=' + encodeURIComponent(id));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const payload = await res.json();
            if (alive && payload && typeof payload.reviewed === 'number') setStats(payload);
          } catch (err) {
            if (!warned) { warned = true; console.warn('[decision-review] dock pill fetch failed:', err); }
          }
        }
        tick();
        const timer = setInterval(tick, 4000);
        return function () { alive = false; clearInterval(timer); };
      }, [sessionId]);

      if (!stats || !stats.reviewed) return null;
      const rate = stats.passRate === null ? '—' : stats.passRate;
      // Same skin as the shipped dock pills: bare icon + reading, no chip.
      return h('span', {
        title: t('pill.title', { n: stats.reviewed, auto: stats.autoAllowed, asked: stats.asked, denied: stats.finalDenied + stats.failed }),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
          color: 'var(--dsw-alias-label-secondary)',
        },
      },
        h('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, strokeWidth: 1,
          style: { flex: '0 0 auto' },
        },
          h('path', { d: 'M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z', stroke: 'currentColor', strokeLinejoin: 'round' }),
          h('path', { d: 'M5.75 10.15L8 4.95L10.25 10.15M6.43 8.59H9.57', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' })),
        h('span', null, t('pill.label', { n: stats.reviewed, p: rate })));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const disposeLocale = ctx.locale.register(NS, MESSAGES);
        const resolveText = (text) => ctx.locale.resolveText(text);

        ctx.slots.inject('plugins.row.config', function () {
          return ctx.slots.register(
            { name: 'plugins.row.config', key: '@local/decision-review#decision-review', locale: NS },
            function RowConfig({ t, view }) {
              if (view === 'summary') return h('span', { style: NOTE }, t('panel.desc'));
              return h(ConfigPanel, { t, resolveText });
            });
        });

        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'decision-review-approvals', order: 2, locale: NS },
            ApprovalStatsPill);
        });

        return disposeLocale;
      },
    };
  },
});
