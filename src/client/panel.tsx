/** @jsxRuntime classic */
import * as React from 'react'
import {
  RULE_MAX_COUNT,
  THRESHOLDS,
  type ConfigResponse,
  type DenialRoute,
  type PublicSettings,
  type ReviewEngine,
  type SettingsUpdate,
  type TestResult,
  type Threshold,
} from '../shared/contracts.js'
import { reportError, type ApiError, type ReviewApi } from './api.js'
import { Field, TechnicalDetails } from './components.js'
import type { ResolveText, Translate } from './messages.js'
import { RulesEditor } from './rules-editor.js'
import { draftRules, ruleData, validateRules, type DraftRule, type RuleChanges } from './rules.js'
import { SmokeTest } from './smoke-test.js'
import {
  ACTION_BAR,
  BUTTON,
  CARD,
  DANGER,
  ERROR_NOTE,
  HEADING,
  INPUT,
  NOTE,
  PRIMARY_BUTTON,
  STACK,
  buttonStyle,
} from './styles.js'

type NumericField = Threshold | 'timeoutMs'
type TextField = NumericField | 'endpoint' | 'model'
type DraftSettings = Omit<PublicSettings, 'rules' | NumericField> & Record<NumericField, number | string>

interface ConfigPanelProps {
  t: Translate
  resolveText: ResolveText
  api: ReviewApi
}

type LoadState = { api: ReviewApi } & (
  { status: 'loading' } | { status: 'ready'; config: ConfigResponse } | { status: 'error'; error: ApiError }
)

export function ConfigPanel({ t, resolveText, api }: ConfigPanelProps) {
  const [load, setLoad] = React.useState<LoadState>({ api, status: 'loading' })
  const loadedApi = React.useRef<ReviewApi | null>(null)

  React.useEffect(() => {
    // Fast Refresh reruns effects. Keep the loaded form and its draft for the same API.
    if (loadedApi.current === api) return
    loadedApi.current = null
    const controller = new AbortController()
    const { signal } = controller
    api.loadConfig(signal).then(
      (config) => {
        if (signal.aborted) return
        loadedApi.current = api
        setLoad({ api, status: 'ready', config })
      },
      (error) => {
        if (!signal.aborted) setLoad({ api, status: 'error', error: reportError('load.error', error) })
      },
    )
    return () => controller.abort()
  }, [api])

  if (load.api !== api) {
    setLoad({ api, status: 'loading' })
  } else if (load.status === 'ready') {
    return <SettingsForm t={t} resolveText={resolveText} api={api} initialConfig={load.config} />
  } else if (load.status === 'error') {
    return <RequestError t={t} error={load.error} />
  }
  return (
    <p role="status" style={NOTE}>
      {t('panel.loading')}
    </p>
  )
}

function SettingsForm({ t, resolveText, api, initialConfig }: ConfigPanelProps & { initialConfig: ConfigResponse }) {
  const { rules: storedRules, ...initialFields } = initialConfig.settings
  const [settings, setSettings] = React.useState<DraftSettings>(initialFields)
  const [rules, setRules] = React.useState<DraftRule[]>(() => draftRules(storedRules, { current: 1 }))
  const [problems, setProblems] = React.useState(() => readProblems(initialConfig.problems))
  const [error, setError] = React.useState<ApiError | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [results, setResults] = React.useState<TestResult[] | null>(null)
  const [showMissing, setShowMissing] = React.useState(false)
  // The form holds a typed replacement key or a request to remove the stored key.
  const [apiKeyInput, setApiKeyInput] = React.useState('')
  const [clearKey, setClearKey] = React.useState(false)
  const [baseline, setBaseline] = React.useState(() => savedForm(settings, rules))
  const nextRuleId = React.useRef(rules.length + 1)
  const lastAddedId = React.useRef<number | null>(null)
  // A save response must not overwrite edits made while it was in flight.
  const editVersion = React.useRef(0)
  const saveRequest = React.useRef<AbortController | null>(null)
  const testRequest = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    // Fast Refresh can restart the effect while retaining the form state.
    if (saveRequest.current?.signal.aborted) {
      saveRequest.current = null
      setSaving(false)
    }
    if (testRequest.current?.signal.aborted) {
      testRequest.current = null
      setTesting(false)
    }
    return () => {
      saveRequest.current?.abort()
      testRequest.current?.abort()
    }
  }, [])

  const isDecisions = settings.engine === 'decisions'
  const repairingDecisions = !isDecisions && baseline.needsDecisionsRepair
  const showDecisionsFields = isDecisions || repairingDecisions
  const dirty = formSnapshot(settings, rules, apiKeyInput, clearKey) !== baseline.snapshot
  const validation = validateRules(rules)
  const keyStatus = clearKey ? t('apikey.clear.pending') : settings.hasApiKey ? t('apikey.saved') : ''
  const { runtime } = initialConfig
  const runtimeState = !runtime ? 'runtime.pending' : runtime.accepting ? 'runtime.accepting' : 'runtime.closed'
  // Both config and save return the current problems. Runtime is a load-time snapshot.
  const status = t(problems.length ? 'runtime.paused' : runtimeState)

  function clearSmokeTest() {
    testRequest.current?.abort()
    testRequest.current = null
    setTesting(false)
    setResults(null)
  }

  function markEdited() {
    editVersion.current += 1
    clearSmokeTest()
    if (error?.key === 'test.error') setError(null)
  }

  function setField<K extends keyof DraftSettings>(field: K, value: DraftSettings[K]) {
    markEdited()
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function addRule() {
    if (rules.length >= RULE_MAX_COUNT) return
    const id = nextRuleId.current++
    lastAddedId.current = id
    markEdited()
    setRules((prev) => [...prev, { id, condition: '', verdict: 'ask' }])
  }

  function changeRule(id: number, changes: RuleChanges) {
    markEdited()
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule)))
  }

  function removeRule(id: number) {
    markEdited()
    setRules((prev) => prev.filter((rule) => rule.id !== id))
  }

  async function save() {
    if (saveRequest.current) return
    if (!validation.valid) {
      setShowMissing(true)
      return
    }
    const startVersion = editVersion.current
    const { hasApiKey, ...fields } = settings
    const update: SettingsUpdate = { ...fields, rules: ruleData(validation.rules) }
    if (apiKeyInput !== '') update.apiKey = apiKeyInput
    if (clearKey) update.clearApiKey = true
    const controller = new AbortController()
    const { signal } = controller
    saveRequest.current = controller
    clearSmokeTest()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const payload = await api.saveSettings(update, signal)
      if (signal.aborted) return
      const { rules: persistedRules, ...savedFields } = payload.settings
      const savedRules = draftRules(persistedRules, nextRuleId, rules)
      setBaseline(savedForm(savedFields, savedRules))
      if (editVersion.current === startVersion) {
        setSettings(savedFields)
        setRules(savedRules)
        setApiKeyInput('')
        setClearKey(false)
        setShowMissing(false)
      } else {
        setSettings((prev) => ({ ...prev, hasApiKey: savedFields.hasApiKey }))
      }
      setSaved(true)
      setProblems(readProblems(payload.problems))
    } catch (err) {
      if (!signal.aborted) setError(reportError('save.error', err))
    } finally {
      if (!signal.aborted) {
        saveRequest.current = null
        setSaving(false)
      }
    }
  }

  async function runTest() {
    if (testRequest.current || saveRequest.current || !isDecisions || dirty) return
    const controller = new AbortController()
    const { signal } = controller
    testRequest.current = controller
    setTesting(true)
    setResults(null)
    setError(null)
    try {
      const payload = await api.runSmokeTest(signal)
      if (!signal.aborted) setResults(payload.results)
    } catch (err) {
      if (!signal.aborted) setError(reportError('test.error', err))
    } finally {
      if (!signal.aborted) {
        testRequest.current = null
        setTesting(false)
      }
    }
  }

  function textInput(
    field: TextField,
    label: string,
    hint?: string | null,
    inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'],
  ) {
    return (
      <Field key={field} label={label} hint={hint}>
        <input
          type="text"
          inputMode={inputMode}
          value={settings[field] ?? ''}
          style={INPUT}
          onChange={(event) => setField(field, event.target.value)}
        />
      </Field>
    )
  }

  return (
    <div className="decision-review-panel">
      <div style={{ display: 'grid', gap: 4 }}>
        <h2 style={HEADING}>{t('panel.title')}</h2>
        <p style={NOTE}>{t('panel.desc')}</p>
        <p style={NOTE}>
          {t('runtime.status', {
            state: runtime?.active ? t('runtime.active', { state: status, count: runtime.active }) : status,
          })}
        </p>
      </div>
      {problems.length > 0 && (
        <div role="alert" style={{ ...CARD, gap: 4 }}>
          <div style={{ fontWeight: 600, color: DANGER }}>{t('problems.title')}</div>
          <p style={NOTE}>{t('problems.desc')}</p>
          <TechnicalDetails
            t={t}
            detail={
              <ul style={{ paddingInlineStart: 20, marginBlock: 4 }}>
                {problems.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            }
          />
        </div>
      )}

      <Field label={t('engine.label')}>
        <select
          value={settings.engine}
          onChange={(event) => setField('engine', event.target.value as ReviewEngine)}
          style={INPUT}
        >
          <option value="decisions">{t('engine.decisions')}</option>
          <option value="session">{t('engine.session')}</option>
        </select>
      </Field>
      {repairingDecisions && <p style={NOTE}>{t('engine.repair')}</p>}
      {showDecisionsFields && textInput('endpoint', t('endpoint.label'), null, 'url')}
      {isDecisions && (
        <div>
          <Field label={t('apikey.label')} hint={[keyStatus, t('apikey.hint')].filter(Boolean).join(' ')}>
            <input
              type="password"
              autoComplete="new-password"
              value={apiKeyInput}
              placeholder={settings.hasApiKey && !clearKey ? t('apikey.placeholder') : undefined}
              onChange={(event) => {
                markEdited()
                setApiKeyInput(event.target.value)
              }}
              disabled={clearKey}
              style={INPUT}
            />
          </Field>
          {settings.hasApiKey && (
            <button
              type="button"
              style={{ ...BUTTON, marginTop: 6 }}
              onClick={() => {
                markEdited()
                setApiKeyInput('')
                setClearKey(!clearKey)
              }}
            >
              {t(clearKey ? 'apikey.clear.undo' : 'apikey.clear')}
            </button>
          )}
        </div>
      )}
      {showDecisionsFields && textInput('model', t('model.label'))}
      <Field label={t('denialroute.label')}>
        <select
          value={settings.denialRoute ?? 'ask'}
          onChange={(event) => setField('denialRoute', event.target.value as DenialRoute)}
          style={INPUT}
        >
          <option value="ask">{t('denialroute.ask')}</option>
          <option value="final">{t('denialroute.final')}</option>
        </select>
      </Field>
      {textInput('timeoutMs', t('timeout.label'), t('timeout.hint'), 'numeric')}

      <RulesEditor
        t={t}
        engine={settings.engine}
        rules={rules}
        validation={validation}
        showMissing={showMissing}
        lastAddedId={lastAddedId.current}
        onAdd={addRule}
        onChange={changeRule}
        onRemove={removeRule}
      />
      {isDecisions && (
        <details>
          <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{t('thresholds.title')}</summary>
          <div style={{ ...STACK, marginTop: 8 }}>
            {THRESHOLDS.map((field) => textInput(field, t(`thresholds.${field}`), null, 'decimal'))}
          </div>
        </details>
      )}

      <div style={ACTION_BAR}>
        <button type="button" onClick={save} disabled={saving} style={buttonStyle(saving, PRIMARY_BUTTON)}>
          {t(saving ? 'saving' : 'save')}
        </button>
        {showMissing && !validation.valid ? (
          <span role="alert" style={ERROR_NOTE}>
            {t('save.invalid')}
          </span>
        ) : saved && !dirty ? (
          <span role="status" style={{ ...NOTE, color: 'var(--dsw-alias-state-success-primary, #21783e)' }}>
            {t('saved')}
          </span>
        ) : null}
      </div>
      {error && <RequestError t={t} error={error} />}
      <SmokeTest
        t={t}
        resolveText={resolveText}
        isDecisions={isDecisions}
        dirty={dirty}
        saving={saving}
        running={testing}
        onRun={runTest}
        results={results}
      />
    </div>
  )
}

function RequestError({ t, error }: { t: Translate; error: ApiError }) {
  return (
    <div role="alert" style={ERROR_NOTE}>
      {t(error.key)}
      <TechnicalDetails t={t} detail={error.status ? t('error.http', { status: error.status }) : error.detail} />
    </div>
  )
}

function formSnapshot(fields: DraftSettings, rules: DraftRule[], apiKeyInput: string, clearKey: boolean) {
  return JSON.stringify([fields, ruleData(rules), apiKeyInput, clearKey])
}

function savedForm(fields: DraftSettings, rules: DraftRule[]) {
  return {
    snapshot: formSnapshot(fields, rules, '', false),
    // The host exposes an invalid stored endpoint or model as an empty field.
    needsDecisionsRepair: fields.endpoint === '' || fields.model === '',
  }
}

function readProblems(problems: string[]) {
  return Array.isArray(problems) ? problems : []
}
