import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { DenialExplanation, PredicateName, ReviewDecision } from '../shared/contracts.js'
import { isRecord } from './json.js'

type Locale = 'en' | 'zh'
type DeniedReview = Extract<ReviewDecision, { decision: 'deny' }>
type WhyCode = DenialExplanation['code']
type WhyByCode = { [Code in WhyCode]: Extract<DenialExplanation, { code: Code }> }
type WhyFormatter = { [Code in WhyCode]: (why: WhyByCode[Code]) => string }

/** Structured error name persisted for every final reviewer denial. */
const AUTO_REVIEW_DENIED_ERROR_NAME = 'AutoReviewDeniedError'
const AUTO_REVIEW_DENIED_CODE = 'AUTO_REVIEW_DENIED'
/** Structured error name persisted when review cannot produce a decision. */
const AUTO_REVIEW_FAILED_ERROR_NAME = 'AutoReviewFailedError'
const AUTO_REVIEW_FAILED_CODE = 'AUTO_REVIEW_FAILED'

/** Localized names for the Decisions predicates. */
const PREDICATE_LABELS: Record<Locale, Record<PredicateName, string>> = {
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

function predicateLabel(locale: Locale, name: string): string | undefined {
  const labels: Partial<Record<string, string>> = PREDICATE_LABELS[locale]
  return Object.hasOwn(labels, name) ? labels[name] : undefined
}

export const AUTO_PRESENTATION = {
  description: {
    en: 'Decision Review checks tool calls in Auto mode with the configured review engine.',
    zh: '决策评审使用已配置的引擎评审 Auto 模式下的工具调用。',
  },
  confirmationDescription: {
    en: 'Auto can run approved tool calls with full host access, subject to the host’s permission checks. Decisions sends the review context and pending call to the configured API endpoint and model. Follow session sends a separate review request using the current session’s model route.',
    zh: 'Auto 模式下，通过宿主权限检查的调用可使用完整的宿主访问权限。Decisions 会把评审上下文和待评审的调用发送到配置的 API 地址和模型；「跟随会话」使用当前会话的模型路由，单独发起评审请求。',
  },
}

const APPROVAL_TEXT = {
  en: {
    fallback: 'the reviewer did not approve this call',
    headline: (body: string) => `Decision Review requests your approval: ${body}`,
    pending: (call: string) => `Pending call: ${call}`,
    length: (length: number) => ` (${length} characters)`,
    truncated: (length: number) => `… (${length} more characters)`,
  },
  zh: {
    fallback: '评审未放行此调用',
    headline: (body: string) => `决策评审请你决定是否放行：${body}`,
    pending: (call: string) => `待评审的调用：${call}`,
    length: (length: number) => `（${length} 个字符）`,
    truncated: (length: number) => `…（另有 ${length} 个字符）`,
  },
}

/** Sentence bodies per why code. Card copy explains only the verdict; the
 * card itself renders the pending call through its callId detail slot, so
 * the copy never repeats file paths, commands, or arguments. */
const WHY_TEXT: Record<Locale, WhyFormatter> = {
  en: {
    refused_class: () => 'the model did not return a risk classification, so the call was treated as high risk',
    exfiltration: (w) => `possible data exfiltration (${w.value} ≥ ${w.threshold})`,
    high_class: (w) => `classified as high risk (confidence ${w.confidence})`,
    conflict: (w) =>
      `classified as low risk (confidence ${w.confidence}), but ${predicateLabel('en', w.pred) ?? 'the medium-risk score'} reaches ${w.value}`,
    low_confidence: (w) => `classification confidence is low (${w.value} < ${w.threshold})`,
    authorization: (w) => {
      const effect = predicateLabel('en', w.pred)
      const finding =
        effect === undefined ? 'the call was classified as medium risk' : `${effect} reaches ${w.predValue}`
      const authorization =
        w.value === null
          ? 'the model did not return an authorization score'
          : `the explicit authorization score is below the threshold (${w.value} < ${w.threshold})`
      return `${authorization}; ${finding}`
    },
    authorized_low_confidence: (w) =>
      `the authorization score meets the threshold, but classification confidence is low (${w.value} < ${w.threshold})`,
    refused_predicate: (w) =>
      `the review model did not return scores for ${w.predicates.map((name) => predicateLabel('en', name) ?? name).join(', ')}`,
    rule_ask: (w) => `a matching custom rule requests approval: ${w.condition}`,
    rule_deny: (w) => `a matching custom rule denies this call: ${w.condition}`,
    rule_unrequested: (w) =>
      w.value === null
        ? `the model did not return the explicit authorization score required by this custom rule: ${w.condition}`
        : `the explicit authorization score for this custom rule is below the threshold (${w.value} < ${w.threshold}): ${w.condition}`,
    session_denied: (w) => `the session model denied this call as ${w.risk} risk${w.reason ? `: ${w.reason}` : ''}`,
    settings_invalid: () => 'the saved settings are invalid; fix them and save to resume review',
  },
  zh: {
    refused_class: () => '模型未返回风险分类，因此按高风险处理',
    exfiltration: (w) => `疑似数据外传（${w.value} ≥ ${w.threshold}）`,
    high_class: (w) => `判定为高风险（置信度 ${w.confidence}）`,
    conflict: (w) =>
      `分类为低风险（置信度 ${w.confidence}），但${predicateLabel('zh', w.pred) ?? '中风险评分'}达到 ${w.value}`,
    low_confidence: (w) => `分类置信度偏低（${w.value} < ${w.threshold}）`,
    authorization: (w) => {
      const effect = predicateLabel('zh', w.pred)
      const finding = effect === undefined ? '此调用被判定为中风险' : `${effect}达到 ${w.predValue}`
      const authorization =
        w.value === null ? '模型未返回授权分数' : `明确授权分数低于阈值（${w.value} < ${w.threshold}）`
      return `${authorization}；${finding}`
    },
    authorized_low_confidence: (w) => `授权分数已达标，但分类置信度偏低（${w.value} < ${w.threshold}）`,
    refused_predicate: (w) =>
      `评审模型未返回以下分数：${w.predicates.map((name) => predicateLabel('zh', name) ?? name).join('、')}`,
    rule_ask: (w) => `命中的自定义规则要求人工审批：${w.condition}`,
    rule_deny: (w) => `命中的自定义规则拒绝了此调用：${w.condition}`,
    rule_unrequested: (w) =>
      w.value === null
        ? `模型未返回这条自定义规则要求的明确授权分数：${w.condition}`
        : `明确授权分数低于这条自定义规则要求的阈值（${w.value} < ${w.threshold}）：${w.condition}`,
    session_denied: (w) =>
      `会话模型将此调用判为${w.risk === 'high' ? '高' : '中'}风险并拒绝${w.reason ? `：${w.reason}` : ''}`,
    settings_invalid: () => '已保存的设置无效；请修正并保存以恢复评审',
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
  return APPROVAL_TEXT[locale].fallback
}

/** Localized one-line card headline for an approval request. */
export function humanWhy(why: DenialExplanation | null | undefined, locale: Locale): string {
  return APPROVAL_TEXT[locale].headline(localizedWhy(why, locale))
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
  const copy = APPROVAL_TEXT[locale]
  const truncate = (value: string) =>
    value.length > 200 ? value.slice(0, 200) + copy.truncated(value.length - 200) : value
  const name = exec.name
  if (name === 'bash' && typeof fields.command === 'string') return '' // the card draws the command itself
  if (name === 'write' || name === 'edit') {
    const size = typeof fields.content === 'string' ? copy.length(fields.content.length) : ''
    return copy.pending(`${name} ${fields.file_path ?? fields.path ?? '?'}${size}`)
  }
  if (name === 'web_fetch' && typeof fields.url === 'string') return copy.pending(`web_fetch ${truncate(fields.url)}`)
  if (name === 'web_search' && Array.isArray(fields.queries))
    return copy.pending(`web_search ${truncate(fields.queries.join(' | '))}`)
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return copy.pending(`mcp ${parts[1] ?? '?'}/${parts.slice(2).join('__')} ${truncate(JSON.stringify(args))}`)
  }
  const rendered = JSON.stringify(args)
  return copy.pending(rendered && rendered !== '{}' ? `${name} ${truncate(rendered)}` : name)
}

/** Show the localized approval prompt while retaining the raw reason for the model. */
export function askUser(exec: ToolExecution, decision: DeniedReview): PreToolDecision {
  function prompt(locale: Locale) {
    const headline = humanWhy(decision.why, locale)
    const pending = describePendingLine(exec, locale)
    return pending === '' ? headline : `${headline}\n${pending}`
  }

  return {
    kind: 'ask',
    reason: `Auto review deferred tool "${exec.name}" to the user: ${decision.reason}`,
    displayReason: { en: prompt('en'), zh: prompt('zh') },
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
