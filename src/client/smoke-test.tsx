/** @jsxRuntime classic */
import * as React from 'react'
import { TEST_SCENARIO_NAMES, type TestResult } from '../shared/contracts.js'
import { TechnicalDetails } from './components.js'
import type { ResolveText, Translate } from './messages.js'
import { Button } from './ui/button.js'

interface SmokeResultsProps {
  t: Translate
  resolveText: ResolveText
  results: TestResult[]
}

function SmokeResults({ t, resolveText, results }: SmokeResultsProps) {
  return (
    <div className="decision-review-smoke-table-wrap">
      <table className="decision-review-smoke-table">
        <thead>
          <tr>
            {(['test.scenario', 'test.ms', 'test.verdict', 'test.basis'] as const).map((key) => (
              <th key={key} scope="col" className={key === 'test.ms' ? 'decision-review-smoke-ms' : undefined}>
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((result) => {
            const { scenario } = result
            const composed = result.ok ? result.composed : undefined
            const scenarioKey = TEST_SCENARIO_NAMES.includes(scenario) ? scenario : 'unknown'
            const verdict = composed ? (composed.decision === 'allow' ? 'allow' : 'deny') : 'error'
            const risk = composed && ['low', 'medium', 'high'].includes(composed.risk) ? composed.risk : 'unknown'
            const rule = composed?.why?.code === 'rule_allow' ? composed.why : null
            const display = composed?.display ? resolveText(composed.display) : null
            const reason =
              display || (rule ? t('test.basis.rule_allow', { condition: rule.condition }) : t(`test.basis.${verdict}`))
            return (
              <tr key={scenario}>
                <td className="decision-review-smoke-scenario">{t(`test.scenario.${scenarioKey}`)}</td>
                <td className="decision-review-smoke-ms">{result.ok ? String(result.ms) : '—'}</td>
                <td className="decision-review-smoke-verdict-cell">
                  <span className="decision-review-smoke-badge" data-verdict={verdict}>
                    {t(`test.verdict.${verdict}`)}
                  </span>
                  {result.ok && (
                    <span className="decision-review-smoke-risk" data-risk={risk}>
                      {t(`test.risk.${risk}`)}
                    </span>
                  )}
                </td>
                <td className="decision-review-smoke-reason">
                  <div>{reason}</div>
                  <TechnicalDetails
                    t={t}
                    detail={result.ok ? (display || rule ? null : result.composed.reason) : result.error}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface SmokeTestProps extends Omit<SmokeResultsProps, 'results'> {
  isDecisions: boolean
  dirty: boolean
  saving: boolean
  running: boolean
  onRun: () => void
  results: TestResult[] | null
}

export function SmokeTest({ t, resolveText, isDecisions, dirty, saving, running, onRun, results }: SmokeTestProps) {
  const disabled = running || saving || !isDecisions || dirty
  return (
    <section className="decision-review-card decision-review-smoke">
      <div className="decision-review-section-header">
        <h2 className="decision-review-section-title">{t('test.title')}</h2>
        <p className="decision-review-field-description">{t('test.desc')}</p>
      </div>
      <div className="decision-review-smoke-actions">
        <Button variant="outline" onClick={onRun} disabled={disabled}>
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
          >
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
          {running ? t('test.running') : t('test.run', { count: TEST_SCENARIO_NAMES.length })}
        </Button>
        {!isDecisions ? (
          <span className="decision-review-field-description">{t('test.sessions')}</span>
        ) : dirty ? (
          <span className="decision-review-field-description">{t('test.unsaved')}</span>
        ) : null}
      </div>
      {isDecisions && results?.length ? <SmokeResults t={t} resolveText={resolveText} results={results} /> : null}
    </section>
  )
}
