import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = await mkdtemp(join(tmpdir(), 'decision-review-package-'))
const snapshot = join(scratch, 'snapshot')
const keep = process.argv.includes('--keep')
const bun = process.execPath

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } })
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function copySources(destination: string) {
  // Includes pending source edits, but never ignored dependencies, outputs or profile data.
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  for (const name of new Set(names)) {
    const source = join(root, name)
    const stat = await lstat(source).catch(() => undefined)
    if (!stat) continue // A source removed by this change is not part of the snapshot.
    assert.ok(stat.isFile(), `Source snapshot must contain regular files: ${name}`)
    await mkdir(dirname(join(destination, name)), { recursive: true })
    await copyFile(source, join(destination, name))
  }
  assert.ok((await readFile(join(destination, 'bun.lock'))).length > 0)
}

async function buildPackage(directory: string, test: boolean) {
  await cp(snapshot, directory, { recursive: true })
  run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], directory)
  run(bun, ['run', 'typecheck'], directory)
  if (test) run(bun, ['run', 'test'], directory)
  run(bun, ['run', 'pack'], directory)
  const archives = (await readdir(join(directory, 'artifacts'))).filter((name) => name.endsWith('.tgz'))
  assert.equal(archives.length, 1)
  return join(directory, 'artifacts', archives[0])
}

try {
  await copySources(snapshot)
  const first = await buildPackage(join(scratch, 'source-a'), true)
  const second = await buildPackage(join(scratch, 'source-b'), false)
  const checksum = digest(await readFile(first))
  assert.equal(checksum, digest(await readFile(second)), 'Separate clean source builds must produce identical tarballs')
  const entries = execFileSync('tar', ['-tzf', first], { encoding: 'utf8' }).trim().split('\n').sort()
  const expected = [
    'package/LICENSE.upstream',
    'package/README.md',
    'package/package.json',
    'package/dist/index.js',
    'package/dist/client.js',
    'package/dist/cordis.patch.yml',
    'package/dist/icon.svg',
    'package/dist/locale/en.json',
    'package/dist/locale/zh.json',
  ].sort()
  assert.deepEqual(entries, expected, 'Only runtime artifacts and package documentation may be distributed')

  const consumer = join(scratch, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'isolated-consumer', private: true, type: 'module' }),
  )
  run(
    bun,
    ['add', '--production', '--offline', '--ignore-scripts', '--cache-dir', join(scratch, 'empty-cache'), first],
    consumer,
  )
  const installed = join(consumer, 'node_modules', '@local', 'decision-review')
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1')
  assert.equal(manifest.dsh.bundle.patch, './dist/cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dependencies, undefined, 'Runtime dependency closure should be entirely in the package')
  assert.equal(
    manifest.peerDependencies,
    undefined,
    'The host injects shared services; npm must not install a second host',
  )
  for (const path of ['src', 'scripts', 'node_modules']) {
    assert.equal(await lstat(join(installed, path)).catch(() => undefined), undefined)
  }
  for (const filename of ['index.js', 'client.js']) {
    const javascript = await readFile(join(installed, 'dist', filename), 'utf8')
    assert.ok(!javascript.includes(root) && !javascript.includes(scratch), `${filename} contains a local source path`)
  }
  await writeFile(
    join(consumer, 'probe.mjs'),
    `
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import * as server from '@local/decision-review'
assert.equal(server.name, 'decision-review')
assert.equal(typeof server.apply, 'function')
assert.ok(server.inject.includes('permissionPresets'))
for (const language of ['en', 'zh']) {
  const locale = JSON.parse(await readFile(new URL(import.meta.resolve('@local/decision-review/locale/' + language + '.json')), 'utf8'))
  assert.ok(locale.meta.title && locale.meta.description)
}
assert.match(await readFile(new URL(import.meta.resolve('@local/decision-review/icon')), 'utf8'), /<svg/)
const script = await readFile(new URL(import.meta.resolve('@local/decision-review/client')), 'utf8')
let registration
new Script(script).runInNewContext({ window: { __ModuleLoader__: { load(value) { assert.equal(registration, undefined); registration = value } } } })
assert.equal(registration.id, '@local/decision-review')
assert.equal(typeof registration.factory, 'function')
console.info('Production-only package: Node exports, locales, icon and classic client registration passed')
`,
  )
  run('node', ['probe.mjs'], consumer)

  // Keep the original dependency-free regressions useful against the installed bytes.
  // The real React DOM test runs above in source-a with development-only renderer dependencies.
  await symlink(join(installed, 'dist'), join(consumer, 'dist'), 'dir')
  await mkdir(join(consumer, 'test'))
  const tests: string[] = []
  for (const name of await readdir(join(snapshot, 'test'))) {
    if (!name.endsWith('.js') || name === 'client-dom.test.js') continue
    await copyFile(join(snapshot, 'test', name), join(consumer, 'test', name))
    if (name.endsWith('.test.js')) tests.push(join('test', name))
  }
  run('node', ['--test', ...tests], consumer)
  console.info(
    `Verified two clean builds, identical package SHA-256 ${checksum}, offline production installation and installed regressions`,
  )
  if (keep) console.info(`Retained isolated verification directory: ${scratch}`)
} finally {
  if (!keep) await rm(scratch, { recursive: true, force: true })
}
