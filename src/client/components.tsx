/** @jsxRuntime classic */
import * as React from 'react'
import type { Translate } from './messages.js'
import { NOTE } from './styles.js'
import { Field, FieldDescription, FieldLabel } from './ui/field.js'

export function SettingField({
  label,
  children,
  hint,
  error,
}: {
  label: string
  children: (control: { id: string; 'aria-describedby'?: string }) => React.ReactNode
  hint?: string | null
  error?: string | null
}) {
  const id = React.useId()
  const hintId = id + '-hint'
  const errorId = id + '-error'
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, 'aria-describedby': describedBy })}
      {hint && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      {error && (
        <p role="alert" id={errorId} className="decision-review-field-error">
          {error}
        </p>
      )}
    </Field>
  )
}

export function TechnicalDetails({
  t,
  detail,
  label = t('error.details'),
}: {
  t: Translate
  detail?: React.ReactNode
  label?: string
}) {
  if (!detail) return null
  return (
    <details style={{ ...NOTE, marginTop: 4 }}>
      <summary style={{ cursor: 'pointer' }}>{label}</summary>
      <div style={{ whiteSpace: 'pre-wrap' }}>{detail}</div>
    </details>
  )
}
