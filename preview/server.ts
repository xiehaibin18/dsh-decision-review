import '../scripts/check-toolchain.js'
import { buildControlCss } from '../scripts/build-ui-css.js'
import page from './index.html'
import { createPreviewService } from './service.js'

const port = process.env.PREVIEW_PORT === undefined ? 4317 : Number(process.env.PREVIEW_PORT)
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('PREVIEW_PORT must be an integer from 0 to 65535')
const service = createPreviewService()
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  development: { hmr: true, console: true },
  routes: { '/': page, '/favicon.ico': new Response(null, { status: 204 }) },
  fetch: (request) => service.fetch(request),
})
const cssWatch = buildControlCss(true)
let stopping = false
void cssWatch.exited.then((code) => {
  if (stopping) return
  console.error(`Tailwind CSS watcher exited unexpectedly: ${code}`)
  process.exitCode = code || 1
  stop()
})
console.info(`Decision Review preview: ${server.url}`)
console.info('Synthetic in-memory fixtures only. No model requests or DSH profiles are used.')

function stop() {
  if (stopping) return
  stopping = true
  cssWatch.kill()
  service.dispose()
  void server.stop(true)
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
