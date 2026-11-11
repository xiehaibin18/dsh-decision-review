import type { CSSProperties } from 'react'

export const BORDER = 'var(--dsw-alias-border-l4, #8885)'
export const MUTED = 'var(--dsw-alias-label-secondary, GrayText)'
export const DANGER = 'var(--dsw-alias-state-error-primary, #d13d37)'
const RADIUS = 'var(--dsw-radius-md, 8px)'
export const INPUT: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  border: '1px solid ' + BORDER,
  borderRadius: RADIUS,
  font: 'inherit',
  background: 'var(--dsw-alias-bg-layer-3, transparent)',
  color: 'inherit',
}
export const BUTTON: CSSProperties = {
  padding: '6px 12px',
  borderRadius: RADIUS,
  border: '1px solid ' + BORDER,
  background: 'var(--dsw-alias-bg-layer-3, transparent)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
}
export const PRIMARY_BUTTON: CSSProperties = {
  ...BUTTON,
  background: 'var(--dsw-alias-state-business-primary, #365cda)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  borderColor: 'transparent',
  fontWeight: 600,
}
export const ROW: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
export const STACK: CSSProperties = { display: 'grid', gap: 12, minWidth: 0 }
export const HEADING: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4 }
export const NOTE: CSSProperties = { margin: 0, fontSize: 12, color: MUTED, overflowWrap: 'anywhere' }
export const ERROR_NOTE: CSSProperties = { ...NOTE, color: DANGER }
export const CARD: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
  padding: 12,
  border: '1px solid ' + BORDER,
  borderRadius: RADIUS,
}
export const ACTION_BAR: CSSProperties = { ...ROW, borderTop: '1px solid ' + BORDER, paddingTop: 14 }
