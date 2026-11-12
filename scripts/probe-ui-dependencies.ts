import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import project_manifest from '../package.json' with { type: 'json' }
import base_config from '../tsconfig.json' with { type: 'json' }
import client_config from '../tsconfig.client.json' with { type: 'json' }

const root = fileURLToPath(new URL('../', import.meta.url))
const EXPECTED_BUN_REVISION = '963452075e9d7e2a47a482f297143af5ed4f76c0'
const BASELINE_CLIENT = 'artifacts/ui-evaluation/baseline/client.js'
const PRODUCTION_BUILDER = 'scripts/build.ts'
const PLUGIN_EXTERNALS = ['react', 'react/jsx-runtime']
// Keep these arguments in sync with the client invocation in scripts/build.ts.
// The probe also runs that script unchanged in the temporary fixture to test the real guard.
const CLIENT_FLAGS = [
  '--packages=bundle',
  '--reject-unresolved',
  '--sourcemap=none',
  '--target=browser',
  '--format=cjs',
]
const SIZE_SCOPE =
  'Gzip level 9. When present, the baseline measures the full native plugin client. Each probe measures a standalone fixture and does not estimate a plugin size delta. The React DOM external diagnostic does not satisfy the current plugin bundle contract. Host rendering was not tested.'
const PROBE_ENTRY = 'src/client/index.ts'
const CHOICES = `
const choices = [
  { value: 'session', label: 'Session model' },
  { value: 'decisions', label: 'Decisions API' },
]
`

const native_select = `
import React from 'react'
${CHOICES}
export function ProbeSelect() {
  return (
    <select aria-label="Review engine" defaultValue="session">
      {choices.map(({ value, label }) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  )
}
`

const portal_select = `
import React from 'react'
import { Select } from '@base-ui/react/select'
${CHOICES}
export function ProbeSelect() {
  return (
    <Select.Root items={choices} defaultValue="session">
      <Select.Trigger aria-label="Review engine">
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            {choices.map(({ value, label }) => (
              <Select.Item key={value} value={value}>
                <Select.ItemText>{label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
`

const fixtures = {
  native: native_select,
  portal: portal_select,
  inline: portal_select.replace('<Select.Portal>', '<>').replace('</Select.Portal>', '</>'),
}

interface ProbeLock {
  workspaces: {
    '': { name: string; dependencies: Record<string, string>; devDependencies: Record<string, string> }
  }
  packages: Record<string, [string, string, unknown, string]>
}

interface InstalledManifest {
  name: string
  version: string
  license?: string
  engines?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional: boolean }>
}

interface BuildMetadata {
  inputs: Record<string, { imports: { path: string; external?: boolean }[] }>
  outputs: Record<string, unknown>
}

function run_bun(cwd: string, args: string[]) {
  return execFileSync(process.execPath, ['--no-env-file', ...args], { cwd, encoding: 'utf8' })
}

function sha256(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function bundle_sizes(bytes: Buffer) {
  return { raw_bytes: bytes.byteLength, gzip_bytes: gzipSync(bytes, { level: 9 }).byteLength }
}

function cjs_requires(bytes: Buffer) {
  return [...new Set([...bytes.toString().matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1]))].sort()
}

async function read_native_baseline() {
  try {
    const bytes = await readFile(join(root, BASELINE_CLIENT))
    return {
      file: BASELINE_CLIENT,
      sha256: sha256(bytes),
      ...bundle_sizes(bytes),
      emitted_literal_require_specifiers: cjs_requires(bytes),
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

async function prepare_fixture(staging: string, lock_text: string, lock: ProbeLock) {
  await mkdir(join(staging, 'scripts'))
  await mkdir(join(staging, 'src', 'client'), { recursive: true })
  await mkdir(join(staging, 'src', 'server'))
  await mkdir(join(staging, 'fixtures'))
  await mkdir(join(staging, 'assets'))
  await writeFile(
    join(staging, 'package.json'),
    JSON.stringify({
      ...lock.workspaces[''],
      version: '0.0.0',
      private: true,
      type: 'module',
      engines: project_manifest.engines,
    }),
  )
  await writeFile(join(staging, 'bun.lock'), lock_text)
  await writeFile(
    join(staging, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        ...base_config.compilerOptions,
        ...client_config.compilerOptions,
        strict: true,
        skipLibCheck: false,
      },
      include: ['fixtures/*.tsx'],
    }),
  )
  await copyFile(join(root, PRODUCTION_BUILDER), join(staging, PRODUCTION_BUILDER))
  await writeFile(join(staging, 'src', 'server', 'index.ts'), 'export {}\n')
  await writeFile(join(staging, PROBE_ENTRY), "export { ProbeSelect } from './probe'\n")
  await writeFile(join(staging, 'README.md'), '')
  await writeFile(join(staging, 'LICENSE.upstream'), '')
  for (const [name, source] of Object.entries(fixtures)) {
    await writeFile(join(staging, 'fixtures', `${name}.tsx`), source)
  }
}

async function installed_dependencies(staging: string, lock: ProbeLock) {
  const packages = new Map<string, InstalledManifest>()
  for (const [name, [resolved]] of Object.entries(lock.packages).sort()) {
    const manifest: InstalledManifest = JSON.parse(
      await readFile(join(staging, 'node_modules', name, 'package.json'), 'utf8'),
    )
    if (`${manifest.name}@${manifest.version}` !== resolved) throw new Error(`Unexpected resolved package: ${name}`)
    packages.set(name, manifest)
  }

  const base_ui = packages.get('@base-ui/react')
  if (!base_ui) throw new Error('Base UI is missing from the probe installation')
  const base_ui_graph = new Set<string>()
  function walk(name: string) {
    if (base_ui_graph.has(name)) return
    const manifest = packages.get(name)
    if (!manifest) throw new Error(`Missing dependency in installed graph: ${name}`)
    base_ui_graph.add(name)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) walk(dependency)
  }
  walk(base_ui.name)
  const project_lock = await readFile(join(root, 'bun.lock'), 'utf8')
  const base_ui_transitives = [...base_ui_graph].filter((name) => name !== base_ui.name).sort()

  const real_staging = await realpath(staging)
  const react_peer_resolutions: { from: string; peer: string; package_manifest: string }[] = []
  for (const [name, manifest] of packages) {
    const from_package = createRequire(join(staging, 'node_modules', name, 'package.json'))
    for (const peer of ['react', 'react-dom', '@types/react']) {
      if (!manifest.peerDependencies?.[peer]) continue
      // @types/react is type-only but its package manifest is still resolvable.
      const resolved = await realpath(from_package.resolve(`${peer}/package.json`))
      react_peer_resolutions.push({ from: name, peer, package_manifest: relative(real_staging, resolved) })
    }
  }

  return {
    installed_package_count: packages.size,
    installed_versions: Object.fromEntries([...packages].map(([name, manifest]) => [name, manifest.version])),
    base_ui: {
      version: base_ui.version,
      license: base_ui.license,
      engines: base_ui.engines,
      dependencies: base_ui.dependencies,
      peer_dependencies: base_ui.peerDependencies,
      peer_dependencies_meta: base_ui.peerDependenciesMeta,
      runtime_transitive_package_count_excluding_peers: base_ui_transitives.length,
      runtime_transitive_packages_excluding_peers: base_ui_transitives,
      packages_absent_from_project_lock: [...base_ui_graph]
        .filter((name) => !project_lock.includes(`"${name}":`))
        .sort(),
    },
    react_peer_resolutions,
    distinct_manifest_counts: Object.fromEntries(
      ['react', 'react-dom', '@types/react'].map((peer) => [
        peer,
        new Set(react_peer_resolutions.filter((entry) => entry.peer === peer).map((entry) => entry.package_manifest))
          .size,
      ]),
    ),
  }
}

function verify_production_builder(staging: string) {
  const result = spawnSync(process.execPath, ['--no-env-file', PRODUCTION_BUILDER], { cwd: staging, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status === 0) return { accepted: true }
  const rejection = result.stderr.match(/^error: (Client must use the host React instance: .+)$/m)?.[1]
  if (!rejection) throw new Error(`Unexpected production probe failure:\n${result.stderr}`)
  return { accepted: false, rejection }
}

async function measure_bundle(staging: string, externals: string[]) {
  run_bun(staging, [
    'build',
    PROBE_ENTRY,
    ...CLIENT_FLAGS,
    '--outfile=probe.js',
    '--metafile=probe.meta.json',
    ...externals.map((name) => `--external=${name}`),
  ])
  const metadata: BuildMetadata = JSON.parse(await readFile(join(staging, 'probe.meta.json'), 'utf8'))
  if (Object.keys(metadata.outputs).length !== 1) throw new Error('Expected one probe JavaScript bundle')
  const input_paths = Object.keys(metadata.inputs).sort()
  const external_imports = [
    ...new Set(
      Object.values(metadata.inputs).flatMap(({ imports }) =>
        imports.filter((dep) => dep.external).map((dep) => dep.path),
      ),
    ),
  ].sort()
  const react_dom_importers = Object.entries(metadata.inputs)
    .filter(([, { imports }]) =>
      imports.some(({ path }) => path === 'react-dom' || path === 'node_modules/react-dom/index.js'),
    )
    .map(([path]) => path)
    .sort()
  const bytes = await readFile(join(staging, 'probe.js'))
  const emitted_specifiers = cjs_requires(bytes)
  return {
    ...bundle_sizes(bytes),
    input_module_count: input_paths.length,
    bundled_react_inputs: input_paths.filter((path) => /node_modules\/(react|react-dom)(\/|$)/.test(path)),
    metadata_external_bare_specifiers: external_imports.filter((name) => !name.startsWith('.')),
    metadata_external_relative_specifier_count: external_imports.filter((name) => name.startsWith('.')).length,
    emitted_literal_require_specifiers: emitted_specifiers,
    emitted_requires_disallowed_by_plugin: emitted_specifiers.filter((name) => !PLUGIN_EXTERNALS.includes(name)),
    react_dom_importers,
  }
}

async function run_probe() {
  const revision = run_bun(root, ['-p', 'Bun.revision']).trim()
  if (revision !== EXPECTED_BUN_REVISION)
    throw new Error(`Expected Bun revision ${EXPECTED_BUN_REVISION}; got ${revision}`)
  const baseline = await read_native_baseline()
  const lock_text = pinned_lock()
  const lock: ProbeLock = JSON.parse(lock_text)
  const pins = { ...lock.workspaces[''].dependencies, ...lock.workspaces[''].devDependencies }
  const react_pins = ['react', 'react-dom', '@types/react', '@types/react-dom'] as const
  for (const pin of react_pins) {
    if (pins[pin] !== project_manifest.devDependencies[pin]) throw new Error(`React probe pin has drifted: ${pin}`)
  }

  const staging = await mkdtemp(join(tmpdir(), 'decision-review-ui-dependencies-'))
  try {
    await prepare_fixture(staging, lock_text, lock)
    run_bun(staging, [
      'install',
      '--registry=https://registry.npmjs.org',
      '--cache-dir=./cache',
      '--ignore-scripts',
      '--linker=hoisted',
      '--frozen-lockfile',
      '--network-concurrency=4',
    ])
    const installation = await installed_dependencies(staging, lock)
    run_bun(staging, ['check', '--no-script', '-p', 'tsconfig.json'])

    const builds = []
    for (const fixture of Object.keys(fixtures)) {
      await copyFile(join(staging, 'fixtures', `${fixture}.tsx`), join(staging, 'src', 'client', 'probe.tsx'))
      const production = verify_production_builder(staging)
      const production_flags_measurement = await measure_bundle(staging, PLUGIN_EXTERNALS)
      const react_dom_external_diagnostic =
        fixture === 'native'
          ? undefined
          : {
              meets_current_plugin_contract: false,
              ...(await measure_bundle(staging, [...PLUGIN_EXTERNALS, 'react-dom'])),
            }
      builds.push({
        fixture,
        production_builder: production,
        production_flags_measurement,
        react_dom_external_diagnostic,
      })
    }

    if (!builds[0]?.production_builder.accepted)
      throw new Error('The native control did not pass the actual production guard')
    console.log(
      JSON.stringify(
        {
          bun_revision: revision,
          platform: `${process.platform}-${process.arch}`,
          fixture_lock_sha256: sha256(lock_text),
          pins,
          installation,
          typecheck: {
            passed: true,
            strict: true,
            skip_lib_check: false,
            command: 'bun --no-env-file check --no-script -p tsconfig.json',
            scope:
              'Native, portalled, and inline Select fixtures, with the project client compiler options and pinned React 18 declarations.',
          },
          production_client_flags: CLIENT_FLAGS,
          production_client_externals: PLUGIN_EXTERNALS,
          production_builder_sha256: sha256(await readFile(join(staging, PRODUCTION_BUILDER))),
          native_plugin_baseline: baseline,
          native_plugin_baseline_note:
            baseline === null ? `Optional baseline file not found: ${BASELINE_CLIENT}` : undefined,
          size_scope: SIZE_SCOPE,
          builds,
        },
        null,
        2,
      ),
    )
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function pinned_lock() {
  // Frozen npm tarball resolutions for this probe only, including integrity digests.
  return `
{"lockfileVersion":2,"configVersion":1,"workspaces":{"":{"name":"decision-review-base-ui-probe","dependencies":{"@base-ui/react":"1.9.0","react":"18.3.1","react-dom":"18.3.1"},"devDependencies":{"@types/react":"18.3.31","@types/react-dom":"18.3.7"}}},"packages":{"@babel/runtime":["@babel/runtime@8.1.2","",{},"sha512-Ay6HdEKZJAeGs6KKJ/ezCK5ssjFmkvUiR0TEGv/B1abyjLWrQ2RU+M507Ppk0NikhvVFhlEFC1/rHfCiYqSUcw=="],
"@base-ui/react":["@base-ui/react@1.9.0","",{"dependencies":{"@babel/runtime":"^7.29.7 || ^8.0.0","@base-ui/utils":"0.5.0","@floating-ui/react-dom":"^2.1.9","@floating-ui/utils":"^0.2.12","use-sync-external-store":"^1.7.0"},"peerDependencies":{"@date-fns/tz":"^1.2.0","@types/react":"^17 || ^18 || ^19","date-fns":"^4.0.0","react":"^17 || ^18 || ^19","react-dom":"^17 || ^18 || ^19"},
"optionalPeers":["@date-fns/tz","@types/react","date-fns"]},"sha512-S8CSYosASBKtpL8SWUfS78rFElfLijiCgA7oHOK22jCJ95FULsYyKwBNFOgudt0RA+/7yNc7F81bOvQnRgbBiQ=="],
"@base-ui/utils":["@base-ui/utils@0.5.0","",{"dependencies":{"@babel/runtime":"^7.29.7 || ^8.0.0","@floating-ui/utils":"^0.2.12","reselect":"^5.3.0","use-sync-external-store":"^1.7.0"},"peerDependencies":{"@types/react":"^17 || ^18 || ^19","react":"^17 || ^18 || ^19","react-dom":"^17 || ^18 || ^19"},
"optionalPeers":["@types/react"]},"sha512-dYGGcEttjkYiMoa5nHm8vLaJ2UcuTWxo3BFAwOYXeRg/q7UVVvA6cacEIXEs3FgBfK1CGtW1ptElqs7wsx+t9A=="],
"@floating-ui/core":["@floating-ui/core@1.8.0","",{"dependencies":{"@floating-ui/utils":"^0.2.12"}},"sha512-0CIZ5itps/8x7BG8dEIhs53BvCUH2PCoogtakwRTut+Arm58sJooJ0AuZhLw2HJYIR5cMLNPBSS728sPho2khQ=="],
"@floating-ui/dom":["@floating-ui/dom@1.8.0","",{"dependencies":{"@floating-ui/core":"^1.8.0","@floating-ui/utils":"^0.2.12"}},"sha512-yXSrzeHZBTZadLOlfyhCkJHNeLJnHRnRInwdZ40L7ZiaAtrBwoYlsDrX3v5zB1Utk7CLfzcOVnVVWoXEky7Ceg=="],
"@floating-ui/react-dom":["@floating-ui/react-dom@2.1.9","",{"dependencies":{"@floating-ui/dom":"^1.8.0"},"peerDependencies":{"react":">=16.8.0","react-dom":">=16.8.0"}},"sha512-JDjEFGCpImxDCA7JJKviA0M9+RtmJdj0m/NVU5IMgBK+AmZouAQQ7/+2GLH0GXXY0YMw9oXPB8hKdbPYg5QLYg=="],
"@floating-ui/utils":["@floating-ui/utils@0.2.12","",{},"sha512-HpCo8tmWzLVad5s2d19EhAz5zqrrQ6s69qd6moPMQvkOuSwDT1YgRfWSVuc4ennqrgv3OHppiOGMQ7oC13yIww=="],
"@types/prop-types":["@types/prop-types@15.7.15","",{},"sha512-F6bEyamV9jKGAFBEmlQnesRPGOQqS2+Uwi0Em15xenOxHaf2hv6L8YCVn3rPdPJOiJfPiCnLIRyvwVaqMY3MIw=="],
"@types/react":["@types/react@18.3.31","",{"dependencies":{"@types/prop-types":"*","csstype":"^3.2.2"}},"sha512-vfEqpXTvwT91yhmwdfouStN2hSKwTvyRs8qpLfADyrq/kxDw0hZM7Wk9Ug1FELj8hIby+S/+kQCSRFF32nv2Qw=="],
"@types/react-dom":["@types/react-dom@18.3.7","",{"peerDependencies":{"@types/react":"^18.0.0"}},"sha512-MEe3UeoENYVFXzoXEWsvcpg6ZvlrFNlOQ7EOsvhI3CfAXwzPfO8Qwuxd40nepsYKqyyVQnTdEfv68q91yLcKrQ=="],
"csstype":["csstype@3.2.3","",{},"sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ=="],
"js-tokens":["js-tokens@4.0.0","",{},"sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ=="],
"loose-envify":["loose-envify@1.4.0","",{"dependencies":{"js-tokens":"^3.0.0 || ^4.0.0"},"bin":{"loose-envify":"cli.js"}},"sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q=="],
"react":["react@18.3.1","",{"dependencies":{"loose-envify":"^1.1.0"}},"sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ=="],
"react-dom":["react-dom@18.3.1","",{"dependencies":{"loose-envify":"^1.1.0","scheduler":"^0.23.2"},"peerDependencies":{"react":"^18.3.1"}},"sha512-5m4nQKp+rZRb09LNH59GM4BxTh9251/ylbKIbpe7TpGxfJ+9kv6BLkLBXIjjspbgbnIBNqlI23tRnTWT0snUIw=="],
"reselect":["reselect@5.3.0","",{},"sha512-XGoLeRAVzUTcJ1qkxPQhDJyIZ5d6zzZD9nT7AEZOaaU9UbWclhycElmhO+VD5bFeLuzhPBaOV2oXC8uG35ZSpg=="],
"scheduler":["scheduler@0.23.2","",{"dependencies":{"loose-envify":"^1.1.0"}},"sha512-UOShsPwz7NrMUqhR6t0hWjFduvOzbtv7toDH1/hIrfRNIDBnnBWd0CwJTGvTpngVlmwGCdP9/Zl/tVrDqcuYzQ=="],
"use-sync-external-store":["use-sync-external-store@1.7.0","",{"peerDependencies":{"react":"^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"}},"sha512-6L+EeigHMQhdaIPNIFUKwfWJSwWFQ8gJbJ2DLOs5sDIegTwR9fRxvnM3uciHKjIZhFz+KAv2emhWMRvDmMcY8A=="]}}
`
}

await run_probe()
