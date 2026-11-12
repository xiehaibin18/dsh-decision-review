import { useState } from 'react'
import enMetadata from '../assets/locale/en.json'
import zhMetadata from '../assets/locale/zh.json'
import { ConfigPanel } from '../src/client/panel.js'
import { ApprovalStatsPill } from '../src/client/stats-pill.js'
import type { ActiveSession } from './http.js'
import { previewLocale } from './locale.js'
import type { PreviewLanguage } from './scenes.js'

export const CONFIG_SLOT = 'plugins.row.config'
export const STATS_SLOT = 'conversation.composer.dock'
export type PreviewSlot = typeof CONFIG_SLOT | typeof STATS_SLOT

const HOST_TEXT = {
  zh: {
    plugins: '插件',
    config: '插件配置',
    stats: '会话统计',
    switching: '正在切换场景…',
    newSession: '新会话',
    search: '搜索',
    recent: '最近会话',
    examples: ['示例工作区', '整理示例文档', '检查演示页面', '运行示例测试'],
    settings: '设置',
    chat: '示例会话',
    prompt: '帮我检查演示页面的布局。',
    answer: '我会先查看示例项目，再检查桌面和窄窗口下的显示。',
    followUp: '也请记录需要调整的地方。',
    input: '输入消息…',
    review: '自动评审',
    model: '示例模型',
    turns: '3 轮 · 5 步',
  },
  en: {
    plugins: 'Plugins',
    config: 'Plugin configuration',
    stats: 'Session statistics',
    switching: 'Switching scenes…',
    newSession: 'New session',
    search: 'Search',
    recent: 'Recent sessions',
    examples: ['Example workspace', 'Organize sample docs', 'Inspect the demo page', 'Run example tests'],
    settings: 'Settings',
    chat: 'Example session',
    prompt: 'Check the layout of the demo page.',
    answer: 'I’ll open the example project and check its layout in desktop and narrow windows.',
    followUp: 'Please also note anything that needs an adjustment.',
    input: 'Enter a message…',
    review: 'Auto review',
    model: 'Example model',
    turns: '3 turns · 5 steps',
  },
}

export function HostPreview({
  slot,
  session,
  language,
  reload,
}: {
  slot: PreviewSlot
  session: ActiveSession | null
  language: PreviewLanguage
  reload: number
}) {
  const text = HOST_TEXT[language]
  const configVisible = slot === CONFIG_SLOT
  return (
    <div className="preview-host" lang={language}>
      <div className="preview-chrome preview-context" aria-hidden="true">
        <span className="preview-traffic-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="preview-chrome-icons">
          <i />
          <i />
        </span>
      </div>
      <div className="preview-sidebar" aria-hidden="true">
        <div className="preview-sidebar-content preview-context">
          <div className="preview-sidebar-link">
            <i>＋</i>
            {text.newSession}
          </div>
          <div className="preview-sidebar-link">
            <i>⌕</i>
            {text.search}
          </div>
          <div className="preview-sidebar-link" data-current={configVisible || undefined}>
            <i>◇</i>
            {text.plugins}
          </div>
          <div className="preview-sidebar-heading">{text.recent}</div>
          {text.examples.map((label, index) => (
            <div
              className="preview-sidebar-link"
              key={label}
              data-current={(!configVisible && index === 2) || undefined}
            >
              <i>{index === 0 ? '▱' : '·'}</i>
              {label}
            </div>
          ))}
          <div className="preview-sidebar-footer preview-sidebar-link">
            <i>⚙</i>
            {text.settings}
          </div>
        </div>
      </div>
      <PluginDetail key={session?.id} visible={configVisible} session={session} language={language} reload={reload} />
      {!configVisible && <Conversation session={session} language={language} />}
    </div>
  )
}

function PluginDetail({
  visible,
  session,
  language,
  reload,
}: {
  visible: boolean
  session: ActiveSession | null
  language: PreviewLanguage
  reload: number
}) {
  const [visited, setVisited] = useState(visible)
  if (visible && !visited) setVisited(true)
  const text = HOST_TEXT[language]
  const locale = previewLocale(language)
  const { meta } = language === 'zh' ? zhMetadata : enMetadata
  return (
    <section className="preview-plugin-page" hidden={!visible} aria-label={text.config} tabIndex={0}>
      <div className="preview-plugin-detail">
        <div className="preview-plugin-intro preview-context" aria-hidden="true">
          <div className="preview-breadcrumb">
            ‹　{text.plugins} / {meta.title}
          </div>
          <span className="preview-plugin-art" />
          <div className="preview-plugin-title">{meta.title}</div>
          <code>decision-review</code>
          <code>@local/decision-review</code>
          <p>{locale.t('panel.desc')}</p>
        </div>
        <div className="preview-config-slot">
          {session ? (
            // Preserve the real form's draft while another slot is visible.
            (visible || visited) && <ConfigPanel key={reload} {...locale} api={session.api} />
          ) : (
            <p role="status">{text.switching}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function Conversation({ session, language }: { session: ActiveSession | null; language: PreviewLanguage }) {
  const text = HOST_TEXT[language]
  const { t } = previewLocale(language)
  return (
    <section className="preview-conversation">
      <div className="preview-conversation-header preview-context" aria-hidden="true">
        <span>{text.chat}</span>
        <span>···</span>
      </div>
      <div className="preview-transcript">
        <div className="preview-messages preview-context" aria-hidden="true">
          <p className="preview-user-message">{text.prompt}</p>
          <p className="preview-agent-message">{text.answer}</p>
          <p className="preview-user-message">{text.followUp}</p>
        </div>
      </div>
      <div className="preview-composer">
        <div className="preview-composer-card preview-context" aria-hidden="true">
          <span>{text.input}</span>
          <div className="preview-composer-actions">
            <span>＋　{text.review} ⌄</span>
            <span>{text.model} ⌄　↑</span>
          </div>
        </div>
        <section className="preview-stats-dock" aria-label={text.stats}>
          <span className="preview-context" aria-hidden="true">
            {text.turns}
          </span>
          <span className="preview-context" aria-hidden="true">
            8.2k tokens
          </span>
          {session ? (
            <ApprovalStatsPill t={t} sessionId="session-preview" api={session.api} />
          ) : (
            <span role="status">{text.switching}</span>
          )}
        </section>
      </div>
    </section>
  )
}
