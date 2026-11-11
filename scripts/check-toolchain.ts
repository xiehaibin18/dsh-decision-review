import { execFileSync } from 'node:child_process'

const EXPECTED_VERSION = '1.4.4-canary.1'
const EXPECTED_REVISION = '963452075e9d7e2a47a482f297143af5ed4f76c0'

const bun_version = process.versions.bun
const actual_revision = bun_version
  ? execFileSync(process.execPath, ['--no-env-file', '-p', 'Bun.revision'], { encoding: 'utf8' }).trim()
  : undefined

if (actual_revision !== EXPECTED_REVISION) {
  const actual_toolchain = bun_version ? `Bun ${bun_version} (${actual_revision})` : `Node.js ${process.version}`
  console.error(
    `Expected Bun ${EXPECTED_VERSION} (${EXPECTED_REVISION}). Received ${actual_toolchain}. See README.md for setup.`,
  )
  process.exitCode = 1
}
