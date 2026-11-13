/** @jsxRuntime classic */
import * as React from 'react'
import { THRESHOLDS, THRESHOLD_DEFAULTS, type Threshold } from '../shared/contracts.js'
import type { Translate } from './messages.js'
import { Slider } from './ui/slider.js'

interface ThresholdEditorProps {
  t: Translate
  values: Record<Threshold, number>
  savedValues: Record<Threshold, number>
  onChange: (field: Threshold, value: number) => void
}

export function ThresholdEditor({ t, values, savedValues, onChange }: ThresholdEditorProps) {
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
  defaultValue,
  savedValue,
  hintId,
  onChange,
}: {
  t: Translate
  field: Threshold
  value: number
  defaultValue: number
  savedValue: number
  hintId: string
  onChange: (value: number) => void
}) {
  const id = React.useId()
  const defaultId = id + '-default'
  const savedId = id + '-saved'
  const same = defaultValue === savedValue

  return (
    <div className="decision-review-threshold">
      <div className="decision-review-threshold-title">
        <span id={id}>{t(`thresholds.${field}`)}</span>
        <span className="decision-review-threshold-value" aria-hidden="true" title={String(value)}>
          {value}
        </span>
      </div>
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
          value={value}
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
