/**
 * Client half of the decision-review bundle. The row configuration page
 * uses the bundle's authenticated, same-origin routes. The stored API key
 * is write-only: the host never sends it back.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { createElement as h } from 'react';
import { MESSAGES, NS, type ResolveText, type Translate } from './messages.js';
import { ConfigPanel } from './panel.js';
import { ApprovalStatsPill } from './stats-pill.js';
import { NOTE } from './styles.js';

export const inject = ['slots', 'locale'];

export function apply(ctx: Context): () => void {
  const disposeLocale = ctx.locale.register(NS, MESSAGES);
  const resolveText: ResolveText = (text) => ctx.locale.resolveText(text);

  ctx.slots.inject('plugins.row.config', function () {
    return ctx.slots.register(
      { name: 'plugins.row.config', key: '@local/decision-review#decision-review', locale: NS },
      function RowConfig({ t, view }: PluginConfigViewProps & { t: Translate }) {
        if (view === 'summary') return h('span', { style: NOTE }, t('panel.desc'));
        return h(ConfigPanel, { t, resolveText });
      });
  });

  ctx.slots.inject('conversation.composer.dock', function () {
    return ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'decision-review-approvals', order: 2, locale: NS },
      ApprovalStatsPill);
  });

  return disposeLocale;
}
