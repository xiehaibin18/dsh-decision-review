/** @jsxRuntime classic */
import * as React from 'react'
import {
  RULE_MAX_CONDITION,
  RULE_MAX_COUNT,
  RULE_MAX_TOTAL,
  RULE_VERDICTS,
  type ReviewEngine,
} from '../shared/contracts.js'
import type { Translate } from './messages.js'
import { conditionProblem, isRuleVerdict, type DraftRule, type RuleChanges, type validateRules } from './rules.js'

interface RuleEditorProps {
  t: Translate
  rule: DraftRule
  index: number
  onChange: (changes: RuleChanges) => void
  onRemove: () => void
  showMissing: boolean
  autoFocus: boolean
  conditionRef: React.Ref<HTMLTextAreaElement>
  baseId: string
}

function RuleEditor({
  t,
  rule,
  index,
  onChange,
  onRemove,
  showMissing,
  autoFocus,
  conditionRef,
  baseId,
}: RuleEditorProps) {
  const n = index + 1
  const headingId = baseId + '-heading'
  const lengthId = baseId + '-length'
  const conditionErrorId = baseId + '-condition-error'
  const verdictErrorId = baseId + '-verdict-error'
  const problem = conditionProblem(rule.condition)
  const conditionError = problem !== 'rules.error.required' || showMissing ? problem : null
  const verdictInvalid = !isRuleVerdict(rule.verdict)

  return (
    <section aria-labelledby={headingId} className="decision-review-rule">
      <div className="decision-review-rule-header">
        <h3 id={headingId}>{t('rules.item', { n })}</h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('rules.remove.named', { n })}
          className="decision-review-rules-button decision-review-rule-remove"
        >
          {t('rules.remove')}
        </button>
      </div>
      <div className="decision-review-rule-field">
        <label className="decision-review-rule-label">
          <span>{t('rules.verdict.label')}</span>
          <select
            value={verdictInvalid ? '' : rule.verdict}
            onChange={(event) => onChange({ verdict: event.target.value })}
            aria-invalid={verdictInvalid || undefined}
            aria-describedby={verdictInvalid ? verdictErrorId : undefined}
            className="decision-review-rule-input decision-review-rule-verdict"
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
        </label>
        {verdictInvalid && (
          <p id={verdictErrorId} className="decision-review-rules-note" data-error>
            {t('rules.error.verdict')}
          </p>
        )}
      </div>
      <div className="decision-review-rule-field">
        <label className="decision-review-rule-label">
          <span>{t('rules.condition.label')}</span>
          <textarea
            ref={conditionRef}
            value={rule.condition}
            onChange={(event) => onChange({ condition: event.target.value })}
            placeholder={t('rules.condition.placeholder')}
            rows={4}
            autoFocus={autoFocus}
            aria-required
            aria-invalid={conditionError ? true : undefined}
            aria-describedby={conditionError ? conditionErrorId + ' ' + lengthId : lengthId}
            className="decision-review-rule-input decision-review-rule-condition"
          />
        </label>
        <div className="decision-review-rule-details">
          {conditionError && (
            <span id={conditionErrorId} className="decision-review-rules-note" data-error>
              {t(conditionError, { max: RULE_MAX_CONDITION })}
            </span>
          )}
          <span
            id={lengthId}
            className="decision-review-rules-note decision-review-rule-count"
            data-error={problem === 'rules.error.long' || undefined}
          >
            {t('rules.condition.length', { count: rule.condition.length, max: RULE_MAX_CONDITION })}
          </span>
        </div>
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
  const addButton = React.useRef<HTMLButtonElement>(null)
  const conditions = React.useRef(new Map<number, HTMLTextAreaElement>())
  const atCountLimit = rules.length >= RULE_MAX_COUNT
  const { total, countInvalid, totalInvalid } = validation

  function removeRule(id: number, index: number) {
    const adjacent = rules[index + 1] ?? rules[index - 1]
    const target = adjacent ? conditions.current.get(adjacent.id) : addButton.current
    onRemove(id)
    target?.focus()
  }

  return (
    <section aria-labelledby={sectionId} className="decision-review-rules">
      <header className="decision-review-rules-intro">
        <div className="decision-review-rules-heading">
          <h2 id={sectionId}>{t('rules.title')}</h2>
          <p
            className="decision-review-rules-note decision-review-rules-summary"
            data-error={countInvalid || totalInvalid || undefined}
          >
            {t('rules.summary', { count: rules.length, maxCount: RULE_MAX_COUNT, total, maxTotal: RULE_MAX_TOTAL })}
          </p>
        </div>
        <p>{t('rules.hint')}</p>
        <p className="decision-review-rules-note">{t(`rules.engine.${engine}`)}</p>
      </header>
      {countInvalid && (
        <p className="decision-review-rules-note" data-error>
          {t('rules.error.count', { max: RULE_MAX_COUNT })}
        </p>
      )}
      {totalInvalid && (
        <p className="decision-review-rules-note" data-error>
          {t('rules.error.total', { max: RULE_MAX_TOTAL })}
        </p>
      )}
      <div className="decision-review-rules-body" data-empty={rules.length === 0 || undefined}>
        {rules.length === 0 ? (
          <div className="decision-review-rules-intro">
            <h3>{t('rules.empty.title')}</h3>
            <p className="decision-review-rules-note">{t('rules.empty.desc')}</p>
          </div>
        ) : (
          <ol className="decision-review-rules-list" role="list">
            {rules.map((rule, index) => (
              <li key={rule.id}>
                <RuleEditor
                  baseId={sectionId + '-rule-' + rule.id}
                  t={t}
                  rule={rule}
                  index={index}
                  showMissing={showMissing}
                  autoFocus={rule.id === lastAddedId}
                  conditionRef={(control) => {
                    if (control) conditions.current.set(rule.id, control)
                    else conditions.current.delete(rule.id)
                  }}
                  onChange={(changes) => onChange(rule.id, changes)}
                  onRemove={() => removeRule(rule.id, index)}
                />
              </li>
            ))}
          </ol>
        )}
        <button
          ref={addButton}
          type="button"
          disabled={atCountLimit}
          className="decision-review-rules-button decision-review-rules-add"
          onClick={onAdd}
        >
          <span aria-hidden>+ </span>
          {t('rules.add')}
        </button>
      </div>
    </section>
  )
}
