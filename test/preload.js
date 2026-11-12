import { afterAll, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// This runs before imports. Even a missing fixture cannot fall back to a user's profile.
const sandbox = mkdtempSync(join(tmpdir(), 'decision-review-environment-'))
const saved_environment = { HOME: process.env.HOME, DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR }
process.env.HOME = sandbox
process.env.DSH_PROFILE_DIR = join(sandbox, 'profile')

const original_fetch = globalThis.fetch
let unexpected_requests = 0
function deny_network() {
  unexpected_requests++
  throw new Error('Unexpected network request: install an explicit synthetic fetch mock')
}

globalThis.fetch = deny_network
beforeEach(() => {
  globalThis.fetch = deny_network
})

function check_network_requests() {
  // Consume only checked requests, including ones caught during imports or setup.
  const pending_requests = unexpected_requests
  unexpected_requests = 0
  if (pending_requests !== 0) throw new Error(`Blocked ${pending_requests} unexpected network request(s)`)
}

afterEach(check_network_requests)

afterAll(() => {
  try {
    // The pinned Bun runs preload teardown after the file's own teardown hooks.
    check_network_requests()
  } finally {
    globalThis.fetch = original_fetch
    for (const [key, value] of Object.entries(saved_environment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(sandbox, { recursive: true, force: true })
  }
})
