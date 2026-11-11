/**
 * Client half of the decision-review bundle.
 *
 * Contributes the row's configuration page to the Web plugins page:
 * plugins.row.config ('@local/decision-review#decision-review') renders the
 * summary line and the full configuration form on the row detail page.
 * plugins.detail.section is deliberately not used — it renders on the same
 * page and would duplicate the panel.
 *
 * Reads and writes settings through the bundle's authenticated host routes
 * under /api/decision-review (same-origin, mounted on the host Connection), so
 * there is no config-form plumbing dependency. The stored API key is
 * write-only: the host never sends it back.
 */
window.__ModuleLoader__.load({
  id: '@local/decision-review',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const DICT_EN = {
      'title': 'Decision Review',
      'panel.title': 'Authorization review engine',
      'panel.desc': 'Per-tool-call Auto review. The decisions engine sends the frozen call trail to the OpenAI Decisions API; the session engine mirrors the official plugin and reviews with the session model.',
      'engine.label': 'Engine',
      'engine.decisions': 'Decisions (gpt-6-luna, independent reviewer)',
      'engine.session': 'Follow session (official mirror review)',
      'endpoint.label': 'Decisions API URL',
      'apikey.label': 'API key',
      'apikey.hint': 'Stored in plaintext inside the profile directory (decision-review.settings.json).',
      'apikey.saved': 'A key is saved. Leave this blank to keep it, or type a new one to replace it.',
      'apikey.placeholder': '•••••••• (saved)',
      'apikey.clear': 'Remove saved key',
      'apikey.clear.pending': 'The saved key will be removed when you save.',
      'apikey.clear.undo': 'Keep saved key',
      'model.label': 'Decisions model',
      'budget.label': 'State budget',
      'budget.full': 'Full (recommended; >272K input costs 2x)',
      'budget.trimmed': 'Trimmed (long entries capped, cheapest)',
      'timeout.label': 'Request timeout (ms)',
      'timeout.hint': 'Integer between 5000 and 600000; applies to both engines.',
      'denialroute.label': 'On reviewer denial',
      'denialroute.ask': 'Ask me (official semantics: prompts in ask sessions)',
      'denialroute.final': 'Final-deny; feed the reason back to the model',
      'thresholds.title': 'Thresholds (advanced)',
      'save': 'Save',
      'saving': 'Saving…',
      'saved': 'Saved.',
      'test': 'Run smoke test (3 scenarios)',
      'testing': 'Testing…',
      'test.sessions': 'Smoke test runs the decisions engine only.',
      'test.unsaved': 'Unsaved changes: save first, the smoke test uses the saved settings.',
      'test.result': 'Scenario',
      'test.ms': 'ms',
      'test.verdict': 'Verdict',
      'test.basis': 'Basis',
      'load.error': 'Failed to load settings',
      'save.error': 'Save failed',
      'runtime.label': 'Runtime',
      'runtime.accepting': 'accepting reviews',
      'runtime.closed': 'closing',
      'risk.allow': 'ALLOW',
      'risk.deny': 'DENY',
      'rules.label': 'Operator rules',
      'rules.hint': 'One per line: verdict|condition. verdict ∈ allow (auto-pass) / allow_if_requested (pass when you explicitly asked) / ask (user adjudicates) / deny (hard block). Example: ask|All irreversible deletions',
      'rules.error.format': 'Rules line {n}: expected "verdict|condition" with verdict ∈ allow / allow_if_requested / ask / deny.',
      'rules.error.long': 'Rules line {n}: the condition is longer than {max} characters.',
      'rules.error.limit': 'Too many rules: at most {maxCount} rules and {maxTotal} condition characters in total.',
      'pill.label': '{n} reviewed · {p}% auto-passed',
      'pill.title': 'Auto review this session: {n} calls · {auto} auto-passed · {asked} asked · {denied} denied',
    };
    const DICT_ZH = {
      'title': '决策评审',
      'panel.title': '授权评审引擎',
      'panel.desc': '逐调用 Auto review。decisions 引擎把冻结的调用轨迹发给 OpenAI Decisions API;session 引擎镜像官方插件,用会话模型评审。',
      'engine.label': '引擎',
      'engine.decisions': 'Decisions(gpt-6-luna,独立评审员)',
      'engine.session': '跟随主会话(官方镜像评审)',
      'endpoint.label': 'Decisions API 地址',
      'apikey.label': 'API 密钥',
      'apikey.hint': '以明文存储在 profile 目录(decision-review.settings.json)。',
      'apikey.saved': '已保存密钥。留空表示保留，输入新值表示替换。',
      'apikey.placeholder': '•••••••• (已保存)',
      'apikey.clear': '移除已保存的密钥',
      'apikey.clear.pending': '保存时将移除已保存的密钥。',
      'apikey.clear.undo': '保留已保存的密钥',
      'model.label': 'Decisions 模型',
      'budget.label': 'State 预算',
      'budget.full': '全保真(推荐;输入超 272K 按 2x 计价)',
      'budget.trimmed': '裁剪(长条目封顶,最省)',
      'timeout.label': '请求超时(ms)',
      'timeout.hint': '5000 到 600000 之间的整数；两种引擎都生效。',
      'denialroute.label': '评审拒绝时',
      'denialroute.ask': '问我(官方语义:ask 会话弹审批卡片)',
      'denialroute.final': '直接拒绝,原因回给模型自救',
      'thresholds.title': '阈值(高级)',
      'save': '保存',
      'saving': '保存中…',
      'saved': '已保存。',
      'test': '运行冒烟测试(3 场景)',
      'testing': '测试中…',
      'test.sessions': '冒烟测试只覆盖 decisions 引擎。',
      'test.unsaved': '有未保存的修改：请先保存，冒烟测试使用已保存的配置。',
      'test.result': '场景',
      'test.ms': '毫秒',
      'test.verdict': '结论',
      'test.basis': '依据',
      'load.error': '配置加载失败',
      'save.error': '保存失败',
      'runtime.label': '运行时',
      'runtime.accepting': '正在受理评审',
      'runtime.closed': '关闭中',
      'risk.allow': '放行',
      'risk.deny': '拒绝',
      'rules.label': '操作者规则',
      'rules.hint': '每行一条:verdict|条件。verdict ∈ allow(直接放行)/ allow_if_requested(明确要求时放行)/ ask(转人工裁决)/ deny(直接拒绝)。例:ask|所有不可逆的删除操作',
      'rules.error.format': '规则第 {n} 行：格式应为“verdict|条件”，verdict ∈ allow / allow_if_requested / ask / deny。',
      'rules.error.long': '规则第 {n} 行：条件超过 {max} 个字符。',
      'rules.error.limit': '规则过多：最多 {maxCount} 条，条件总长度不超过 {maxTotal} 个字符。',
      'pill.label': '自动审批 {n} · 通过率 {p}%',
      'pill.title': '本次会话自动评审 {n} 次:自动放行 {auto} · 转人工 {asked} · 拒绝 {denied}',
    };

    const INPUT_STYLE = {
      width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-secondary, #8884)', fontSize: 12,
      background: 'transparent', color: 'inherit',
    };
    const LABEL_STYLE = { display: 'block', fontSize: 12, margin: '10px 0 4px', color: 'var(--dsw-alias-label-secondary)' };

    function Field(props) {
      return h('label', { style: { display: 'block' } },
        h('span', { style: LABEL_STYLE }, props.label),
        props.children,
        props.hint ? h('div', { style: { fontSize: 11, marginTop: 4, color: 'var(--dsw-alias-label-tertiary, #999)' } }, props.hint) : null,
      );
    }

    const API_BASE = '/api/decision-review';

    /**
     * One call to a bundle route. The route is same-origin and mounted behind
     * the host's own authentication (the browser cookie rides along); a body
     * makes it a JSON POST. A failure throws the route's own error message.
     */
    async function callApi(path, body) {
      const res = await fetch(API_BASE + path, body === undefined ? undefined : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload = null;
      try { payload = await res.json(); } catch (_) { /* non-JSON body */ }
      if (!res.ok || (payload && payload.error)) throw new Error((payload && payload.error) || ('HTTP ' + res.status));
      return payload;
    }

    const RULE_VERDICTS = ['allow', 'allow_if_requested', 'ask', 'deny'];
    // Same caps as the host enforces when it saves.
    const RULE_MAX_COUNT = 20;
    const RULE_MAX_CONDITION = 400;
    const RULE_MAX_TOTAL = 2000;
    // ASCII and full-width bar both separate verdict from condition.
    const RULE_SEPARATOR = /[|｜]/;

    /** rules -> textarea text (one `verdict|condition` per line). */
    function rulesToText(rules) {
      return (rules ?? []).map((r) => `${r.verdict}|${r.condition}`).join('\n');
    }

    /**
     * textarea text -> { rules, errors }. Every non-blank line must be a valid
     * rule, so a typo is reported instead of silently dropping an operator rule.
     */
    function parseRules(text) {
      const rules = [];
      const errors = [];
      let total = 0;
      String(text || '').split('\n').forEach(function (line, position) {
        const trimmed = line.trim();
        if (!trimmed) return;
        const found = RULE_SEPARATOR.exec(trimmed);
        const verdict = found ? trimmed.slice(0, found.index).trim().toLowerCase() : '';
        const condition = found ? trimmed.slice(found.index + 1).trim() : '';
        if (!RULE_VERDICTS.includes(verdict) || !condition) {
          errors.push({ key: 'rules.error.format', params: { n: position + 1 } });
          return;
        }
        if (condition.length > RULE_MAX_CONDITION) {
          errors.push({ key: 'rules.error.long', params: { n: position + 1, max: RULE_MAX_CONDITION } });
          return;
        }
        total += condition.length;
        rules.push({ condition: condition, verdict: verdict });
      });
      if (rules.length > RULE_MAX_COUNT || total > RULE_MAX_TOTAL) {
        errors.push({ key: 'rules.error.limit', params: { maxCount: RULE_MAX_COUNT, maxTotal: RULE_MAX_TOTAL } });
      }
      return { rules: rules, errors: errors };
    }

    /** Stable text of everything the form can change; compared to spot unsaved edits. */
    function formSnapshot(settings, rulesText, apiKeyInput, clearKey) {
      return JSON.stringify([settings, rulesText, apiKeyInput, clearKey]);
    }

    function errorText(err) {
      return err instanceof Error ? err.message : String(err);
    }

    function ConfigPanel(props) {
      const t = props.t;
      const [settings, setSettings] = React.useState(null);
      const [runtime, setRuntime] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [savedAt, setSavedAt] = React.useState(0);
      const [testing, setTesting] = React.useState(false);
      const [results, setResults] = React.useState(null);
      const [rulesText, setRulesText] = React.useState('');
      // The stored API key never reaches the browser: the form only ever holds
      // a replacement the user typed, or the request to remove the stored one.
      const [apiKeyInput, setApiKeyInput] = React.useState('');
      const [clearKey, setClearKey] = React.useState(false);
      const [baseline, setBaseline] = React.useState('');
      // Counts user edits so a save response never overwrites edits made while it was in flight.
      const editVersion = React.useRef(0);

      function showLoaded(payload) {
        const loaded = payload.settings;
        const text = rulesToText(loaded.rules);
        setSettings(loaded);
        setRulesText(text);
        setApiKeyInput('');
        setClearKey(false);
        setBaseline(formSnapshot(loaded, text, '', false));
        setRuntime(payload.runtime);
        setError(null);
      }

      React.useEffect(function () {
        callApi('/config').then(showLoaded, function (err) { setError(errorText(err)); });
      }, []);

      function setField(field, value) {
        editVersion.current += 1;
        setSettings(function (prev) { return { ...prev, [field]: value }; });
      }

      async function save() {
        const parsed = parseRules(rulesText);
        if (parsed.errors.length > 0) {
          setError(parsed.errors.map(function (problem) { return t(problem.key, problem.params); }).join(' '));
          return;
        }
        const startVersion = editVersion.current;
        const update = { ...settings, rules: parsed.rules };
        delete update.hasApiKey;
        if (apiKeyInput !== '') update.apiKey = apiKeyInput;
        if (clearKey) update.clearApiKey = true;
        setSaving(true);
        try {
          const payload = await callApi('/save', { settings: update });
          const saved = payload.settings;
          const savedText = rulesToText(saved.rules);
          setBaseline(formSnapshot(saved, savedText, '', false));
          if (editVersion.current === startVersion) {
            setSettings(saved);
            setRulesText(savedText);
            setApiKeyInput('');
            setClearKey(false);
          } else {
            // Keep what the user typed since clicking Save; only the stored-key flag is authoritative.
            setSettings(function (prev) { return { ...prev, hasApiKey: saved.hasApiKey }; });
          }
          setSavedAt(Date.now());
          setError(null);
          setRuntime(function (prev) { return { ...(prev ?? {}), engine: saved.engine }; });
        } catch (err) {
          setError(t('save.error') + ': ' + errorText(err));
        } finally {
          setSaving(false);
        }
      }

      async function runTest() {
        setTesting(true);
        setResults(null);
        try {
          const payload = await callApi('/test', {});
          setResults(payload.results);
          setError(null);
        } catch (err) {
          setError(t('test') + ': ' + errorText(err));
        } finally {
          setTesting(false);
        }
      }

      if (error !== null && settings === null) {
        return h('div', { style: { padding: '8px 0', fontSize: 12, color: 'var(--dsw-alias-state-danger-primary, #e5534b)' } }, t('load.error') + ': ' + error);
      }
      if (settings === null) return h('div', { style: { padding: '8px 0', fontSize: 12 } }, '…');

      const isDecisions = settings.engine === 'decisions';
      const dirty = formSnapshot(settings, rulesText, apiKeyInput, clearKey) !== baseline;
      const textInput = function (field, label, hint, type) {
        return h(Field, { label: label, hint: hint },
          h('input', {
            type: type || 'text',
            value: settings[field] ?? '',
            onChange: function (e) { setField(field, e.target.value); },
            style: INPUT_STYLE,
            disabled: !isDecisions && (field === 'endpoint' || field === 'model'),
          }));
      };
      const apiKeyHint = (clearKey ? t('apikey.clear.pending') : (settings.hasApiKey ? t('apikey.saved') : ''))
        + ' ' + t('apikey.hint');

      return h('div', { style: { padding: '4px 0 12px', maxWidth: 560 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, t('panel.title')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } }, t('panel.desc')),
        h('div', { style: { fontSize: 11, marginBottom: 10, color: 'var(--dsw-alias-label-tertiary, #999)' } },
          t('runtime.label') + ': ' + (runtime ? (runtime.accepting ? t('runtime.accepting') : t('runtime.closed')) : '…')
          + (runtime && runtime.active ? (' · ' + runtime.active) : '')),

        h(Field, { label: t('engine.label') },
          h('select', {
            value: settings.engine,
            onChange: function (e) { setField('engine', e.target.value); },
            style: INPUT_STYLE,
          },
            h('option', { value: 'decisions' }, t('engine.decisions')),
            h('option', { value: 'session' }, t('engine.session')))),

        textInput('endpoint', t('endpoint.label')),
        h(Field, { label: t('apikey.label'), hint: apiKeyHint.trim() },
          h('input', {
            type: 'password',
            autoComplete: 'new-password',
            value: apiKeyInput,
            placeholder: settings.hasApiKey && !clearKey ? t('apikey.placeholder') : '',
            onChange: function (e) { editVersion.current += 1; setApiKeyInput(e.target.value); },
            style: INPUT_STYLE,
            disabled: !isDecisions || clearKey,
          })),
        settings.hasApiKey && isDecisions ? h('button', {
          type: 'button',
          onClick: function () { editVersion.current += 1; setApiKeyInput(''); setClearKey(!clearKey); },
          style: { marginTop: 6, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11 },
        }, clearKey ? t('apikey.clear.undo') : t('apikey.clear')) : null,
        textInput('model', t('model.label')),

        h(Field, { label: t('budget.label') },
          h('select', {
            value: settings.stateBudget,
            onChange: function (e) { setField('stateBudget', e.target.value); },
            style: INPUT_STYLE,
          },
            h('option', { value: 'full' }, t('budget.full')),
            h('option', { value: 'trimmed' }, t('budget.trimmed')))),

        h(Field, { label: t('denialroute.label') },
          h('select', {
            value: settings.denialRoute ?? 'ask',
            onChange: function (e) { setField('denialRoute', e.target.value); },
            style: INPUT_STYLE,
          },
            h('option', { value: 'ask' }, t('denialroute.ask')),
            h('option', { value: 'final' }, t('denialroute.final')))),

        textInput('timeoutMs', t('timeout.label'), t('timeout.hint')),

        h('div', { style: { fontSize: 12, fontWeight: 600, margin: '14px 0 2px' } }, t('thresholds.title')),
        textInput('tConf', 'tConf — 分类置信下限'),
        textInput('tHighPred', 'tHighPred — 外泄硬拒绝线'),
        textInput('tMedPred', 'tMedPred — medium 升级线(弱信号)'),
        textInput('tStrongPred', 'tStrongPred — medium 升级线(强信号)'),
        textInput('tAuth', 'tAuth — medium 放行授权线'),

        h(Field, { label: t('rules.label'), hint: t('rules.hint') },
          h('textarea', {
            value: rulesText,
            onChange: function (e) { editVersion.current += 1; setRulesText(e.target.value); },
            rows: 4,
            style: { ...INPUT_STYLE, fontFamily: 'ui-monospace, monospace', resize: 'vertical' },
          })),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 } },
          h('button', {
            type: 'button', onClick: save, disabled: saving,
            style: { padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
          }, saving ? t('saving') : t('save')),
          savedAt && !dirty ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' } }, t('saved')) : null),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 } },
          h('button', {
            type: 'button', onClick: runTest, disabled: testing || !isDecisions || dirty,
            style: { padding: '5px 12px', borderRadius: 6, cursor: isDecisions && !dirty ? 'pointer' : 'not-allowed', fontSize: 12 },
          }, testing ? t('testing') : t('test')),
          !isDecisions ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('test.sessions'))
            : (dirty ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('test.unsaved')) : null)),

        error ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-danger-primary, #e5534b)' } }, error) : null,

        results ? h('table', { style: { marginTop: 10, width: '100%', fontSize: 11, borderCollapse: 'collapse' } },
          h('thead', null, h('tr', null,
            h('th', { style: { textAlign: 'left', padding: '3px 6px' } }, t('test.result')),
            h('th', { style: { textAlign: 'left', padding: '3px 6px' } }, t('test.ms')),
            h('th', { style: { textAlign: 'left', padding: '3px 6px' } }, t('test.verdict')),
            h('th', { style: { textAlign: 'left', padding: '3px 6px' } }, t('test.basis')))),
          h('tbody', null, results.map(function (r) {
            return h('tr', { key: r.scenario },
              h('td', { style: { padding: '3px 6px', fontFamily: 'ui-monospace, monospace' } }, r.scenario),
              h('td', { style: { padding: '3px 6px' } }, r.ok ? String(r.ms) : '—'),
              h('td', { style: { padding: '3px 6px' } }, r.ok
                ? (r.composed.decision === 'allow' ? t('risk.allow') : t('risk.deny')) + ' / ' + r.composed.risk
                : 'error'),
              h('td', { style: { padding: '3px 6px', color: 'var(--dsw-alias-label-secondary)' } },
                r.ok ? (r.composed.reason ?? '—') : (r.error ?? '')));
          }))) : null,
      );
    }

    /**
     * Composer dock pill: this session's cumulative approval asks and pass
     * rate, polled from the host route folding the decision-review JSONL
     * trail. Renders nothing until the session has at least one ask.
     * @param tGet - rebinds the locale seat per render (language switches).
     */
    function makeApprovalStatsPill(tGet) {
      return function ApprovalStatsPill(props) {
        const sessionId = props.sessionId;
        const t = tGet();
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
            xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, 'stroke-width': 1,
            style: { flex: '0 0 auto' },
          },
            h('path', { d: 'M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z', stroke: 'currentColor', 'stroke-linejoin': 'round' }),
            h('path', { d: 'M5.75 10.15L8 4.95L10.25 10.15M6.43 8.59H9.57', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
          h('span', null, t('pill.label', { n: stats.reviewed, p: rate })));
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const localeDisposers = [];
        try {
          localeDisposers.push(ctx.locale.register('decision-review', 'en', DICT_EN));
          localeDisposers.push(ctx.locale.register('decision-review', 'zh', DICT_ZH));
        } catch (error) {
          console.warn('[decision-review] locale registration failed:', error);
        }
        function label() { return ctx.locale.bind('decision-review')('title'); }

        // The row's own configuration page (summary line + full form page).
        // plugins.detail.section is intentionally NOT registered: it renders on
        // the same row detail page and would duplicate this panel.
        try {
          ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register(
              { name: 'plugins.row.config', key: '@local/decision-review#decision-review' },
              function RowConfig(props) {
                const view = props && props.view;
                const t = ctx.locale.bind('decision-review');
                if (view === 'summary') {
                  return h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('panel.desc'));
                }
                return h(ConfigPanel, { t: t });
              });
          });
        } catch (error) {
          console.warn('[decision-review] row.config registration failed:', error);
        }

        // Composer dock pill: per-session approval asks and pass rate, fed by
        // the host's approval-waterfall observer through the JSONL trail.
        try {
          ctx.slots.inject('conversation.composer.dock', function () {
            console.info('[decision-review] dock pill registered');
            return ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'decision-review-approvals', order: 2, locale: 'decision-review' },
              makeApprovalStatsPill(function () { return ctx.locale.bind('decision-review'); }));
          });
        } catch (error) {
          console.warn('[decision-review] dock registration failed:', error);
        }

        return function () {
          for (const dispose of localeDisposers) { try { dispose(); } catch (_) { /* already gone */ } }
        };
      },
    };
  },
});
