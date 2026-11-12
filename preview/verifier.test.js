import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE_NAMES = ['panel.tsx', 'styles.css', 'index.html']
const ORIGINAL = 'original\n'
const CHANGED = 'probe\n'
const EDITOR_SAVE = 'probe\neditor save\n'

test.each(['navigate', 'constructor'])(
  'host %s failure replaces stale success and retains the primary error',
  (stage) => {
    const directory = mkdtempSync(join(tmpdir(), 'decision-review-host-failure-'))
    const verifier = new URL('../scripts/verify-rules-host.mjs', import.meta.url).pathname
    const evidence = 'artifacts/ui-evaluation/host/acceptance.json'
    try {
      writeFileSync(
        join(directory, 'run.mjs'),
        `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
mkdirSync('artifacts/ui-evaluation/host', { recursive: true })
writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({status:'passed', from:'previous run'}))
const Bun = { stdin: globalThis.Bun.stdin, write: globalThis.Bun.write, WebView: class {
  constructor() { if (${JSON.stringify(stage)} === 'constructor') throw new Error('PRIMARY_STARTUP_FAILURE') }
  async navigate() { throw new Error('PRIMARY_STARTUP_FAILURE') }
  async screenshot() {
    writeFileSync('before-screenshot.json', readFileSync(${JSON.stringify(evidence)}))
    throw new Error('SECONDARY_SCREENSHOT_FAILURE')
  }
  async close() {
    writeFileSync('closed', '')
    throw new Error('SECONDARY_CLOSE_FAILURE')
  }
} }
` + readFileSync(verifier, 'utf8'),
      )
      const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', 'run.mjs'], {
        cwd: directory,
        env: { HOME: directory, TMPDIR: directory, NO_COLOR: '1' },
        input: JSON.stringify({ url: 'http://127.0.0.1:1', cookie: 'synthetic=fixture' }),
        encoding: 'utf8',
        timeout: 3000,
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(1)
      const recorded = JSON.parse(readFileSync(join(directory, evidence), 'utf8'))
      expect(recorded.status, result.stderr).toBe('failed')
      expect(recorded.message).toBe('Error: PRIMARY_STARTUP_FAILURE')
      expect(recorded.from).toBeUndefined()
      expect(result.stderr.trim()).toMatch(/error: PRIMARY_STARTUP_FAILURE[\s\S]*Bun v/)
      if (stage === 'navigate') {
        expect(JSON.parse(readFileSync(join(directory, 'before-screenshot.json'), 'utf8'))).toEqual(recorded)
        expect(readFileSync(join(directory, 'closed'), 'utf8')).toBe('')
        expect(result.stderr).toContain('Cannot capture host failure screenshot:')
        expect(result.stderr).toContain('Cannot close host browser after failure:')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('HMR source changes restore all original bytes on success', () => {
  const result = runFixture('clean')
  expect(result.status, result.output).toBe(0)
  expect(result.files).toEqual([ORIGINAL, ORIGINAL, ORIGINAL])
})

test('normal restoration preserves both editor saves and fails with both file paths', () => {
  const result = runFixture('normal-conflicts')
  expectFailure(result, ['panel.tsx', 'styles.css'])
  expect(result.files).toEqual([EDITOR_SAVE, EDITOR_SAVE, ORIGINAL])
})

test('a first-file conflict still restores the other owned sources', () => {
  const result = runFixture('one-conflict')
  expectFailure(result, ['panel.tsx'])
  expect(result.files).toEqual([EDITOR_SAVE, ORIGINAL, ORIGINAL])
})

test('validation failure retains its diagnosis and editor bytes while restoring the other files', () => {
  const result = runFixture('validation-failure')
  expectFailure(result, ['panel.tsx', 'INJECTED_VALIDATION_FAILURE'])
  expect(result.files).toEqual([EDITOR_SAVE, ORIGINAL, ORIGINAL])
})

test('HTML edits made before final cleanup are preserved and fail validation', () => {
  const result = runFixture('html-conflict')
  expectFailure(result, ['index.html'])
  expect(result.files).toEqual([ORIGINAL, ORIGINAL, EDITOR_SAVE])
})

test('an edit before applying the next probe cannot be overwritten', () => {
  const result = runFixture('before-apply')
  expectFailure(result, ['styles.css'])
  expect(result.files).toEqual([ORIGINAL, EDITOR_SAVE, ORIGINAL])
})

test('an unreadable restore target does not stop cleanup of the remaining files', () => {
  const result = runFixture('restore-error')
  expectFailure(result, ['panel.tsx', 'EISDIR'])
  expect(result.files).toEqual([null, ORIGINAL, ORIGINAL])
})

function expectFailure(result, diagnostics) {
  expect(result.status, result.output).toBe(1)
  for (const diagnostic of diagnostics) expect(result.output).toContain(diagnostic)
}

function runFixture(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'decision-review-hmr-edits-'))
  const helper = new URL('../scripts/preview-source-edits.mjs', import.meta.url).href
  try {
    for (const name of SOURCE_NAMES) writeFileSync(join(directory, name), ORIGINAL)
    writeFileSync(
      join(directory, 'run.mjs'),
      `import { mkdir, rm, writeFile } from 'node:fs/promises'
import { withHmrEdits } from ${JSON.stringify(helper)}
const mode = process.argv[2]
const names = ${JSON.stringify(SOURCE_NAMES)}
const editorSave = ${JSON.stringify(EDITOR_SAVE)}
await withHmrEdits(names.map(path => ({ path, transform: () => ${JSON.stringify(CHANGED)} })), async ({ apply, restore }) => {
  await apply(names[0])
  if (mode === 'before-apply') await writeFile(names[1], editorSave)
  await apply(names[1])
  if (['normal-conflicts', 'one-conflict', 'validation-failure'].includes(mode)) await writeFile(names[0], editorSave)
  if (mode === 'normal-conflicts') await writeFile(names[1], editorSave)
  if (mode === 'validation-failure') throw new Error('INJECTED_VALIDATION_FAILURE')
  if (mode === 'restore-error') {
    await rm(names[0])
    await mkdir(names[0])
  }
  await restore(names.slice(0, 2))
  await apply(names[2])
  if (mode === 'html-conflict') await writeFile(names[2], editorSave)
})
`,
    )
    const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', 'run.mjs', mode], {
      cwd: directory,
      env: { HOME: directory, TMPDIR: directory, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 3000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      files: SOURCE_NAMES.map((name) => {
        try {
          return readFileSync(join(directory, name), 'utf8')
        } catch (error) {
          if (mode === 'restore-error' && error.code === 'EISDIR') return null
          throw error
        }
      }),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
