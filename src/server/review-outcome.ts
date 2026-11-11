import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { DenialExplanation, PredicateName, ReviewDecision } from '../shared/contracts.js'
import { isRecord } from './json.js'

type Locale = 'en' | 'zh'
type DeniedReview = Extract<ReviewDecision, { decision: 'deny' }>
type WhyCode = DenialExplanation['code']
type WhyByCode = { [Code in WhyCode]: Extract<DenialExplanation, { code: Code }> }
type WhyFormatter = { [Code in WhyCode]?: (why: WhyByCode[Code]) => string }

/** Structured error name persisted for every final reviewer denial. */
const AUTO_REVIEW_DENIED_ERROR_NAME = 'AutoReviewDeniedError'
const AUTO_REVIEW_DENIED_CODE = 'AUTO_REVIEW_DENIED'
/** Structured error name persisted when review cannot produce a decision. */
const AUTO_REVIEW_FAILED_ERROR_NAME = 'AutoReviewFailedError'
const AUTO_REVIEW_FAILED_CODE = 'AUTO_REVIEW_FAILED'

/** Localized names for the Decisions predicates. */
const PREDICATE_LABELS: Record<Locale, Record<PredicateName, string> & Partial<Record<string, string>>> = {
  en: {
    exfiltration: 'data exfiltration',
    irreversible_deletion: 'irreversible deletion',
    production_effect: 'production effect',
    security_change: 'security change',
    session_created_cleanup: 'session-created cleanup',
    explicit_authorization: 'explicit authorization',
  },
  zh: {
    exfiltration: '数据外传',
    irreversible_deletion: '不可逆删除',
    production_effect: '影响生产',
    security_change: '安全敏感变更',
    session_created_cleanup: '清理本会话创建的对象',
    explicit_authorization: '明确授权',
  },
}

/** Card-copy score format: two decimals, no trailing zeros. */
function fmtScore(v: number): string {
  return String(Number(Number(v).toFixed(2)))
}

/** Sentence bodies per why code. Card copy explains only the verdict; the
 * card itself renders the pending call through its callId detail slot, so
 * the copy never repeats file paths, commands, or arguments. */
const WHY_TEXT: Record<Locale, WhyFormatter> = {
  en: {
    refused_class: () => 'the reviewer declined to classify the risk',
    exfiltration: (w) => `possible data exfiltration (${fmtScore(w.value)} ≥ ${fmtScore(w.threshold)})`,
    high_class: (w) => `classified as high risk (confidence ${fmtScore(w.confidence)})`,
    conflict: (w) =>
      `classified as low risk (confidence ${fmtScore(w.confidence)}), but ${PREDICATE_LABELS.en[w.pred] ?? 'the medium-risk score'} reaches ${fmtScore(w.value)}`,
    low_confidence: (w) => `classification confidence is low (${fmtScore(w.value)} < ${fmtScore(w.threshold)})`,
    authorization: (w) => {
      const effect = PREDICATE_LABELS.en[w.pred]
      const finding =
        effect === undefined ? 'the call was classified as medium risk' : `${effect} reaches ${fmtScore(w.predValue)}`
      const authorization =
        w.value === null
          ? 'authorization was not assessed'
          : `no explicit authorization (${fmtScore(w.value)} < ${fmtScore(w.threshold)})`
      return `${authorization}; ${finding}`
    },
    authorized_low_confidence: (w) =>
      `authorization seems present, but classification confidence is low (${fmtScore(w.value)} < ${fmtScore(w.threshold)})`,
    refused_predicate: (w) =>
      `the reviewer declined to assess ${w.predicates.map((name) => PREDICATE_LABELS.en[name] ?? name).join(', ')}`,
    rule_ask: (w) => `operator rule matched (${w.condition}) and requires your decision`,
    rule_deny: (w) => `operator rule matched (${w.condition}) and denies this call`,
    rule_unrequested: (w) =>
      w.value === null
        ? `operator rule matched (${w.condition}), but whether you requested this could not be assessed`
        : `operator rule matched (${w.condition}), but you did not explicitly request this (${fmtScore(w.value)} < ${fmtScore(w.threshold)})`,
    session_denied: (w) => `the session reviewer denied this call as ${w.risk} risk${w.reason ? `: ${w.reason}` : ''}`,
  },
  zh: {
    refused_class: () => '评审员拒绝给出风险分类',
    exfiltration: (w) => `疑似数据外传（${fmtScore(w.value)} ≥ ${fmtScore(w.threshold)}）`,
    high_class: (w) => `判定为高风险（置信度 ${fmtScore(w.confidence)}）`,
    conflict: (w) =>
      `分类为低风险（置信度 ${fmtScore(w.confidence)}），但${PREDICATE_LABELS.zh[w.pred] ?? '中风险评分'}达到 ${fmtScore(w.value)}`,
    low_confidence: (w) => `分类置信度偏低（${fmtScore(w.value)} < ${fmtScore(w.threshold)}）`,
    authorization: (w) => {
      const effect = PREDICATE_LABELS.zh[w.pred]
      const finding = effect === undefined ? '此调用被判定为中风险' : `${effect}达到 ${fmtScore(w.predValue)}`
      const authorization =
        w.value === null ? '未能评估明确授权' : `缺少明确授权（${fmtScore(w.value)} < ${fmtScore(w.threshold)}）`
      return `${authorization}；${finding}`
    },
    authorized_low_confidence: (w) => `似有授权，但分类置信度偏低（${fmtScore(w.value)} < ${fmtScore(w.threshold)}）`,
    refused_predicate: (w) =>
      `评审员拒绝评估：${w.predicates.map((name) => PREDICATE_LABELS.zh[name] ?? name).join('、')}`,
    rule_ask: (w) => `命中操作者规则（${w.condition}），需要你裁决`,
    rule_deny: (w) => `命中操作者规则（${w.condition}），已拒绝`,
    rule_unrequested: (w) =>
      w.value === null
        ? `命中操作者规则（${w.condition}），但无法评估你是否明确要求过此操作`
        : `命中操作者规则（${w.condition}），但未见你明确要求此操作（${fmtScore(w.value)} < ${fmtScore(w.threshold)}）`,
    session_denied: (w) =>
      `会话评审员判定为${w.risk === 'high' ? '高' : '中'}风险并拒绝${w.reason ? `：${w.reason}` : ''}`,
  },
}

/** Localized basis for one verdict, without asking the reader to approve it. */
export function localizedWhy<Code extends WhyCode>(
  why: (WhyByCode[Code] & { code: Code }) | null | undefined,
  locale: Locale,
): string {
  if (why != null) {
    const describe = (WHY_TEXT[locale] ?? WHY_TEXT.en)[why.code]
    if (describe !== undefined) return describe(why)
  }
  return locale === 'zh' ? '评审员未通过此调用' : 'the reviewer did not approve this call'
}

/** Localized one-line card headline for an approval request. */
export function humanWhy(why: DenialExplanation | null | undefined, locale: Locale): string {
  const body = localizedWhy(why, locale)
  return locale === 'zh' ? `决策评审请你确认：${body}。` : `Decision review asks you to confirm: ${body}.`
}

/** Materialize the fixed model-facing final Auto denial plus optional UI detail. */
export function denied(exec: ToolExecution, reason?: string): PreToolDecision {
  return {
    kind: 'deny',
    reason: `Auto review rejected tool "${exec.name}"; its body was not executed`,
    info: {
      name: AUTO_REVIEW_DENIED_ERROR_NAME,
      code: AUTO_REVIEW_DENIED_CODE,
      ...(reason === undefined ? {} : { reason }),
    },
  }
}

/** Compact localized pending-call line for tools whose card detail the Chat
 * approval slot cannot draw (it renders only bash command arguments). */
function describePendingLine(exec: ToolExecution, locale: Locale): string {
  const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
  const fields = isRecord(args) ? args : {}
  const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…(+${s.length - n} chars)` : s)
  const label = locale === 'zh' ? '待审调用' : 'Pending call'
  const name = exec.name
  if (name === 'bash' && typeof fields.command === 'string') return '' // the card draws the command itself
  if (name === 'write' || name === 'edit') {
    const size = typeof fields.content === 'string' ? ` (${fields.content.length} chars)` : ''
    return `${label}: ${name} ${fields.file_path ?? fields.path ?? '?'}${size}`
  }
  if (name === 'web_fetch' && typeof fields.url === 'string') return `${label}: web_fetch ${trunc(fields.url, 200)}`
  if (name === 'web_search' && Array.isArray(fields.queries))
    return `${label}: web_search ${trunc(fields.queries.join(' | '), 200)}`
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return `${label}: mcp ${parts[1] ?? '?'}/${parts.slice(2).join('__')} ${trunc(JSON.stringify(args), 200)}`
  }
  const rendered = JSON.stringify(args)
  if (rendered && rendered !== '{}') return `${label}: ${name} ${trunc(rendered, 200)}`
  return `${label}: ${name}`
}

/** Ask the user to decide one medium-risk call. The card renders bash commands
 * itself (callId detail slot), so bash copy carries only the verdict; other
 * tools get a compact pending-call line. The model-facing reason stays
 * English with the raw predicate scores. */
export function askUser(exec: ToolExecution, decision: DeniedReview): PreToolDecision {
  const content = { en: describePendingLine(exec, 'en'), zh: describePendingLine(exec, 'zh') }
  return {
    kind: 'ask',
    reason: `Auto review deferred tool "${exec.name}" to the user: ${decision.reason}`,
    displayReason: {
      en: `${humanWhy(decision.why, 'en')} ${content.en}`.trim(),
      zh: `${humanWhy(decision.why, 'zh')} ${content.zh}`.trim(),
    },
  }
}

/** The verdict used while the stored settings are invalid. The plugin cannot
 * tell whether the call would have matched a deny rule, so it is closed with a
 * final denial (`final`) in every session: never an approval card the user
 * could accept. */
export function settingsInvalidDecision(problems: string[]): DeniedReview {
  return {
    risk: 'medium',
    decision: 'deny',
    final: true,
    reason: `stored settings are invalid, so this call cannot be reviewed; fix them on the plugin page: ${problems.join('; ')}`,
    why: { code: 'settings_invalid', problems },
  }
}

/** Materialize a reviewer failure as its own error rather than a denial. */
export function failed(exec: ToolExecution, error: unknown): PreToolDecision {
  const message = error instanceof Error ? error.message : String(error)
  return {
    kind: 'deny',
    reason: `Auto review of tool "${exec.name}" failed; its body was not executed: ${message}`,
    info: { name: AUTO_REVIEW_FAILED_ERROR_NAME, code: AUTO_REVIEW_FAILED_CODE },
  }
}
