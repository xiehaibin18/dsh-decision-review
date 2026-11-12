import { createRoot, type Root } from 'react-dom/client'
import { PreviewApp } from './app.js'
import { createSession, type ActiveSession } from './http.js'
import '../src/client/styles.css'
import './preview.css'

const container = document.getElementById('root')!
const hotState = import.meta.hot.data as { root?: Root; initialSession?: ActiveSession }
const root = (hotState.root ??= createRoot(container))
try {
  const initialSession = (hotState.initialSession ??= await createSession('decisions'))
  root.render(<PreviewApp initialSession={initialSession} />)
} catch (error) {
  root.render(
    <p role="alert">预览服务无法启动，请重载页面。{error instanceof Error ? error.message : String(error)}</p>,
  )
}
