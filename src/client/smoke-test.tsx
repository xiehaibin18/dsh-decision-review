/** @jsxRuntime classic */
import * as React from 'react'
import { TEST_SCENARIO_NAMES, type TestResult } from '../shared/contracts.js'
import { TechnicalDetails } from './components.js'
import { Button } from './ui/button.js'
import type { ResolveText, Translate } from './messages.js'
import { BORDER, DANGER, HEADING, MUTED, NOTE, ROW, STACK } from './styles.js'

interface SmokeResultsProps {
  t: Translate
  resolveText: ResolveText
  results: TestResult[]
}

const CELL: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'start',
  verticalAlign: 'top',
  overflowWrap: 'anywhere',
}

function SmokeResults({ t, resolveText, results }: SmokeResultsProps) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {(['test.scenario', 'test.ms', 'test.verdict', 'test.basis'] as const).map((key) => (
            <th key={key} scope="col" style={CELL}>
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
            <tr key={scenario} style={{ borderTop: '1px solid ' + BORDER }}>
              <td style={CELL}>{t(`test.scenario.${scenarioKey}`)}</td>
              <td style={CELL}>{result.ok ? String(result.ms) : '—'}</td>
              <td style={CELL}>
                <div style={{ fontWeight: 600, color: verdict === 'error' ? DANGER : 'inherit' }}>
                  {t(`test.verdict.${verdict}`)}
                </div>
                {result.ok && <div style={NOTE}>{t(`test.risk.${risk}`)}</div>}
              </td>
              <td style={{ ...CELL, color: MUTED, whiteSpace: 'pre-wrap' }}>
                {reason}
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
    <section style={{ ...STACK, borderTop: '1px solid ' + BORDER, paddingTop: 14 }}>
      <h2 style={HEADING}>{t('test.title')}</h2>
      <p style={NOTE}>{t('test.desc')}</p>
      <div style={ROW}>
        <Button variant="outline" onClick={onRun} disabled={disabled}>
          {running ? t('test.running') : t('test.run', { count: TEST_SCENARIO_NAMES.length })}
        </Button>
        {!isDecisions ? (
          <span style={NOTE}>{t('test.sessions')}</span>
        ) : dirty ? (
          <span style={NOTE}>{t('test.unsaved')}</span>
        ) : null}
      </div>
      {isDecisions && results?.length ? <SmokeResults t={t} resolveText={resolveText} results={results} /> : null}
    </section>
  )
}
