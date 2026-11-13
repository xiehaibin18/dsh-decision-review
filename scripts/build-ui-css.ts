import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs')

export function buildControlCss(watch = false) {
  return Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      cli,
      '-i',
      'src/client/ui/control-styles.css',
      '-o',
      'src/client/ui/control-styles.generated.css',
      '--silent',
      ...(watch ? ['--watch=always'] : []),
    ],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  )
}

if (import.meta.main) process.exitCode = await buildControlCss().exited
