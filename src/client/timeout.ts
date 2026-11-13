import { TIMEOUT_MAX_MS, TIMEOUT_MIN_MS } from '../shared/contracts.js'

const MS_PER_SECOND = 1000

export const TIMEOUT_SECONDS_RANGE = { min: TIMEOUT_MIN_MS / MS_PER_SECOND, max: TIMEOUT_MAX_MS / MS_PER_SECOND }

export function formatTimeoutSeconds(timeoutMs: number): string {
  return String(timeoutMs / MS_PER_SECOND)
}

export function parseTimeoutSeconds(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (!match) return null
  const [, seconds, fraction = ''] = match
  // Parse the decimal digits as integers so stored milliseconds survive the round trip.
  const timeoutMs = Number(seconds) * MS_PER_SECOND + Number(fraction.padEnd(3, '0'))
  return timeoutMs >= TIMEOUT_MIN_MS && timeoutMs <= TIMEOUT_MAX_MS ? timeoutMs : null
}
