import { useEffect, useRef, useState } from 'react'
import { ConfigPanel } from '../src/client/panel.js'
import { ApprovalStatsPill } from '../src/client/stats-pill.js'
import { createSession, deleteSession, recoverSession, type ActiveSession } from './http.js'
import { previewLocale } from './locale.js'
import { SCENES, type SceneId, type PreviewLanguage, type PreviewTheme, type PreviewWidth } from './scenes.js'

export function PreviewApp({ initialSession }: { initialSession: ActiveSession }) {
  const [session, setSession] = useState<ActiveSession | null>(initialSession)
  const [scene, setScene] = useState<SceneId>(initialSession.scene)
  const [language, setLanguage] = useState<PreviewLanguage>('zh')
  const [theme, setTheme] = useState<PreviewTheme>('light')
  const [width, setWidth] = useState<PreviewWidth>('wide')
  const [error, setError] = useState('')
  const [recovered, setRecovered] = useState(false)
  const [reload, setReload] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const current = useRef(session)
  const generation = useRef(0)
  const locale = previewLocale(language)
  const selectedScene = SCENES.find((candidate) => candidate.id === scene)!

  useEffect(() => {
    function release() {
      if (current.current)
        void fetch(`/api/preview/sessions/${current.current.id}`, { method: 'DELETE', keepalive: true })
    }
    window.addEventListener('pagehide', release)
    return () => window.removeEventListener('pagehide', release)
  }, [])

  async function switchScene(nextScene: SceneId) {
    const ticket = ++generation.current
    const previous = current.current
    current.current = null
    setSession(null)
    setScene(nextScene)
    setError('')
    setRecovered(false)
    setRecovering(false)
    try {
      if (previous) await deleteSession(previous)
      const next = await createSession(nextScene)
      if (ticket !== generation.current) {
        await deleteSession(next)
        return
      }
      current.current = next
      setSession(next)
    } catch (cause) {
      if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function recover() {
    if (!session) return
    const ticket = generation.current
    setRecovering(true)
    setError('')
    try {
      await recoverSession(session)
      if (ticket !== generation.current) return
      setRecovered(true)
      if (scene === 'load-error') setReload((value) => value + 1)
    } catch (cause) {
      if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (ticket === generation.current) setRecovering(false)
    }
  }

  return (
    <div className="preview-shell" data-theme={theme}>
      <header className="preview-controls" lang="zh">
        <h1>Decision Review 开发预览</h1>
        <p>业务组件、样式与文案来自插件源码。所有配置与测试结果均为本地合成数据，请只输入测试内容。</p>
        <div className="preview-toolbar">
          <label>
            预览场景
            <select value={scene} onChange={(event) => void switchScene(event.target.value as SceneId)}>
              {SCENES.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            界面语言
            <select value={language} onChange={(event) => setLanguage(event.target.value as PreviewLanguage)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            主题
            <select value={theme} onChange={(event) => setTheme(event.target.value as PreviewTheme)}>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label>
            预览宽度
            <select value={width} onChange={(event) => setWidth(event.target.value as PreviewWidth)}>
              <option value="wide">宽屏</option>
              <option value="narrow">窄屏 · 390px</option>
            </select>
          </label>
        </div>
        <div className="preview-actions">
          <button onClick={() => void switchScene(scene)}>重置当前场景</button>
          <button disabled={!session} onClick={() => setReload((value) => value + 1)}>
            重新加载已保存配置
          </button>
          {scene.endsWith('-error') && (
            <button disabled={!session || recovered || recovering} onClick={() => void recover()}>
              {recovered ? '接口已恢复' : recovering ? '正在恢复…' : '恢复接口'}
            </button>
          )}
        </div>
        <p className="preview-scene-status" role="status">
          当前场景：{selectedScene.label}
          {recovered ? '（接口已恢复）' : ''}。{selectedScene.description}
        </p>
        <p className="preview-hint">
          切换或重置场景会丢弃草稿并取消旧请求；语言、主题和宽度切换保留编辑。「重新加载」保留服务器已保存的数据，丢弃草稿。
        </p>
        {error && <p role="alert">预览服务错误：{error}。可重置场景重试。</p>}
      </header>
      <main className="preview-surface" data-width={width} lang={language}>
        {session ? (
          <div key={`${session.id}:${reload}`}>
            <section className="preview-slot" aria-label={language === 'zh' ? '插件配置' : 'Plugin configuration'}>
              <ConfigPanel {...locale} api={session.api} />
            </section>
            <section className="preview-dock" aria-label={language === 'zh' ? '会话统计' : 'Session statistics'}>
              <span className="preview-slot-label">
                {language === 'zh' ? '会话统计插槽' : 'Session statistics slot'}
              </span>
              <ApprovalStatsPill t={locale.t} sessionId="session-preview" api={session.api} />
            </section>
          </div>
        ) : (
          <p role="status">正在切换场景…</p>
        )}
      </main>
    </div>
  )
}
