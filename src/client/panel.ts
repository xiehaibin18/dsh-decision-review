import * as React from 'react';
import {
  RULE_MAX_CONDITION, RULE_MAX_COUNT, RULE_MAX_TOTAL, RULE_VERDICTS, TEST_SCENARIO_NAMES, THRESHOLDS,
  type DenialRoute, type OperatorRule, type PublicSettings, type ReviewEngine, type ReviewRuntime,
  type RuleVerdict, type SettingsUpdate, type TestResult, type Threshold,
} from '../shared/contracts.js';
import { callApi, reportError, type ApiError } from './api.js';
import type { ResolveText, Translate } from './messages.js';
import { ACTION_BAR, BORDER, BUTTON, CARD, DANGER, ERROR_NOTE, HEADING, INPUT, MUTED, NOTE, PRIMARY_BUTTON, ROW, STACK } from './styles.js';

const h = React.createElement;

type NumericField = Threshold | 'timeoutMs';
type TextField = NumericField | 'endpoint' | 'model';
type DraftSettings = Omit<PublicSettings, 'rules' | NumericField> & Record<NumericField, number | string>;
type DraftRule<V extends string = string> = { id: number; condition: string; verdict: V };
type RuleChanges = Partial<Omit<DraftRule, 'id'>>;

interface LocalizedProps {
  t: Translate;
  resolveText: ResolveText;
}

function Field({ label, children, hint }: { label: string; children?: React.ReactNode; hint?: string | null }) {
  return h('div', { style: { minWidth: 0 } },
    h('label', { style: { display: 'grid', gap: 4 } }, h('span', null, label), children),
    hint ? h('div', { style: { ...NOTE, marginTop: 4 } }, hint) : null);
}

function buttonStyle(disabled: boolean, style = BUTTON): React.CSSProperties {
  return disabled ? { ...style, opacity: 0.55, cursor: 'default' } : style;
}

function TechnicalDetails({ t, detail }: { t: Translate; detail?: React.ReactNode }) {
  if (!detail) return null;
  return h('details', { style: { ...NOTE, marginTop: 4 } },
    h('summary', { style: { cursor: 'pointer' } }, t('error.details')),
    h('div', { style: { whiteSpace: 'pre-wrap' } }, detail));
}

function RequestError({ t, error }: { t: Translate; error: ApiError }) {
  return h('div', { role: 'alert', style: ERROR_NOTE },
    t(error.key),
    h(TechnicalDetails, { t, detail: error.status ? t('error.http', { status: error.status }) : error.detail }));
}

function ruleData<V extends string>(rules: DraftRule<V>[]) {
  return rules.map(({ condition, verdict }) => ({ condition, verdict }));
}

function draftRules(
  rules: OperatorRule[],
  nextId: { current: number },
  previous: DraftRule[] = [],
): DraftRule<RuleVerdict>[] {
  return (rules ?? []).map(({ condition, verdict }, i) => ({
    id: previous[i]?.id ?? nextId.current++, condition, verdict,
  }));
}

function formSnapshot(fields: DraftSettings, rules: DraftRule[], apiKeyInput: string, clearKey: boolean) {
  return JSON.stringify([fields, ruleData(rules), apiKeyInput, clearKey]);
}

function savedForm(fields: DraftSettings, rules: DraftRule[]) {
  return {
    snapshot: formSnapshot(fields, rules, '', false),
    // The host exposes an invalid stored endpoint or model as an empty field.
    needsDecisionsRepair: fields.endpoint === '' || fields.model === '',
  };
}

function conditionProblem(condition: string) {
  if (condition.length > RULE_MAX_CONDITION) return 'rules.error.long';
  if (condition.trim() === '') return 'rules.error.required';
  return null;
}

function isRuleVerdict(verdict: string): verdict is RuleVerdict {
  return RULE_VERDICTS.some((knownVerdict) => knownVerdict === verdict);
}

function validateRules(rules: DraftRule[]) {
  const total = rules.reduce((sum, rule) => sum + rule.condition.length, 0);
  const countInvalid = rules.length > RULE_MAX_COUNT;
  const totalInvalid = total > RULE_MAX_TOTAL;
  const summary = { total, countInvalid, totalInvalid };
  if (!countInvalid && !totalInvalid && rules.every((rule): rule is DraftRule<RuleVerdict> =>
    isRuleVerdict(rule.verdict) && conditionProblem(rule.condition) === null)) {
    return { ...summary, valid: true as const, rules };
  }
  return { ...summary, valid: false as const };
}

interface RuleEditorProps {
  t: Translate;
  rule: DraftRule;
  index: number;
  onChange: (changes: RuleChanges) => void;
  onRemove: () => void;
  showMissing: boolean;
  autoFocus: boolean;
  baseId: string;
}

function RuleEditor({ t, rule, index, onChange, onRemove, showMissing, autoFocus, baseId }: RuleEditorProps) {
  const n = index + 1;
  const headingId = baseId + '-heading';
  const lengthId = baseId + '-length';
  const conditionErrorId = baseId + '-condition-error';
  const verdictErrorId = baseId + '-verdict-error';
  const problem = conditionProblem(rule.condition);
  const conditionError = problem !== 'rules.error.required' || showMissing ? problem : null;
  const verdictInvalid = !isRuleVerdict(rule.verdict);

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
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange({ verdict: event.target.value }),
        'aria-invalid': verdictInvalid || undefined,
        'aria-describedby': verdictInvalid ? verdictErrorId : undefined,
        style: INPUT,
      },
        verdictInvalid ? h('option', { value: '', disabled: true }, t('rules.error.verdict')) : null,
        RULE_VERDICTS.map((verdict) => h('option', { value: verdict, key: verdict }, t(`rules.verdict.${verdict}`))))),
    verdictInvalid ? h('div', { id: verdictErrorId, style: ERROR_NOTE }, t('rules.error.verdict')) : null,
    h(Field, { label: t('rules.condition.label') },
      h('textarea', {
        value: rule.condition,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ condition: event.target.value }),
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

interface RulesEditorProps {
  t: Translate;
  engine: ReviewEngine;
  rules: DraftRule[];
  validation: ReturnType<typeof validateRules>;
  onAdd: () => void;
  onChange: (id: number, changes: RuleChanges) => void;
  onRemove: (id: number) => void;
  showMissing: boolean;
  lastAddedId: number | null;
}

function RulesEditor({ t, engine, rules, validation, onAdd, onChange, onRemove, showMissing, lastAddedId }: RulesEditorProps) {
  const sectionId = React.useId();
  const atCountLimit = rules.length >= RULE_MAX_COUNT;
  const { total, countInvalid, totalInvalid } = validation;
  const add = h('button', { type: 'button', disabled: atCountLimit, style: buttonStyle(atCountLimit), onClick: onAdd },
    h('span', { 'aria-hidden': true }, '+ '), t('rules.add'));

  return h('section', { 'aria-labelledby': sectionId, style: { ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 } },
    h('div', { style: { display: 'grid', gap: 5 } },
      h('h2', { id: sectionId, style: HEADING }, t('rules.title')),
      h('p', { style: NOTE }, t('rules.hint')),
      h('p', { style: NOTE }, t(`rules.engine.${engine}`))),
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

function SmokeResults({ t, resolveText, results }: LocalizedProps & { results: TestResult[] }) {
  const cell: React.CSSProperties = { padding: '8px 6px', textAlign: 'start', verticalAlign: 'top', overflowWrap: 'anywhere' };
  return h('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } },
    h('thead', null, h('tr', null,
      (['test.scenario', 'test.ms', 'test.verdict', 'test.basis'] as const).map((key) =>
        h('th', { key, scope: 'col', style: cell }, t(key))))),
    h('tbody', null, results.map((result) => {
      const { scenario } = result;
      const composed = result.ok ? result.composed : undefined;
      const scenarioKey = TEST_SCENARIO_NAMES.includes(scenario) ? scenario : 'unknown';
      const verdict = composed ? (composed.decision === 'allow' ? 'allow' : 'deny') : 'error';
      const risk = composed && ['low', 'medium', 'high'].includes(composed.risk) ? composed.risk : 'unknown';
      const rule = composed?.why?.code === 'rule_allow' ? composed.why : null;
      const display = composed?.display ? resolveText(composed.display) : null;
      const reason = display || (rule ? t('test.basis.rule_allow', { condition: rule.condition }) : t(`test.basis.${verdict}`));
      return h('tr', { key: scenario, style: { borderTop: '1px solid ' + BORDER } },
        h('td', { style: cell }, t(`test.scenario.${scenarioKey}`)),
        h('td', { style: cell }, result.ok ? String(result.ms) : '—'),
        h('td', { style: cell },
          h('div', { style: { fontWeight: 600, color: verdict === 'error' ? DANGER : 'inherit' } }, t(`test.verdict.${verdict}`)),
          result.ok ? h('div', { style: NOTE }, t(`test.risk.${risk}`)) : null),
        h('td', { style: { ...cell, color: MUTED, whiteSpace: 'pre-wrap' } },
          reason,
          h(TechnicalDetails, { t, detail: result.ok ? (display || rule ? null : result.composed.reason) : result.error })));
    })));
}

interface SmokeTestProps extends LocalizedProps {
  isDecisions: boolean;
  dirty: boolean;
  running: boolean;
  onRun: () => void;
  results: TestResult[] | null;
}

function SmokeTest({ t, resolveText, isDecisions, dirty, running, onRun, results }: SmokeTestProps) {
  const disabled = running || !isDecisions || dirty;
  return h('section', { style: { ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 } },
    h('h2', { style: HEADING }, t('test.title')),
    h('div', { style: ROW },
      h('button', { type: 'button', onClick: onRun, disabled, style: buttonStyle(disabled) }, t(running ? 'test.running' : 'test.run')),
      !isDecisions ? h('span', { style: NOTE }, t('test.sessions'))
        : dirty ? h('span', { style: NOTE }, t('test.unsaved')) : null),
    isDecisions && results?.length ? h(SmokeResults, { t, resolveText, results }) : null);
}

export function ConfigPanel({ t, resolveText }: LocalizedProps) {
  const [settings, setSettings] = React.useState<DraftSettings | null>(null);
  const [runtime, setRuntime] = React.useState<ReviewRuntime | null>(null);
  const [problems, setProblems] = React.useState<string[]>([]);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [results, setResults] = React.useState<TestResult[] | null>(null);
  const [rules, setRules] = React.useState<DraftRule[]>([]);
  const [showMissing, setShowMissing] = React.useState(false);
  // The form only holds a typed replacement key or a request to remove it.
  const [apiKeyInput, setApiKeyInput] = React.useState('');
  const [clearKey, setClearKey] = React.useState(false);
  const [baseline, setBaseline] = React.useState<ReturnType<typeof savedForm> | null>(null);
  const nextRuleId = React.useRef(1);
  const lastAddedId = React.useRef<number | null>(null);
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

  if (settings === null) {
    return error ? h(RequestError, { t, error }) : h('p', { role: 'status', style: NOTE }, t('panel.loading'));
  }

  function setField<K extends keyof DraftSettings>(field: K, value: DraftSettings[K]) {
    editVersion.current += 1;
    setSettings((prev) => prev && { ...prev, [field]: value });
  }

  function addRule() {
    if (rules.length >= RULE_MAX_COUNT) return;
    const id = nextRuleId.current++;
    lastAddedId.current = id;
    editVersion.current += 1;
    setRules((prev) => [...prev, { id, condition: '', verdict: 'ask' }]);
  }

  function changeRule(id: number, changes: RuleChanges) {
    editVersion.current += 1;
    setRules((prev) => prev.map((rule) => rule.id === id ? { ...rule, ...changes } : rule));
  }

  function removeRule(id: number) {
    editVersion.current += 1;
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  }

  const save = async () => {
    if (!validation.valid) {
      setShowMissing(true);
      return;
    }
    const startVersion = editVersion.current;
    const { hasApiKey, ...fields } = settings;
    const update: SettingsUpdate = { ...fields, rules: ruleData(validation.rules) };
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
        setSettings((prev) => prev && { ...prev, hasApiKey: savedFields.hasApiKey });
      }
      setSaved(true);
      setResults(null);
      setProblems(Array.isArray(payload.problems) ? payload.problems : []);
    } catch (err) {
      setError(reportError('save.error', err));
    } finally {
      setSaving(false);
    }
  };

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

  const isDecisions = settings.engine === 'decisions';
  const repairingDecisions = !isDecisions && baseline?.needsDecisionsRepair;
  const showDecisionsFields = isDecisions || repairingDecisions;
  const dirty = formSnapshot(settings, rules, apiKeyInput, clearKey) !== baseline?.snapshot;
  const validation = validateRules(rules);
  const textInput = (
    field: TextField,
    label: string,
    hint?: string | null,
    inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'],
  ) => h(Field, { key: field, label, hint },
    h('input', {
      type: 'text', inputMode, value: settings[field] ?? '', style: INPUT,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setField(field, event.target.value),
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
      h('select', {
        value: settings.engine,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setField('engine', event.target.value as ReviewEngine),
        style: INPUT,
      },
        h('option', { value: 'decisions' }, t('engine.decisions')),
        h('option', { value: 'session' }, t('engine.session')))),
    repairingDecisions ? h('p', { style: NOTE }, t('engine.repair')) : null,
    showDecisionsFields ? textInput('endpoint', t('endpoint.label'), null, 'url') : null,
    isDecisions ? h('div', null,
        h(Field, { label: t('apikey.label'), hint: [keyStatus, t('apikey.hint')].filter(Boolean).join(' ') },
          h('input', {
            type: 'password', autoComplete: 'new-password', value: apiKeyInput,
            placeholder: settings.hasApiKey && !clearKey ? t('apikey.placeholder') : undefined,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => { editVersion.current += 1; setApiKeyInput(event.target.value); },
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
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setField('denialRoute', event.target.value as DenialRoute), style: INPUT,
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
        THRESHOLDS.map((field) => textInput(field, t(`thresholds.${field}`), null, 'decimal')))) : null,

    h('div', { style: ACTION_BAR },
      h('button', { type: 'button', onClick: save, disabled: saving, style: buttonStyle(saving, PRIMARY_BUTTON) },
        t(saving ? 'saving' : 'save')),
      showMissing && !validation.valid ? h('span', { role: 'alert', style: ERROR_NOTE }, t('save.invalid'))
        : saved && !dirty ? h('span', { role: 'status', style: { ...NOTE, color: 'var(--dsw-alias-state-success-primary, #21783e)' } },
          t('saved')) : null),
    error ? h(RequestError, { t, error }) : null,
    h(SmokeTest, { t, resolveText, isDecisions, dirty, running: testing, onRun: runTest, results }));
}
