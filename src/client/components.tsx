/** @jsxRuntime classic */
import * as React from 'react'
import type { Translate } from './messages.js'
import { NOTE } from './styles.js'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactElement<Pick<React.AriaAttributes, 'aria-describedby'>>
  hint?: string | null
}) {
  const hintId = React.useId()
  return (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>{label}</span>
        {hint ? React.cloneElement(children, { 'aria-describedby': hintId }) : children}
      </label>
      {hint && (
        <div id={hintId} style={{ ...NOTE, marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
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
