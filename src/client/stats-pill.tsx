/** @jsxRuntime classic */
import * as React from 'react'
import type { ReviewStats } from '../shared/contracts.js'
import type { ReviewApi } from './api.js'
import type { Translate } from './messages.js'

interface PillProps {
  t: Translate
  sessionId?: string
  api: ReviewApi
}

/** Shows the current session's cumulative review count and pass rate. */
export function ApprovalStatsPill({ t, sessionId, api }: PillProps) {
  const [reading, setReading] = React.useState({ api, sessionId, stats: null as ReviewStats | null })

  React.useEffect(() => {
    if (!sessionId) {
      console.info('[decision-review] dock pill: no sessionId prop')
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    let warned = false
    let inFlight = false

    const tick = async () => {
      if (document.hidden || inFlight) return
      inFlight = true
      try {
        const stats = await api.getStats(sessionId, signal)
        if (!signal.aborted && (stats === null || typeof stats.reviewed === 'number')) {
          setReading({ api, sessionId, stats })
        }
      } catch (err) {
        if (!signal.aborted && !warned) {
          warned = true
          console.warn('[decision-review] dock pill fetch failed:', err)
        }
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = setInterval(tick, 4000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [sessionId, api])

  if (reading.api !== api || reading.sessionId !== sessionId) {
    setReading({ api, sessionId, stats: null })
    return null
  }
  const { stats } = reading
  if (!stats?.reviewed) return null
  const rate = stats.passRate === null ? '—' : stats.passRate

  return (
    <span
      title={t('pill.title', {
        n: stats.reviewed,
        auto: stats.autoAllowed,
        asked: stats.asked,
        denied: stats.finalDenied + stats.failed,
      })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      }}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        strokeWidth={1}
        style={{ flex: '0 0 auto' }}
      >
        <path
          d="M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z"
          stroke="currentColor"
          strokeLinejoin="round"
        />
        <path
          d="M5.75 10.15L8 4.95L10.25 10.15M6.43 8.59H9.57"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{t('pill.label', { n: stats.reviewed, p: rate })}</span>
    </span>
  )
}
