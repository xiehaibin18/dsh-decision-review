import { startPreview } from '@xiehaibin18/dsh-plugin-dev/preview'
import '../scripts/check-toolchain.js'
import { buildControlCss } from '../scripts/build-ui-css.js'
import page from './index.html'
import { createPreviewService } from './service.js'

const service = createPreviewService()
const server = startPreview({ page, defaultPort: 4317, fetch: (request) => service.fetch(request) })
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
