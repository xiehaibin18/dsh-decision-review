/** @jsxRuntime classic */
import * as React from 'react'
import { createPortal } from 'react-dom'
import type { DenialExplanation, PendingDecisionScores, PendingReview, PredicateName } from '../shared/contracts.js'
import type { ReviewApi } from './api.js'
import type { ResolveText, Translate } from './messages.js'

interface SignalRow {
  key: string
  label: string
  value: number | null
  threshold: number | null
  direction: 'min' | 'max' | 'info'
  triggered: boolean
  notable: boolean
  refused: boolean
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '')
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function matchedRuleInfo(why: DenialExplanation): { rule: number; condition: string } | null {
  if (why.code === 'rule_ask' || why.code === 'rule_deny' || why.code === 'rule_unrequested') {
    return { rule: why.rule + 1, condition: why.condition }
  }
  return null
}

function buildSignalRows(t: Translate, scores: PendingDecisionScores, why: DenialExplanation): SignalRow[] {
  const { predicates, thresholds, riskClass, refused } = scores
  const refusedSet = new Set(refused)
  const rows: SignalRow[] = []

  const pushPredicate = (
    name: PredicateName,
    threshold: number | null,
    direction: 'min' | 'max' | 'info',
    triggered: boolean,
    notable: boolean,
  ) => {
    const value = predicates[name]
    const isRefused = refusedSet.has(name) || value === null
    rows.push({
      key: name,
      label: t(`approval.metric.${name}`),
      value,
      threshold,
      direction,
      triggered: triggered || (isRefused && why.code === 'refused_predicate'),
      notable: notable || triggered || isRefused || (value !== null && value >= 0.2),
      refused: isRefused,
    })
  }

  const exfil = predicates.exfiltration
  pushPredicate(
    'exfiltration',
    thresholds.tHighPred,
    'max',
    why.code === 'exfiltration' || (exfil !== null && exfil >= thresholds.tHighPred),
    why.code === 'exfiltration',
  )

  const auth = predicates.explicit_authorization
  const authFailed =
    why.code === 'authorization' ||
    why.code === 'rule_unrequested' ||
    (auth !== null && auth < thresholds.tAuth && (why.code === 'high_class' || why.code === 'conflict'))
  pushPredicate(
    'explicit_authorization',
    thresholds.tAuth,
    'min',
    why.code === 'authorization' || why.code === 'rule_unrequested',
    authFailed,
  )

  const medThreshold =
    riskClass && riskClass.confidence < thresholds.tConf ? thresholds.tMedPred : thresholds.tStrongPred
  const mediumPredicates: readonly ('security_change' | 'irreversible_deletion' | 'production_effect')[] = [
    'security_change',
    'irreversible_deletion',
    'production_effect',
  ]
  for (const name of mediumPredicates) {
    const value = predicates[name]
    const isBlamed = (why.code === 'authorization' || why.code === 'conflict') && why.pred === name
    const exceeds = value !== null && value >= medThreshold
    pushPredicate(name, medThreshold, 'max', isBlamed || exceeds, isBlamed || exceeds)
  }

  if (riskClass) {
    const lowConf =
      why.code === 'low_confidence' ||
      why.code === 'authorized_low_confidence' ||
      riskClass.confidence < thresholds.tConf
    rows.push({
      key: 'risk_class',
      label: t('approval.metric.risk_class', { risk: t(`test.risk.${riskClass.choice}`) }),
      value: riskClass.confidence,
      threshold: thresholds.tConf,
      direction: 'min',
      triggered: lowConf || why.code === 'high_class',
      notable: lowConf || why.code === 'high_class' || why.code === 'conflict',
      refused: false,
    })
  } else {
    rows.push({
      key: 'risk_class',
      label: t('approval.metric.risk_class', { risk: t('test.risk.unknown') }),
      value: null,
      threshold: thresholds.tConf,
      direction: 'min',
      triggered: true,
      notable: true,
      refused: true,
    })
  }

  pushPredicate('session_created_cleanup', null, 'info', false, (predicates.session_created_cleanup ?? 0) >= 0.4)

  // Surface triggered signals first, then notable signals, preserving natural order within ties.
  return rows.sort((a, b) => Number(b.triggered) - Number(a.triggered) || Number(b.notable) - Number(a.notable))
}

export interface PendingApprovalCardProps {
  t: Translate
  resolveText: ResolveText
  pending: PendingReview
}

/** Rich read-only review context card rendered directly above the host's official approval card. */
export function PendingApprovalCard({ t, resolveText, pending }: PendingApprovalCardProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [showAllScores, setShowAllScores] = React.useState(false)

  const rule = matchedRuleInfo(pending.why)
  const reason = resolveText(pending.display)
  const allRows = pending.scores ? buildSignalRows(t, pending.scores, pending.why) : []
  const keyRows = allRows.filter((row) => row.notable)
  const visibleRows = showAllScores || keyRows.length === 0 ? allRows : keyRows
  const hasHiddenRows = keyRows.length > 0 && keyRows.length < allRows.length
  const actionKindLabel = t(`approval.action.${pending.action.kind}`)
  const hasActionBody = Boolean(pending.action.target || pending.action.detail)

  return (
    <section
      className="decision-review-approval-card"
      data-risk={pending.risk}
      data-collapsed={collapsed || undefined}
      aria-label={t('approval.brand')}
    >
      <header className="decision-review-approval-header">
        <div className="decision-review-approval-identity">
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="decision-review-approval-shield"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <span className="decision-review-approval-brand">{t('approval.brand')}</span>
          <span className="decision-review-approval-risk" data-risk={pending.risk}>
            {t(`test.risk.${pending.risk}`)}
          </span>
          <code className="decision-review-approval-tool">{pending.tool}</code>
          {pending.isPtcInner && <span className="decision-review-approval-ptc">{t('approval.ptc')}</span>}
        </div>
        <button
          type="button"
          className="decision-review-approval-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span>{t(collapsed ? 'approval.expand' : 'approval.collapse')}</span>
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="decision-review-approval-chevron"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </header>

      {collapsed ? (
        <p className="decision-review-approval-compact">{reason}</p>
      ) : (
        <div className="decision-review-approval-body">
          {hasActionBody && (
            <div className="decision-review-approval-block">
              <div className="decision-review-approval-block-head">
                <span className="decision-review-approval-block-title">{t('approval.action.title')}</span>
                <span className="decision-review-approval-kind">{actionKindLabel}</span>
                {pending.action.meta?.chars !== undefined && (
                  <span className="decision-review-approval-meta">
                    {t('approval.action.chars', { count: pending.action.meta.chars })}
                  </span>
                )}
              </div>
              {pending.action.target && <div className="decision-review-approval-target">{pending.action.target}</div>}
              {pending.action.detail && (
                <pre className="decision-review-approval-code">
                  <code>{pending.action.detail}</code>
                </pre>
              )}
            </div>
          )}

          <div className="decision-review-approval-block">
            <div className="decision-review-approval-block-head">
              <span className="decision-review-approval-block-title">{t('approval.reason.title')}</span>
            </div>
            <p className="decision-review-approval-reason">{reason}</p>
            {rule && (
              <div className="decision-review-approval-rule">
                <span className="decision-review-approval-rule-tag">{t('approval.rule.label', { n: rule.rule })}</span>
                <span className="decision-review-approval-rule-text">{rule.condition}</span>
              </div>
            )}
          </div>

          {allRows.length > 0 && (
            <div className="decision-review-approval-block">
              <div className="decision-review-approval-block-head">
                <span className="decision-review-approval-block-title">{t('approval.scores.title')}</span>
                {hasHiddenRows && (
                  <button
                    type="button"
                    className="decision-review-approval-more"
                    onClick={() => setShowAllScores((value) => !value)}
                  >
                    {showAllScores ? t('approval.scores.key') : t('approval.scores.all', { count: allRows.length })}
                  </button>
                )}
              </div>
              <div className="decision-review-approval-signals">
                {visibleRows.map((row) => (
                  <SignalMeter key={row.key} t={t} row={row} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SignalMeter({ t, row }: { t: Translate; row: SignalRow }) {
  const tone = row.refused ? 'error' : row.triggered ? (row.direction === 'min' ? 'warn' : 'error') : 'normal'
  const fillPercent = row.value === null ? 0 : clampUnit(row.value) * 100
  const thresholdPercent = row.threshold === null ? null : clampUnit(row.threshold) * 100
  const thresholdHint =
    row.threshold === null
      ? null
      : t(row.direction === 'min' ? 'approval.scores.minThreshold' : 'approval.scores.maxThreshold', {
          value: formatScore(row.threshold),
        })

  return (
    <div className="decision-review-approval-signal" data-tone={tone}>
      <div className="decision-review-approval-signal-row">
        <span className="decision-review-approval-signal-label">{row.label}</span>
        <span className="decision-review-approval-signal-value">
          {row.refused || row.value === null ? (
            t('approval.scores.refused')
          ) : (
            <>
              <strong>{formatScore(row.value)}</strong>
              {thresholdHint && <span className="decision-review-approval-signal-limit"> · {thresholdHint}</span>}
            </>
          )}
        </span>
      </div>
      <div className="decision-review-approval-meter" aria-hidden="true">
        <div className="decision-review-approval-meter-fill" style={{ width: `${fillPercent}%` }} />
        {thresholdPercent !== null && (
          <span className="decision-review-approval-meter-mark" style={{ left: `${thresholdPercent}%` }} />
        )}
      </div>
    </div>
  )
}

interface PendingApprovalHostProps {
  t: Translate
  resolveText: ResolveText
  sessionId?: string
  api: ReviewApi
  pendingApprovalKey?: string
}

/**
 * Portals the Decision Review explanation card into the surrounding `[data-composer-seat]`
 * flex column right above the host's official approval card whenever the host reports a
 * pending approval interaction for this session.
 */
export function PendingApprovalHost({ t, resolveText, sessionId, api, pendingApprovalKey }: PendingApprovalHostProps) {
  const [anchor, setAnchor] = React.useState<HTMLSpanElement | null>(null)
  const [pending, setPending] = React.useState<PendingReview | null>(null)

  React.useEffect(() => {
    if (!sessionId || !pendingApprovalKey) {
      setPending(null)
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    api.getPending(sessionId, signal).then(
      (result) => {
        if (!signal.aborted) setPending(result)
      },
      () => {
        if (!signal.aborted) setPending(null)
      },
    )
    return () => controller.abort()
  }, [api, sessionId, pendingApprovalKey])

  if (!pendingApprovalKey) return null

  const seat = anchor?.closest('[data-composer-seat]') ?? null
  return (
    <>
      <span ref={setAnchor} className="decision-review-approval-anchor" aria-hidden="true" />
      {pending && seat
        ? createPortal(
            <div className="decision-review-approval-slot">
              <PendingApprovalCard key={pending.callId} t={t} resolveText={resolveText} pending={pending} />
            </div>,
            seat,
          )
        : null}
    </>
  )
}
