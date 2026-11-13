const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

// Reject implicit coercion of booleans, arrays and objects at settings boundaries.
export function numericValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && DECIMAL_NUMBER.test(value.trim())) return Number(value)
  return Number.NaN
}
