import { detectCurrentBun, formatToolchainError, isSupportedBunVersion, MIN_BUN_VERSION } from './toolchain.js'

const actual = detectCurrentBun()
if (!actual || !isSupportedBunVersion(actual.version, MIN_BUN_VERSION)) {
  console.error(formatToolchainError(actual, MIN_BUN_VERSION))
  process.exitCode = 1
}
