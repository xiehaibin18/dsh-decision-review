import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'decision-review-package-')))
const snapshot = join(scratch, 'snapshot')
const temp = join(scratch, 'tmp')
const artifacts = join(root, 'artifacts', 'verification')
const keep = process.argv.includes('--keep')
const bun = process.execPath
const expected = [
  'LICENSE.upstream',
  'LICENSE.client',
  'README.md',
  'package.json',
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
].sort()

let phase = 'source snapshot'
let logs = ''
const evidence = {
  status: 'failed',
  platform: `${process.platform}-${process.arch}`,
  bun: {
    version: process.versions.bun,
    revision: undefined as string | undefined,
  },
  node: undefined as string | undefined,
  directory: undefined as { files: string[] } | undefined,
  tarball: undefined as { name: string; sha256: string; files: string[] } | undefined,
  installedTestFiles: [] as string[],
}

function log(message: string, output: NodeJS.WriteStream = process.stdout) {
  const safe = message.replaceAll(scratch, '<verification>').replaceAll(root, '<checkout>')
  logs = (logs + safe).slice(-64_000)
  output.write(safe)
}

function begin(label: string) {
  phase = label
  log(`\n${label}\n`)
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeout?: number) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ?? { ...process.env, TMPDIR: temp, NODE_PATH: '', NODE_OPTIONS: '' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
    timeout,
  })
  if (result.stdout) log(result.stdout)
  if (result.stderr) log(result.stderr, process.stderr)
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${phase} exited with ${result.signal ?? result.status}`)
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

async function buildPackage(copy: string, test: boolean) {
  const directory = join(scratch, copy)
  begin(`${copy}: frozen install, typecheck, build and pack`)
  await cp(snapshot, directory, { recursive: true })
  run(bun, ['--no-env-file', 'install', '--frozen-lockfile', '--ignore-scripts'], directory)
  run(bun, ['--no-env-file', 'run', 'typecheck'], directory)
  if (test) run(bun, ['--no-env-file', 'run', 'test'], directory)
  // Exercise the public pack script from a clean checkout.
  run(bun, ['--no-env-file', 'run', 'pack'], directory)
  const archives = (await readdir(join(directory, 'artifacts'))).filter((name) => name.endsWith('.tgz'))
  assert.equal(archives.length, 1)
  return { directory: join(directory, 'dist'), tarball: join(directory, 'artifacts', archives[0]) }
}

async function assertPackageFiles(directory: string, installerTag?: string) {
  const entries = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      assert.ok(entry.isFile(), `Package artifact must be a regular file: ${entry.name}`)
      return relative(directory, join(entry.parentPath, entry.name))
    })
    .filter((file) => file !== installerTag)
    .sort()
  assert.deepEqual(entries, expected, 'Only runtime artifacts and package documentation may be distributed')
  return entries
}

async function verifyManifest(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1 || 0.2.2-rc.2 || 0.2.2-rc.3')
  assert.equal(manifest.engines.bun, undefined)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundleDependencies',
    'bundledDependencies',
    'scripts',
    'packageManager',
  ]) {
    assert.equal(manifest[field], undefined, `Package must not declare ${field}`)
  }
  for (const filename of ['index.js', 'client.js']) {
    const javascript = await readFile(join(directory, filename), 'utf8')
    assert.ok(!javascript.includes(root) && !javascript.includes(scratch), `${filename} contains a local source path`)
  }
}

async function verifyProductionInstall(form: 'directory' | 'tarball', spec: string, standalone: string) {
  begin(`${form}: empty-cache offline production installation and Node probe`)
  const consumer = join(scratch, `consumer-${form}`)
  const emptyCache = join(consumer, 'empty-cache')
  const env = {
    HOME: join(consumer, 'home'),
    DSH_PROFILE_DIR: join(consumer, 'profile'),
    TMPDIR: join(consumer, 'tmp'),
    PATH: join(consumer, 'bin'),
  }
  await Promise.all([...Object.values(env), emptyCache].map((directory) => mkdir(directory, { recursive: true })))
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'isolated-consumer', private: true, type: 'module' }),
  )
  run(
    bun,
    ['--no-env-file', 'add', '--production', '--offline', '--ignore-scripts', '--cache-dir', emptyCache, spec],
    consumer,
    env,
  )
  const installed = join(consumer, 'node_modules', '@local', 'decision-review')
  assert.deepEqual(await readdir(join(consumer, 'node_modules')), ['@local'])
  assert.deepEqual(await readdir(join(consumer, 'node_modules', '@local')), ['decision-review'])
  // Bun tags extracted tarballs. The tarball's own inventory is checked separately.
  for (const file of await assertPackageFiles(installed, form === 'tarball' ? '.bun-tag' : undefined)) {
    assert.deepEqual(await readFile(join(installed, file)), await readFile(join(standalone, file)), file)
  }

  await mkdir(join(consumer, 'test'))
  await mkdir(join(consumer, 'scripts'))
  await copyFile(join(snapshot, 'test', 'fixtures.js'), join(consumer, 'test', 'fixtures.js'))
  for (const script of ['node-package-probe.mjs', 'check-stylesheet.mjs']) {
    await copyFile(join(snapshot, 'scripts', script), join(consumer, 'scripts', script))
  }
  const node = execFileSync('node', ['-p', 'process.execPath'], {
    cwd: consumer,
    env: { ...env, PATH: process.env.PATH },
    encoding: 'utf8',
  }).trim()
  evidence.node ??= execFileSync(node, ['--version'], { cwd: consumer, env, encoding: 'utf8' }).trim()
  run(
    node,
    [
      '--no-global-search-paths',
      '--permission',
      `--allow-fs-read=${consumer}`,
      `--allow-fs-write=${env.TMPDIR}`,
      'scripts/node-package-probe.mjs',
    ],
    consumer,
    env,
    30_000,
  )
  return { installed, env }
}

try {
  await mkdir(temp)
  evidence.bun.revision = execFileSync(bun, ['--no-env-file', '-p', 'Bun.revision'], { encoding: 'utf8' }).trim()
  begin('source snapshot')
  await copySources(snapshot)
  const first = await buildPackage('source-a', true)
  const second = await buildPackage('source-b', false)
  begin('reproducibility and package closure')
  const checksum = digest(await readFile(first.tarball))
  assert.equal(
    checksum,
    digest(await readFile(second.tarball)),
    'Separate clean source builds must produce identical tarballs',
  )
  const entries = execFileSync('tar', ['-tzf', first.tarball], { encoding: 'utf8' }).trim().split('\n').sort()
  assert.deepEqual(
    entries,
    expected.map((file) => `package/${file}`),
    'Tarball must contain the standalone package',
  )

  const standalone = join(scratch, 'dist')
  await cp(first.directory, standalone, { recursive: true })
  const files = await assertPackageFiles(standalone)
  await verifyManifest(standalone)
  await verifyProductionInstall('directory', '../dist', standalone)
  evidence.directory = { files }
  const { installed, env } = await verifyProductionInstall('tarball', first.tarball, standalone)

  begin('Bun regressions against installed package bytes')
  // The test harness needs React and jsdom. Keep them outside the production consumer.
  const harness = join(scratch, 'installed-tests')
  await mkdir(harness)
  await symlink(installed, join(harness, 'dist'), 'dir')
  await symlink(join(scratch, 'source-a', 'node_modules'), join(harness, 'node_modules'), 'dir')
  await copyFile(join(snapshot, 'bunfig.toml'), join(harness, 'bunfig.toml'))
  await cp(join(snapshot, 'test'), join(harness, 'test'), { recursive: true })
  evidence.installedTestFiles = (await readdir(join(harness, 'test'), { recursive: true }))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
  run(bun, ['--no-env-file', '--no-install', 'test', '--isolate', './test'], harness, env)
  begin('verification evidence')
  await mkdir(artifacts, { recursive: true })
  const name = basename(first.tarball)
  await copyFile(first.tarball, join(artifacts, name))
  evidence.tarball = { name, sha256: checksum, files: entries }
  evidence.status = 'passed'
  log(
    `Verified standalone directory and tarball installation, identical tarball SHA-256 ${checksum}, and installed regressions\n`,
  )
} catch (error) {
  log(`${error instanceof Error ? error.stack : String(error)}\n`, process.stderr)
  process.exitCode = 1
} finally {
  try {
    await mkdir(artifacts, { recursive: true })
    await writeFile(
      join(artifacts, 'package-verification.json'),
      `${JSON.stringify({ ...evidence, phase }, null, 2)}\n`,
    )
    await writeFile(join(artifacts, 'package-verification.log'), logs)
  } finally {
    if (keep) console.info(`Retained isolated verification directory: ${scratch}`)
    else await rm(scratch, { recursive: true, force: true })
  }
}
