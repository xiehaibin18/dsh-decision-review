import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODES = [
  ['isolated', ['--isolate']],
  ['parallel', ['--parallel=2', '--parallel-delay=0']],
]
const STAGES = ['import', 'beforeAll', 'beforeEach', 'body', 'afterEach', 'afterAll']
const BLOCKED_REQUEST = 'Blocked 1 unexpected network request(s)'

for (const [mode, flags] of MODES) {
  describe(`network guard in ${mode} Bun subprocesses`, () => {
    test.each(STAGES)('fails a caught unexpected fetch during %s', (stage) => {
      const result = run_fixture(stage, flags)
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain(BLOCKED_REQUEST)
      expect(result.output).not.toContain('UNGUARDED_TRANSPORT')
      expect(result.output).toMatch(/\(pass\) same-file control/)
      expect(result.output).toMatch(/\(pass\) other-file control/)
      expect(result.remaining_sandboxes).toEqual([])
    })

    test('passes explicit synthetic fetches without leaking state or temporary profiles', () => {
      const result = run_fixture('mock', flags)
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('3 pass')
      expect(result.output).toContain('0 fail')
      expect(result.output).not.toContain(BLOCKED_REQUEST)
      expect(result.output).not.toContain('UNGUARDED_TRANSPORT')
      expect(result.remaining_sandboxes).toEqual([])
    })
  })
}

function run_fixture(stage, flags) {
  const directory = mkdtempSync(join(tmpdir(), 'decision-review-preload-'))
  try {
    copyFileSync(new URL('./preload.js', import.meta.url), join(directory, 'preload.js'))
    writeFileSync(join(directory, 'bunfig.toml'), 'env = false\n[test]\npreload = ["./transport.js", "./preload.js"]\n')
    // A broken guard must never send traffic while its failure is being tested.
    writeFileSync(
      join(directory, 'transport.js'),
      "globalThis.fetch = () => { console.error('UNGUARDED_TRANSPORT'); throw new Error('UNGUARDED_TRANSPORT') }\n",
    )
    writeFileSync(
      join(directory, 'request.js'),
      `let attempted = false
export async function caught_request() {
  if (attempted) return
  attempted = true
  try { await fetch('https://unexpected.example.test') } catch {}
}
`,
    )
    writeFileSync(
      join(directory, 'initialize.js'),
      "import { caught_request } from './request.js'; await caught_request()\n",
    )
    const setup =
      stage === 'import'
        ? "import './initialize.js'"
        : STAGES.includes(stage) && stage !== 'body'
          ? `${stage}(caught_request)`
          : ''
    const body =
      stage === 'body'
        ? 'await caught_request()'
        : stage === 'mock'
          ? `
const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ synthetic: true }))
try {
  expect(await (await fetch('https://synthetic.example.test')).json()).toEqual({ synthetic: true })
  expect(request).toHaveBeenCalledTimes(1)
} finally { request.mockRestore() }
`
          : ''
    writeFileSync(
      join(directory, 'a.test.js'),
      `import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { caught_request } from './request.js'
${setup}
test('fixture trigger', async () => { ${body} })
test('same-file control', () => {})
`,
    )
    writeFileSync(
      join(directory, 'b.test.js'),
      "import { test } from 'bun:test'; test('other-file control', () => {})\n",
    )
    const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', 'test', ...flags], {
      cwd: directory,
      env: { HOME: directory, TMPDIR: directory, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 3000,
    })
    return {
      error: result.error,
      signal: result.signal,
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      remaining_sandboxes: readdirSync(directory).filter((name) => name.startsWith('decision-review-environment-')),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
