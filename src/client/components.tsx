/** @jsxRuntime classic */
import * as React from 'react'
import type { Translate } from './messages.js'
import { NOTE } from './styles.js'

export function Field({ label, children, hint }: { label: string; children?: React.ReactNode; hint?: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>{label}</span>
        {children}
      </label>
      {hint && <div style={{ ...NOTE, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function TechnicalDetails({ t, detail }: { t: Translate; detail?: React.ReactNode }) {
  if (!detail) return null
  return (
    <details style={{ ...NOTE, marginTop: 4 }}>
      <summary style={{ cursor: 'pointer' }}>{t('error.details')}</summary>
      <div style={{ whiteSpace: 'pre-wrap' }}>{detail}</div>
    </details>
  )
}
