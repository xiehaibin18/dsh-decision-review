/** @jsxRuntime classic */
import * as React from 'react'
import {
  RULE_MAX_CONDITION,
  RULE_MAX_COUNT,
  RULE_MAX_TOTAL,
  RULE_VERDICTS,
  type ReviewEngine,
} from '../shared/contracts.js'
import { Field } from './components.js'
import type { Translate } from './messages.js'
import { conditionProblem, isRuleVerdict, type DraftRule, type RuleChanges, type validateRules } from './rules.js'
import { BORDER, BUTTON, CARD, DANGER, ERROR_NOTE, HEADING, INPUT, NOTE, ROW, STACK, buttonStyle } from './styles.js'

interface RuleEditorProps {
  t: Translate
  rule: DraftRule
  index: number
  onChange: (changes: RuleChanges) => void
  onRemove: () => void
  showMissing: boolean
  autoFocus: boolean
  baseId: string
}

function RuleEditor({ t, rule, index, onChange, onRemove, showMissing, autoFocus, baseId }: RuleEditorProps) {
  const n = index + 1
  const headingId = baseId + '-heading'
  const lengthId = baseId + '-length'
  const conditionErrorId = baseId + '-condition-error'
  const verdictErrorId = baseId + '-verdict-error'
  const problem = conditionProblem(rule.condition)
  const conditionError = problem !== 'rules.error.required' || showMissing ? problem : null
  const verdictInvalid = !isRuleVerdict(rule.verdict)

  return (
    <section aria-labelledby={headingId} style={CARD}>
      <div style={{ ...ROW, justifyContent: 'space-between' }}>
        <h3 id={headingId} style={{ ...HEADING, fontSize: 13 }}>
          {t('rules.item', { n })}
        </h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('rules.remove.named', { n })}
          style={{ ...BUTTON, padding: '4px 9px', background: 'transparent' }}
        >
          {t('rules.remove')}
        </button>
      </div>
      <Field label={t('rules.verdict.label')}>
        <select
          value={verdictInvalid ? '' : rule.verdict}
          onChange={(event) => onChange({ verdict: event.target.value })}
          aria-invalid={verdictInvalid || undefined}
          aria-describedby={verdictInvalid ? verdictErrorId : undefined}
          style={INPUT}
        >
          {verdictInvalid && (
            <option value="" disabled>
              {t('rules.error.verdict')}
            </option>
          )}
          {RULE_VERDICTS.map((verdict) => (
            <option value={verdict} key={verdict}>
              {t(`rules.verdict.${verdict}`)}
            </option>
          ))}
        </select>
      </Field>
      {verdictInvalid && (
        <div id={verdictErrorId} style={ERROR_NOTE}>
          {t('rules.error.verdict')}
        </div>
      )}
      <Field label={t('rules.condition.label')}>
        <textarea
          value={rule.condition}
          onChange={(event) => onChange({ condition: event.target.value })}
          placeholder={t('rules.condition.placeholder')}
          rows={3}
          autoFocus={autoFocus}
          aria-required
          aria-invalid={conditionError ? true : undefined}
          aria-describedby={lengthId + (conditionError ? ' ' + conditionErrorId : '')}
          style={{ ...INPUT, resize: 'vertical', borderColor: conditionError ? DANGER : BORDER }}
        />
      </Field>
      <div style={{ ...ROW, justifyContent: 'space-between', alignItems: 'baseline', marginTop: -4 }}>
        {conditionError && (
          <span id={conditionErrorId} style={ERROR_NOTE}>
            {t(conditionError, { max: RULE_MAX_CONDITION })}
          </span>
        )}
        <span
          id={lengthId}
          style={{ ...(problem === 'rules.error.long' ? ERROR_NOTE : NOTE), marginInlineStart: 'auto' }}
        >
          {t('rules.condition.length', { count: rule.condition.length, max: RULE_MAX_CONDITION })}
        </span>
      </div>
    </section>
  )
}

interface RulesEditorProps {
  t: Translate
  engine: ReviewEngine
  rules: DraftRule[]
  validation: ReturnType<typeof validateRules>
  onAdd: () => void
  onChange: (id: number, changes: RuleChanges) => void
  onRemove: (id: number) => void
  showMissing: boolean
  lastAddedId: number | null
}

export function RulesEditor({
  t,
  engine,
  rules,
  validation,
  onAdd,
  onChange,
  onRemove,
  showMissing,
  lastAddedId,
}: RulesEditorProps) {
  const sectionId = React.useId()
  const atCountLimit = rules.length >= RULE_MAX_COUNT
  const { total, countInvalid, totalInvalid } = validation
  const add = (
    <button type="button" disabled={atCountLimit} style={buttonStyle(atCountLimit)} onClick={onAdd}>
      <span aria-hidden>+ </span>
      {t('rules.add')}
    </button>
  )

  return (
    <section aria-labelledby={sectionId} style={{ ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 }}>
      <div style={{ display: 'grid', gap: 5 }}>
        <h2 id={sectionId} style={HEADING}>
          {t('rules.title')}
        </h2>
        <p style={NOTE}>{t('rules.hint')}</p>
        <p style={NOTE}>{t(`rules.engine.${engine}`)}</p>
      </div>
      <p style={countInvalid || totalInvalid ? ERROR_NOTE : NOTE}>
        {t('rules.summary', { count: rules.length, maxCount: RULE_MAX_COUNT, total, maxTotal: RULE_MAX_TOTAL })}
      </p>
      {countInvalid && <div style={ERROR_NOTE}>{t('rules.error.count', { max: RULE_MAX_COUNT })}</div>}
      {totalInvalid && <div style={ERROR_NOTE}>{t('rules.error.total', { max: RULE_MAX_TOTAL })}</div>}
      {rules.length === 0 ? (
        <div style={{ ...CARD, borderStyle: 'dashed', padding: 16 }}>
          <div style={{ fontWeight: 600 }}>{t('rules.empty.title')}</div>
          <p style={NOTE}>{t('rules.empty.desc')}</p>
          <div style={ROW}>{add}</div>
        </div>
      ) : (
        <>
          {rules.map((rule, index) => (
            <RuleEditor
              key={rule.id}
              baseId={sectionId + '-rule-' + rule.id}
              t={t}
              rule={rule}
              index={index}
              showMissing={showMissing}
              autoFocus={rule.id === lastAddedId}
              onChange={(changes) => onChange(rule.id, changes)}
              onRemove={() => onRemove(rule.id)}
            />
          ))}
          <div style={ROW}>{add}</div>
        </>
      )}
    </section>
  )
}
