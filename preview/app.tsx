import {
  PreviewAppearanceControls,
  type PreviewLanguage,
  type PreviewTheme,
} from '@xiehaibin18/dsh-plugin-dev/appearance'
import { useEffect, useRef, useState } from 'react'
import { PreviewCanvas } from './canvas.js'
import { APPROVAL_CASES, type ApprovalCaseId } from './fixtures.js'
import { APPROVAL_SLOT, CONFIG_SLOT, STATS_SLOT, HostPreview, type PreviewSlot } from './host-preview.js'
import { createSession, deleteSession, recoverSession, type ActiveSession } from './http.js'
import { SCENES, type SceneId } from './scenes.js'

export function PreviewApp({ initialSession }: { initialSession: ActiveSession }) {
  const [session, setSession] = useState<ActiveSession | null>(initialSession)
  const [scene, setScene] = useState<SceneId>(initialSession.scene)
  const [language, setLanguage] = useState<PreviewLanguage>('zh')
  const [theme, setTheme] = useState<PreviewTheme>('light')
  const [slot, setSlot] = useState<PreviewSlot>(CONFIG_SLOT)
  const [approvalCase, setApprovalCase] = useState<ApprovalCaseId>('security')
  const [error, setError] = useState('')
  const [recovered, setRecovered] = useState(false)
  const [reload, setReload] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const current = useRef(session)
  const generation = useRef(0)
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
        <div className="preview-heading">
          <h1>Decision Review 开发预览</h1>
          <span>DSH 桌面模拟 · 仅用合成数据</span>
        </div>
        <div className="preview-toolbar">
          <label>
            宿主槽位
            <select value={slot} onChange={(event) => setSlot(event.target.value as PreviewSlot)}>
              <option value={CONFIG_SLOT}>插件详情 · 配置</option>
              <option value={STATS_SLOT}>会话输入框 · 统计栏</option>
              <option value={APPROVAL_SLOT}>会话审批 · 评审说明卡</option>
            </select>
          </label>
          {slot === APPROVAL_SLOT && (
            <label>
              审批示例
              <select value={approvalCase} onChange={(event) => setApprovalCase(event.target.value as ApprovalCaseId)}>
                {APPROVAL_CASES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <PreviewAppearanceControls
            language={language}
            theme={theme}
            onLanguageChange={setLanguage}
            onThemeChange={setTheme}
          />
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
          <div className="preview-actions">
            <button title="丢弃草稿并取消旧场景请求" onClick={() => void switchScene(scene)}>
              重置当前场景
            </button>
            {slot === CONFIG_SLOT && (
              <button
                title="丢弃草稿，从当前场景读取已保存的配置"
                disabled={!session}
                onClick={() => setReload((value) => value + 1)}
              >
                重新加载已保存配置
              </button>
            )}
            {scene.endsWith('-error') && (
              <button disabled={!session || recovered || recovering} onClick={() => void recover()}>
                {recovered ? '接口已恢复' : recovering ? '正在恢复…' : '恢复接口'}
              </button>
            )}
          </div>
        </div>
        <p className="preview-scene-status" role="status">
          <code>{slot}</code>
          <span>{selectedScene.description}</span>
        </p>
        {error && <p role="alert">预览服务错误：{error}。可重置场景重试。</p>}
      </header>
      <PreviewCanvas>
        <HostPreview slot={slot} session={session} language={language} reload={reload} approvalCase={approvalCase} />
      </PreviewCanvas>
    </div>
  )
}
