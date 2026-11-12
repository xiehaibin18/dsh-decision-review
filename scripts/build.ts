import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sourceManifest from '../package.json' with { type: 'json' }

const root = fileURLToPath(new URL('../', import.meta.url))
const staging = await mkdtemp(join(tmpdir(), 'decision-review-build-'))
// React is owned by the host's ModuleLoader. Other library imports are bundled.
const sharedClientModules = ['react', 'react/jsx-runtime']
const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  private: sourceManifest.private,
  type: sourceManifest.type,
  description: sourceManifest.description,
  exports: {
    '.': './index.js',
    './client': './client.js',
    './locale/*.json': './locale/*.json',
    './icon': './icon.svg',
  },
  engines: { node: sourceManifest.engines.node, dsh: sourceManifest.engines.dsh },
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      platform: 'web',
      immediately: true,
      inject: ['@deepseek-ai/dsh-client-ui-conversation'],
    },
  },
}

interface BuildMetadata {
  inputs: Record<string, { imports: { path: string; external?: boolean }[] }>
  outputs: Record<string, unknown>
}

async function bundle(target: 'server' | 'client') {
  const output = join(staging, `${target}.js`)
  const metafile = join(staging, `${target}.json`)
  execFileSync(
    process.execPath,
    [
      '--no-env-file',
      'build',
      `src/${target}/index.ts`,
      '--packages=bundle',
      '--reject-unresolved',
      '--sourcemap=none',
      `--target=${target === 'server' ? 'node' : 'browser'}`,
      `--format=${target === 'server' ? 'esm' : 'cjs'}`,
      `--outfile=${output}`,
      `--metafile=${metafile}`,
      ...(target === 'client' ? sharedClientModules.map((name) => `--external=${name}`) : []),
    ],
    { cwd: root, stdio: 'inherit' },
  )
  // The manifest is emitted by the pinned bundler in this invocation.
  const metadata: BuildMetadata = JSON.parse(await readFile(metafile, 'utf8'))
  if (Object.keys(metadata.outputs).length !== 1) throw new Error(`Expected one ${target} JavaScript bundle`)
  for (const input of Object.values(metadata.inputs)) {
    for (const dependency of input.imports) {
      if (!dependency.external) continue
      const allowed =
        target === 'server' ? dependency.path.startsWith('node:') : sharedClientModules.includes(dependency.path)
      if (!allowed) throw new Error(`Unexpected ${target} runtime dependency: ${dependency.path}`)
    }
  }
  return readFile(output, 'utf8')
}

try {
  const serverText = await bundle('server')
  const clientText = await bundle('client')
  // DSH serves a classic script and supplies require inside this factory.
  const registeredClient = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(manifest.name)},
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
${clientText}
    return module.exports;
  },
});
`
  const dist = join(root, 'dist')
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, 'index.js'), serverText)
  await writeFile(join(dist, 'client.js'), registeredClient)
  await writeFile(join(dist, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await cp(join(root, 'assets'), dist, { recursive: true })
  await copyFile(join(root, 'README.md'), join(dist, 'README.md'))
  await copyFile(join(root, 'LICENSE.upstream'), join(dist, 'LICENSE.upstream'))
  console.info('Built installable DSH bundle in dist/')
} finally {
  await rm(staging, { recursive: true, force: true })
}
