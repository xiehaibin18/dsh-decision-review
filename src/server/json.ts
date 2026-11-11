export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function json(value: unknown): string {
  const rendered = JSON.stringify(value, null, 2)
  if (rendered === undefined) throw new Error('decision-review: a required value is not JSON-serializable')
  return rendered
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}
