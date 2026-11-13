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
import { numericValue } from '../shared/decimal-number.js'
import { reportError, type ApiError, type ReviewApi } from './api.js'
import { ChoiceField } from './choice-field.js'
import { SettingField, TechnicalDetails } from './components.js'
import { settingsIssueText, type ResolveText, type Translate } from './messages.js'
import { RulesEditor } from './rules-editor.js'
import { draftRules, ruleData, validateRules, type DraftRule, type RuleChanges } from './rules.js'
import { SmokeTest } from './smoke-test.js'
import { ACTION_BAR, CARD, DANGER, ERROR_NOTE, HEADING, NOTE } from './styles.js'
import { ThresholdEditor } from './threshold-editor.js'
import { formatTimeoutSeconds, parseTimeoutSeconds, TIMEOUT_SECONDS_RANGE } from './timeout.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'

type TextField = 'endpoint' | 'model'
type DraftSettings = Omit<PublicSettings, 'rules' | 'timeoutMs' | Threshold> &
  Record<Threshold, number | string> & { timeoutSeconds: string }

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
  const [popupContainer, setPopupContainer] = React.useState<HTMLDivElement | null>(null)
  const [settings, setSettings] = React.useState(() => draftSettings(initialFields))
  const [rules, setRules] = React.useState<DraftRule[]>(() => draftRules(storedRules, { current: 1 }))
  const [problems, setProblems] = React.useState(initialConfig.problems)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [results, setResults] = React.useState<TestResult[] | null>(null)
  const [showMissing, setShowMissing] = React.useState(false)
  // The form holds a typed replacement key or a request to remove the stored key.
  const [apiKeyInput, setApiKeyInput] = React.useState('')
  const [clearKey, setClearKey] = React.useState(false)
  const [baseline, setBaseline] = React.useState(() => savedForm(settings, rules, initialFields))
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

  // A running preview can retain a baseline created before the threshold editor was added.
  const savedThresholds = baseline.thresholds ?? initialConfig.settings
  const isDecisions = settings.engine === 'decisions'
  const repairingDecisions = !isDecisions && baseline.needsDecisionsRepair
  const showDecisionsFields = isDecisions || repairingDecisions
  const dirty = formSnapshot(settings, rules, apiKeyInput, clearKey) !== baseline.snapshot
  const validation = validateRules(rules)
  const parsedThresholds = parseThresholds(settings)
  const invalidThresholds = isDecisions ? THRESHOLDS.filter((field) => parsedThresholds[field] === null) : []
  const timeoutMs = parseTimeoutSeconds(settings.timeoutSeconds)
  const invalidFieldNames = [...(timeoutMs === null ? [t('timeout.label')] : []), ...invalidThresholds]
  const timeoutError = showMissing && timeoutMs === null ? t('issue.timeout', TIMEOUT_SECONDS_RANGE) : null
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

  function focusInvalidSetting(event: React.MouseEvent<HTMLButtonElement>) {
    const panel = event.currentTarget.closest('.decision-review-panel')
    const input = panel?.querySelector<HTMLInputElement>(
      'input.decision-review-timeout[aria-invalid=true], input.decision-review-threshold-value[aria-invalid=true]',
    )
    const details = input?.closest('details')
    if (details) details.open = true
    input?.focus()
  }

  async function save() {
    if (saveRequest.current) return
    if (!validation.valid || timeoutMs === null || invalidThresholds.length) {
      setShowMissing(true)
      return
    }
    const startVersion = editVersion.current
    const { hasApiKey, timeoutSeconds, ...fields } = settings
    const { tConf, tHighPred, tMedPred, tStrongPred, tAuth } = parsedThresholds
    const update: SettingsUpdate = {
      ...fields,
      // When following the session, a hidden invalid draft must not replace the last saved value.
      tConf: tConf ?? savedThresholds.tConf,
      tHighPred: tHighPred ?? savedThresholds.tHighPred,
      tMedPred: tMedPred ?? savedThresholds.tMedPred,
      tStrongPred: tStrongPred ?? savedThresholds.tStrongPred,
      tAuth: tAuth ?? savedThresholds.tAuth,
      timeoutMs,
      rules: ruleData(validation.rules),
    }
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
      const { rules: persistedRules, ...persistedFields } = payload.settings
      const savedFields = draftSettings(persistedFields)
      const savedRules = draftRules(persistedRules, nextRuleId, rules)
      setBaseline(savedForm(savedFields, savedRules, persistedFields))
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
      setProblems(payload.problems)
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

  function textInput(field: TextField, label: string, inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']) {
    return (
      <SettingField label={label}>
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode={inputMode}
            value={settings[field]}
            onChange={(event) => setField(field, event.target.value)}
          />
        )}
      </SettingField>
    )
  }

  return (
    <div className="decision-review-panel">
      <div className="decision-review-overlays" ref={setPopupContainer} />
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
            label={t('problems.details')}
            detail={
              <ul style={{ paddingInlineStart: 20, marginBlock: 4 }}>
                {problems.map((issue, i) => (
                  <li key={i}>{settingsIssueText(t, issue, true)}</li>
                ))}
              </ul>
            }
          />
        </div>
      )}

      <ChoiceField<ReviewEngine>
        label={t('engine.label')}
        hint={t('engine.hint')}
        value={settings.engine}
        items={[
          { value: 'decisions', label: t('engine.decisions') },
          { value: 'session', label: t('engine.session') },
        ]}
        onChange={(value) => setField('engine', value)}
      />
      {repairingDecisions && <p style={NOTE}>{t('engine.repair')}</p>}
      {showDecisionsFields && textInput('endpoint', t('endpoint.label'), 'url')}
      {isDecisions && (
        <div>
          <SettingField label={t('apikey.label')} hint={[keyStatus, t('apikey.hint')].filter(Boolean).join(' ')}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                value={apiKeyInput}
                placeholder={settings.hasApiKey && !clearKey ? t('apikey.placeholder') : undefined}
                onChange={(event) => {
                  markEdited()
                  setApiKeyInput(event.target.value)
                }}
                disabled={clearKey}
              />
            )}
          </SettingField>
          {settings.hasApiKey && (
            <Button
              variant={clearKey ? 'outline' : 'destructive'}
              style={{ marginTop: 6 }}
              onClick={() => {
                markEdited()
                setApiKeyInput('')
                setClearKey(!clearKey)
              }}
            >
              {t(clearKey ? 'apikey.clear.undo' : 'apikey.clear')}
            </Button>
          )}
        </div>
      )}
      {showDecisionsFields && textInput('model', t('model.label'))}
      <ChoiceField<DenialRoute>
        label={t('denialroute.label')}
        hint={t('denialroute.hint')}
        value={settings.denialRoute ?? 'ask'}
        items={[
          { value: 'ask', label: t('denialroute.ask') },
          { value: 'final', label: t('denialroute.final') },
        ]}
        onChange={(value) => setField('denialRoute', value)}
      />
      <SettingField label={t('timeout.label')} hint={t('timeout.hint', TIMEOUT_SECONDS_RANGE)} error={timeoutError}>
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode="decimal"
            value={settings.timeoutSeconds}
            onChange={(event) => setField('timeoutSeconds', event.target.value)}
            aria-invalid={timeoutError ? true : undefined}
            className="decision-review-timeout"
          />
        )}
      </SettingField>

      <RulesEditor
        t={t}
        engine={settings.engine}
        popupContainer={popupContainer}
        rules={rules}
        validation={validation}
        showMissing={showMissing}
        lastAddedId={lastAddedId.current}
        onAdd={addRule}
        onChange={changeRule}
        onRemove={removeRule}
      />
      {isDecisions && (
        <ThresholdEditor
          t={t}
          values={settings}
          parsedValues={parsedThresholds}
          savedValues={savedThresholds}
          onChange={setField}
          showErrors={showMissing}
        />
      )}

      <div style={ACTION_BAR}>
        <Button onClick={save} disabled={saving}>
          {t(saving ? 'saving' : 'save')}
        </Button>
        {showMissing && !validation.valid ? (
          <span role="alert" style={ERROR_NOTE}>
            {t('save.invalid')}
          </span>
        ) : null}
        {showMissing && invalidFieldNames.length > 0 ? (
          <span role="alert" style={ERROR_NOTE}>
            <button type="button" className="decision-review-field-error-link" onClick={focusInvalidSetting}>
              {t('save.fieldsInvalid', { fields: invalidFieldNames.join(', ') })}
            </button>
          </span>
        ) : saved && !dirty && validation.valid ? (
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
      {error.issue ? (
        <div>{settingsIssueText(t, error.issue)}</div>
      ) : (
        <TechnicalDetails
          t={t}
          detail={[error.status ? t('error.http', { status: error.status }) : '', error.detail]
            .filter(Boolean)
            .join('\n')}
        />
      )}
    </div>
  )
}

function draftSettings({ timeoutMs, ...fields }: Omit<PublicSettings, 'rules'>): DraftSettings {
  return { ...fields, timeoutSeconds: formatTimeoutSeconds(timeoutMs) }
}

function formSnapshot(fields: DraftSettings, rules: DraftRule[], apiKeyInput: string, clearKey: boolean) {
  return JSON.stringify([fields, ruleData(rules), apiKeyInput, clearKey])
}

function parseThresholds(draft: Record<Threshold, number | string>): Record<Threshold, number | null> {
  const parse = (value: number | string) => {
    const score = numericValue(value)
    return Number.isFinite(score) && score >= 0 && score <= 1 ? score : null
  }
  return {
    tConf: parse(draft.tConf),
    tHighPred: parse(draft.tHighPred),
    tMedPred: parse(draft.tMedPred),
    tStrongPred: parse(draft.tStrongPred),
    tAuth: parse(draft.tAuth),
  }
}

function savedForm(fields: DraftSettings, rules: DraftRule[], thresholds: Record<Threshold, number>) {
  return {
    snapshot: formSnapshot(fields, rules, '', false),
    thresholds: {
      tConf: thresholds.tConf,
      tHighPred: thresholds.tHighPred,
      tMedPred: thresholds.tMedPred,
      tStrongPred: thresholds.tStrongPred,
      tAuth: thresholds.tAuth,
    },
    // The host exposes an invalid stored endpoint or model as an empty field.
    needsDecisionsRepair: fields.endpoint === '' || fields.model === '',
  }
}
