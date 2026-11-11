import * as React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { API_BASE, type ReviewStats } from '../shared/contracts.js'
import type { Translate } from './messages.js'

const h = React.createElement

type PillProps = Pick<PropsRuntime<'conversation.composer.dock'>, 'sessionId'> & { t: Translate }

/**
 * Composer dock pill: this session's cumulative approval asks and pass
 * rate, polled from the host route folding the decision-review JSONL
 * trail. Renders nothing until the session has at least one ask.
 */
export function ApprovalStatsPill({ t, sessionId }: PillProps) {
  const [stats, setStats] = React.useState<ReviewStats | null>(null)

  React.useEffect(
    function () {
      if (!sessionId) {
        console.info('[decision-review] dock pill: no sessionId prop')
        return undefined
      }
      let alive = true
      let warned = false
      // Trails key sessions by bare uuid; the client prop may carry the
      // `session-<uuid>` wire form.
      const id = String(sessionId).replace(/^session-/, '')
      async function tick() {
        if (document.hidden) return
        try {
          const res = await fetch(API_BASE + '/stats?session=' + encodeURIComponent(id))
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const payload: ReviewStats | null = await res.json()
          if (alive && payload && typeof payload.reviewed === 'number') setStats(payload)
        } catch (err) {
          if (!warned) {
            warned = true
            console.warn('[decision-review] dock pill fetch failed:', err)
          }
        }
      }
      tick()
      const timer = setInterval(tick, 4000)
      return function () {
        alive = false
        clearInterval(timer)
      }
    },
    [sessionId],
  )

  if (!stats || !stats.reviewed) return null
  const rate = stats.passRate === null ? '—' : stats.passRate
  // Same skin as the shipped dock pills: bare icon + reading, no chip.
  return h(
    'span',
    {
      title: t('pill.title', {
        n: stats.reviewed,
        auto: stats.autoAllowed,
        asked: stats.asked,
        denied: stats.finalDenied + stats.failed,
      }),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      },
    },
    h(
      'svg',
      {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
        strokeWidth: 1,
        style: { flex: '0 0 auto' },
      },
      h('path', {
        d: 'M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z',
        stroke: 'currentColor',
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M5.75 10.15L8 4.95L10.25 10.15M6.43 8.59H9.57',
        stroke: 'currentColor',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ),
    h('span', null, t('pill.label', { n: stats.reviewed, p: rate })),
  )
}
