import { execFileSync } from 'node:child_process'

export const MIN_BUN_VERSION = '1.4.4-canary.1'

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: readonly (number | string)[]
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Extract a semver string from `Bun.version_with_sha`, `bun --revision`, or a bare version label. */
export function normalizeBunVersion(raw: string): string | null {
  const token = raw.trim().split(/\s+/, 1)[0] ?? ''
  const match = SEMVER_RE.exec(token)
  if (!match) return null
  const [, major, minor, patch, pre] = match
  return pre ? `${major}.${minor}.${patch}-${pre}` : `${major}.${minor}.${patch}`
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = normalizeBunVersion(version)
  if (!normalized) return null
  const match = SEMVER_RE.exec(normalized)
  if (!match) return null
  const [, major, minor, patch, pre] = match
  const prerelease = pre ? pre.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : []
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease }
}

/** SemVer 2.0.0 precedence comparison; returns negative if a < b, 0 if equal, positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) throw new TypeError(`Invalid semver comparison: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  const leftPre = left.prerelease
  const rightPre = right.prerelease
  if (leftPre.length === 0 && rightPre.length === 0) return 0
  if (leftPre.length === 0) return 1
  if (rightPre.length === 0) return -1
  const len = Math.max(leftPre.length, rightPre.length)
  for (let i = 0; i < len; i += 1) {
    const l = leftPre[i]
    const r = rightPre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    if (typeof l === 'number' && typeof r === 'number') return l - r
    if (typeof l === 'number') return -1
    if (typeof r === 'number') return 1
    return l < r ? -1 : 1
  }
  return 0
}

export function isSupportedBunVersion(raw: string, minVersion = MIN_BUN_VERSION): boolean {
  const normalized = normalizeBunVersion(raw)
  return normalized !== null && compareSemver(normalized, minVersion) >= 0
}

export interface BunRuntimeInfo {
  version: string
  revision?: string
}

/** Read the active Bun semver (preserving `-canary.N` labels) and commit SHA when running under Bun. */
export function detectCurrentBun(): BunRuntimeInfo | null {
  if (!process.versions.bun) return null
  const bunGlobal = typeof Bun === 'undefined' ? undefined : Bun
  const rawVersion =
    bunGlobal?.version_with_sha ?? execFileSync(process.execPath, ['--revision'], { encoding: 'utf8' }).trim()
  const version = normalizeBunVersion(rawVersion) ?? process.versions.bun
  const revision =
    bunGlobal?.revision ??
    execFileSync(process.execPath, ['--no-env-file', '-p', 'Bun.revision'], { encoding: 'utf8' }).trim()
  return { version, revision }
}

export function formatToolchainError(actual: BunRuntimeInfo | null, minVersion = MIN_BUN_VERSION): string {
  const actualLabel = actual
    ? `Bun ${actual.version}${actual.revision ? ` (${actual.revision})` : ''}`
    : `Node.js ${process.version}`
  return `Expected Bun >=${minVersion}. Received ${actualLabel}. See README.md for setup.`
}

export function assertSupportedBun(
  actual: BunRuntimeInfo | null = detectCurrentBun(),
  minVersion = MIN_BUN_VERSION,
): BunRuntimeInfo {
  if (!actual || !isSupportedBunVersion(actual.version, minVersion)) {
    throw new Error(formatToolchainError(actual, minVersion))
  }
  return actual
}
