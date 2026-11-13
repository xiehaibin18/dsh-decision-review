/** @jsxRuntime classic */
import * as React from 'react'
import type { ReviewStats } from '../shared/contracts.js'
import type { ReviewApi } from './api.js'
import type { Translate } from './messages.js'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.js'

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
  return <StatsDetails t={t} stats={stats} />
}

function StatsDetails({ t, stats }: { t: Translate; stats: ReviewStats }) {
  const [container, setContainer] = React.useState<HTMLSpanElement | null>(null)
  const label =
    stats.passRate === null
      ? t('pill.label.unavailable', { n: stats.reviewed })
      : t('pill.label', { n: stats.reviewed, p: stats.passRate })
  const metrics = [
    [t('pill.rate'), stats.passRate === null ? t('pill.unavailable') : stats.passRate + '%'],
    [t('pill.allowed'), stats.autoAllowed],
    [t('pill.asked'), stats.asked],
    [t('pill.blocked'), stats.finalDenied],
    [t('pill.failed'), stats.failed],
  ] as const
  return (
    <span className="decision-review-stats" ref={setContainer}>
      <Popover>
        <PopoverTrigger className="decision-review-stats-trigger">
          <StatsIcon />
          <span>{label}</span>
        </PopoverTrigger>
        <PopoverContent container={container} side="top" align="end" sideOffset={8}>
          <div className="decision-review-stats-header">
            <PopoverTitle>
              <StatsIcon />
              {t('pill.title')}
            </PopoverTitle>
            <span className="decision-review-stats-total" aria-label={t('pill.total', { n: stats.reviewed })}>
              {stats.reviewed}
            </span>
          </div>
          <dl className="decision-review-stats-list">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </span>
  )
}

function StatsIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      strokeWidth={1}
      className="decision-review-stats-icon"
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
  )
}
