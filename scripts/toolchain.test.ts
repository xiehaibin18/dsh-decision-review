import { describe, expect, test } from 'bun:test'
import {
  assertSupportedBun,
  compareSemver,
  detectCurrentBun,
  formatToolchainError,
  isSupportedBunVersion,
  MIN_BUN_VERSION,
  normalizeBunVersion,
} from './toolchain.js'

describe('Bun toolchain minimum version check', () => {
  test('normalizes Bun version strings from version_with_sha, --revision, and bare labels', () => {
    expect(normalizeBunVersion('v1.4.4-canary.1 (963452075)')).toBe('1.4.4-canary.1')
    expect(normalizeBunVersion('1.4.5-canary.1+4ce14ba8b')).toBe('1.4.5-canary.1')
    expect(normalizeBunVersion('1.4.5')).toBe('1.4.5')
    expect(normalizeBunVersion('not-a-version')).toBeNull()
  })

  test('accepts versions at or above the minimum Bun version, including newer canaries and releases', () => {
    for (const version of [
      '1.4.4-canary.1',
      'v1.4.4-canary.1 (963452075)',
      '1.4.4-canary.1+963452075',
      '1.4.4-canary.2',
      '1.4.4-canary.10',
      '1.4.4',
      '1.4.5-canary.1',
      'v1.4.5-canary.1 (4ce14ba8b)',
      '1.4.5-canary.1+4ce14ba8b',
      '1.4.5',
      '1.5.0-canary.1',
      '2.0.0',
    ]) {
      expect(isSupportedBunVersion(version)).toBe(true)
    }
  })

  test('rejects versions below the minimum Bun version and malformed inputs', () => {
    for (const version of [
      '1.3.10',
      '1.4.3',
      '1.4.3-canary.20261021.1',
      '1.4.4-alpha.1',
      '1.4.4-canary.0',
      '1.4.4-canary.0+abcdef',
      '',
      'invalid',
    ]) {
      expect(isSupportedBunVersion(version)).toBe(false)
    }
  })

  test('orders prerelease numeric identifiers numerically rather than lexically', () => {
    expect(compareSemver('1.4.4-canary.10', '1.4.4-canary.2')).toBeGreaterThan(0)
    expect(compareSemver('1.4.4', '1.4.4-canary.99')).toBeGreaterThan(0)
  })

  test('accepts the active Bun runtime and reports a clear error for unsupported runtimes', () => {
    const active = detectCurrentBun()
    expect(active).not.toBeNull()
    expect(assertSupportedBun(active)).toEqual(active!)
    expect(() => assertSupportedBun(null)).toThrow(`Expected Bun >=${MIN_BUN_VERSION}. Received Node.js`)
    expect(() => assertSupportedBun({ version: '1.4.3', revision: 'deadbeef' })).toThrow(
      formatToolchainError({ version: '1.4.3', revision: 'deadbeef' }),
    )
  })
})
