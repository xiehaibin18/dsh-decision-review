/**
 * Client half of the decision-review bundle. The row configuration page
 * uses the bundle's authenticated, same-origin routes. The stored API key
 * is write-only: the host never sends it back.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement as h } from 'react'
import { createReviewApi } from './api.js'
import { MESSAGES, NS, type ResolveText, type Translate } from './messages.js'
import { ConfigPanel } from './panel.js'
import { ApprovalStatsPill } from './stats-pill.js'
import css from './styles.css' with { type: 'text' }
import { NOTE } from './styles.js'
import controlCss from './ui/control-styles.generated.css' with { type: 'text' }

export const inject = ['slots', 'locale']

export function apply(ctx: Context): () => void {
  const disposeLocale = ctx.locale.register(NS, MESSAGES)
  const resolveText: ResolveText = (text) => ctx.locale.resolveText(text)
  const api = createReviewApi()

  ctx.slots.inject('plugins.row.config', function () {
    return ctx.slots.register(
      { name: 'plugins.row.config', key: '@local/decision-review#decision-review', locale: NS },
      function RowConfig({ t, view }: PluginConfigViewProps & { t: Translate }) {
        if (view === 'summary') return h('span', { style: NOTE }, t('panel.desc'))
        return h(ConfigPanel, { t, resolveText, api })
      },
    )
  })

  ctx.slots.inject('conversation.composer.dock', function () {
    return ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'decision-review-approvals', order: 2, locale: NS },
      function ComposerStats({ t, sessionId }) {
        return h(ApprovalStatsPill, { t, sessionId, api })
      },
    )
  })

  const style = document.createElement('style')
  style.setAttribute('data-decision-review', '')
  style.textContent = css + '\n' + controlCss
  document.head.append(style)
  return () => {
    style.remove()
    disposeLocale()
  }
}
