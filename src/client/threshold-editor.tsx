/** @jsxRuntime classic */
import * as React from 'react'
import { THRESHOLDS, THRESHOLD_DEFAULTS, type Threshold } from '../shared/contracts.js'
import type { Translate } from './messages.js'
import { Input } from './ui/input.js'
import { Slider } from './ui/slider.js'

interface ThresholdEditorProps {
  t: Translate
  values: Record<Threshold, number | string>
  parsedValues: Record<Threshold, number | null>
  savedValues: Record<Threshold, number>
  onChange: (field: Threshold, value: number | string) => void
  showErrors: boolean
}

export function ThresholdEditor({ t, values, parsedValues, savedValues, onChange, showErrors }: ThresholdEditorProps) {
  const hintId = React.useId()
  return (
    <details className="decision-review-thresholds">
      <summary>{t('thresholds.title')}</summary>
      <p id={hintId} className="decision-review-field-description">
        {t('thresholds.hint')}
      </p>
      <div className="decision-review-thresholds-list">
        {THRESHOLDS.map((field) => (
          <ThresholdField
            key={field}
            t={t}
            field={field}
            value={values[field]}
            score={parsedValues[field] ?? savedValues[field]}
            invalid={showErrors && parsedValues[field] === null}
            defaultValue={THRESHOLD_DEFAULTS[field]}
            savedValue={savedValues[field]}
            hintId={hintId}
            onChange={(value) => onChange(field, value)}
          />
        ))}
      </div>
    </details>
  )
}

function ThresholdField({
  t,
  field,
  value,
  score,
  invalid,
  defaultValue,
  savedValue,
  hintId,
  onChange,
}: {
  t: Translate
  field: Threshold
  value: number | string
  score: number
  invalid: boolean
  defaultValue: number
  savedValue: number
  hintId: string
  onChange: (value: number | string) => void
}) {
  const id = React.useId()
  const defaultId = id + '-default'
  const savedId = id + '-saved'
  const errorId = id + '-error'
  const same = defaultValue === savedValue

  return (
    <div className="decision-review-threshold">
      <div className="decision-review-threshold-title">
        <span id={id}>{t(`thresholds.${field}`)}</span>
        <Input
          type="text"
          inputMode="decimal"
          className="decision-review-threshold-value"
          aria-label={t('thresholds.exact', { field })}
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      {invalid && (
        <p id={errorId} className="decision-review-field-error">
          {t('thresholds.invalid')}
        </p>
      )}
      <div className="decision-review-threshold-rail">
        <ThresholdFlag
          id={defaultId}
          kind={same ? 'both' : 'default'}
          value={defaultValue}
          text={t(same ? 'thresholds.same' : 'thresholds.default', { value: defaultValue })}
        />
        <Slider
          min={0}
          max={1}
          step={0.01}
          largeStep={0.1}
          value={score}
          aria-labelledby={id}
          aria-describedby={`${hintId} ${defaultId}${same ? '' : ' ' + savedId}`}
          getAriaValueText={(_formatted, score) => String(score)}
          onValueChange={onChange}
        />
        {!same && (
          <ThresholdFlag
            id={savedId}
            kind="saved"
            value={savedValue}
            text={t('thresholds.saved', { value: savedValue })}
          />
        )}
        <div className="decision-review-threshold-range" aria-hidden="true">
          <span>0</span>
          <span>1</span>
        </div>
      </div>
    </div>
  )
}

function ThresholdFlag({
  id,
  kind,
  value,
  text,
}: {
  id: string
  kind: 'default' | 'saved' | 'both'
  value: number
  text: string
}) {
  const position = `${value * 100}%`
  return (
    <div className="decision-review-threshold-flag" data-flag={kind}>
      <span className="decision-review-threshold-flag-stem" style={{ left: position }} />
      <span
        id={id}
        className="decision-review-threshold-flag-label"
        style={{ left: position, transform: `translateX(-${position})` }}
      >
        {text}
      </span>
    </div>
  )
}
