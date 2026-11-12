import fs from 'node:fs'
import {
  RULE_MAX_CONDITION,
  RULE_MAX_COUNT,
  RULE_MAX_TOTAL,
  RULE_VERDICTS,
  type OperatorRule,
  type PublicSettings,
  type ReviewSettings,
  type SettingsIssue,
  type Threshold,
} from '../shared/contracts.js'
import { errorCode, isRecord } from './json.js'

export const SETTINGS_FILE = 'decision-review.settings.json'

export interface Settings extends ReviewSettings {
  apiKey: string
}

export interface StoredSettings {
  settings: Settings
  problems: StoredProblem[]
  damaged: boolean
}

interface NormalizeOptions {
  strict: boolean
  problems: StoredProblem[]
}

type SettingsDefaults = Omit<Settings, 'rules'>

const SETTINGS_DEFAULTS: SettingsDefaults = {
  engine: 'decisions', // 'decisions' | 'session'
  endpoint: 'https://api.openai.com/v1/decisions',
  apiKey: '',
  model: 'gpt-6-luna',
  timeoutMs: 60000,
  // Where a reviewer denial goes: 'ask' follows the session approval policy
  // (official semantics: ask sessions prompt the user, never sessions final-
  // deny); 'final' always final-denies and feeds the reason back to the model.
  denialRoute: 'ask',
  tConf: 0.75,
  tHighPred: 0.85,
  tMedPred: 0.5,
  tStrongPred: 0.8,
  tAuth: 0.7,
}

const TIMEOUT_MIN_MS = 5000
const TIMEOUT_MAX_MS = 600000

/** Record one rejected stored value. A stored value that had to be replaced
 * stops review (every call that needs it is denied, see `apply`) until valid
 * settings are saved, so the problem list is what the configuration page shows. */
interface StoredProblem {
  issue: SettingsIssue
  detail: string
}

export class SettingsValidationError extends Error {
  constructor(
    readonly issue: SettingsIssue,
    message: string,
  ) {
    super(message)
  }
}

function reportStoredProblem(problems: StoredProblem[], issue: SettingsIssue, detail: string) {
  problems.push({ issue, detail })
  console.warn(`[decision-review] ${detail}`)
}

function normalizeChoice<Field extends 'engine' | 'denialRoute'>(
  value: unknown,
  field: Field,
  choices: readonly SettingsDefaults[Field][],
  { strict, problems }: NormalizeOptions,
): SettingsDefaults[Field] {
  const fallback = SETTINGS_DEFAULTS[field]
  if (value === undefined) return fallback
  const choice = choices.find((candidate) => candidate === value)
  if (choice !== undefined) return choice
  const requirement = `must be one of ${choices.join(', ')}`
  const issue: SettingsIssue = { code: field === 'engine' ? 'engine' : 'denial_route' }
  if (strict) throw new SettingsValidationError(issue, `decision-review: ${field} ${requirement}`)
  reportStoredProblem(problems, issue, `stored ${field} ${requirement}; the default ${fallback} is shown`)
  return fallback
}

function isHttpEndpoint(value: string): boolean {
  if (!/^https?:\/\/[^/\\]/i.test(value) || /[\s\\]/.test(value) || !URL.canParse(value)) return false
  const url = new URL(value)
  return url.hostname !== '' && url.username === '' && url.password === ''
}

/** An absent route uses its default. An invalid stored route stays unset until
 * repaired, so an unrelated save cannot send review to a different destination. */
function normalizeDecisionsRoute(
  value: unknown,
  field: 'endpoint' | 'model',
  { strict, problems }: NormalizeOptions,
): string {
  if (value === undefined) return SETTINGS_DEFAULTS[field]
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized !== '' && (field === 'model' || isHttpEndpoint(normalized))) return normalized
  const requirement = field === 'model' ? 'a non-empty string' : 'an absolute HTTP or HTTPS URL without credentials'
  const issue = { code: field }
  if (strict) throw new SettingsValidationError(issue, `decision-review: ${field} must be ${requirement}`)
  reportStoredProblem(problems, issue, `stored ${field} must be ${requirement}; enter a valid value to resume review`)
  return ''
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** The number a stored or submitted value stands for: a finite number or a
 * plain decimal string (what the settings form sends). Anything else is NaN,
 * so the coercions of `Number()` never decide a setting: `false` and `[]`
 * would become 0, `true` would become 1, and a hostile object can make it
 * throw. */
function numericValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && DECIMAL_NUMBER.test(value.trim())) return Number(value)
  return Number.NaN
}

/** Validate one numeric threshold into [0,1]. Strict mode (user saves) throws;
 * lenient mode (a stored file) falls back to the default and reports it. The
 * messages name the field only: stored values are never echoed. */
function num(value: unknown, fallback: number, field: Threshold, { strict, problems }: NormalizeOptions): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = numericValue(value)
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n
  const issue: SettingsIssue = { code: 'threshold', params: { field } }
  if (strict) throw new SettingsValidationError(issue, `decision-review: ${field} must be a number in [0,1]`)
  reportStoredProblem(problems, issue, `stored ${field} is not a number in [0,1]; the default ${fallback} is shown`)
  return fallback
}

type RuleProblem = { code: 'rule_invalid' | 'rule_count' | 'rule_length' | 'rule_total'; max?: number; detail: string }

/** Accept a bounded rule or return the problem that prevented it from joining the list. */
function normalizeRule(item: unknown, count: number, total: number): OperatorRule | RuleProblem {
  const condition = isRecord(item) && typeof item.condition === 'string' ? item.condition : ''
  const verdict = isRecord(item) ? RULE_VERDICTS.find((candidate) => candidate === item.verdict) : undefined
  if (verdict === undefined || condition.trim() === '') {
    return { code: 'rule_invalid', detail: 'needs a known verdict and a non-empty condition' }
  }
  if (count >= RULE_MAX_COUNT) {
    return { code: 'rule_count', max: RULE_MAX_COUNT, detail: `exceeds the ${RULE_MAX_COUNT}-rule limit` }
  }
  if (condition.length > RULE_MAX_CONDITION) {
    return {
      code: 'rule_length',
      max: RULE_MAX_CONDITION,
      detail: `has a condition longer than ${RULE_MAX_CONDITION} characters`,
    }
  }
  if (total + condition.length > RULE_MAX_TOTAL) {
    return {
      code: 'rule_total',
      max: RULE_MAX_TOTAL,
      detail: `pushes the conditions past ${RULE_MAX_TOTAL} characters in total`,
    }
  }
  return { condition, verdict }
}

/** Normalize the operator rule list. Strict mode (user saves) rejects a bad
 * rule so it can never vanish silently; lenient mode (reading a stored file)
 * drops it and reports it, so a hand-edit typo cannot keep the plugin from
 * loading while review stays stopped until the list is saved again. */
function normalizeRules(raw: unknown, strict: boolean, problems: StoredProblem[]): OperatorRule[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    const issue = { code: 'rules_list' } as const
    if (strict) throw new SettingsValidationError(issue, 'decision-review: rules must be a list')
    reportStoredProblem(problems, issue, 'stored rules are not a list; all rules were ignored')
    return []
  }
  const out: OperatorRule[] = []
  let total = 0
  raw.forEach((item, position) => {
    const rule = normalizeRule(item, out.length, total)
    if ('code' in rule) {
      const n = position + 1
      const issue: SettingsIssue = { code: rule.code, params: rule.max === undefined ? { n } : { n, max: rule.max } }
      if (strict) throw new SettingsValidationError(issue, `decision-review: rule ${n} ${rule.detail}`)
      reportStoredProblem(problems, issue, `stored rule ${n} was dropped: it ${rule.detail}`)
      return
    }
    total += rule.condition.length
    out.push(rule)
  })
  return out
}

/** Validate the request timeout: an integer the Abort timer accepts. */
function normalizeTimeout(value: unknown, strict: boolean, problems: StoredProblem[]): number {
  if (value === undefined || value === null || value === '') return SETTINGS_DEFAULTS.timeoutMs
  const n = numericValue(value)
  if (Number.isInteger(n) && n >= TIMEOUT_MIN_MS && n <= TIMEOUT_MAX_MS) return n
  const issue: SettingsIssue = { code: 'timeout', params: { min: TIMEOUT_MIN_MS, max: TIMEOUT_MAX_MS } }
  if (strict) {
    throw new SettingsValidationError(
      issue,
      `decision-review: timeoutMs must be an integer between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`,
    )
  }
  reportStoredProblem(
    problems,
    issue,
    `stored timeoutMs is not an integer between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}; the default ${SETTINGS_DEFAULTS.timeoutMs} is shown`,
  )
  return SETTINGS_DEFAULTS.timeoutMs
}

/** Merge raw user input over defaults with validation; unknown keys are
 * dropped. `strict` rejects invalid values in validated fields; otherwise
 * they are replaced and each problem is appended to `problems`. */
export function normalizeSettings(
  raw: unknown,
  { strict = false, problems = [] }: Partial<NormalizeOptions> = {},
): Settings {
  const src = isRecord(raw) ? raw : {}
  const mode = { strict, problems }
  const engine = normalizeChoice(src.engine, 'engine', ['decisions', 'session'], mode)
  const endpoint = normalizeDecisionsRoute(src.endpoint, 'endpoint', mode)
  const model = normalizeDecisionsRoute(src.model, 'model', mode)
  const timeoutMs = normalizeTimeout(src.timeoutMs, strict, problems)
  const denialRoute = normalizeChoice(src.denialRoute, 'denialRoute', ['ask', 'final'], mode)
  return {
    engine,
    endpoint,
    apiKey: typeof src.apiKey === 'string' ? src.apiKey : '',
    model,
    timeoutMs,
    denialRoute,
    tConf: num(src.tConf, SETTINGS_DEFAULTS.tConf, 'tConf', mode),
    tHighPred: num(src.tHighPred, SETTINGS_DEFAULTS.tHighPred, 'tHighPred', mode),
    tMedPred: num(src.tMedPred, SETTINGS_DEFAULTS.tMedPred, 'tMedPred', mode),
    tStrongPred: num(src.tStrongPred, SETTINGS_DEFAULTS.tStrongPred, 'tStrongPred', mode),
    tAuth: num(src.tAuth, SETTINGS_DEFAULTS.tAuth, 'tAuth', mode),
    rules: normalizeRules(src.rules, strict, problems),
  }
}

/** Read the stored settings without ever throwing: the configuration page must
 * stay reachable to repair a bad file. Whatever could not be used is listed in
 * `problems` (the plugin denies every call that needs review while any exist), and
 * `damaged` marks a file that could not be read as a settings object at all,
 * which the next save backs up before replacing. A missing file is normal.
 * Problem texts never quote the file: a parse error can carry a snippet of
 * the input, and `problems` reaches the web page, the console, denial reasons
 * and the review trail. */
export function loadSettings(settingsPath: string): StoredSettings {
  let text
  try {
    text = fs.readFileSync(settingsPath, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return { settings: normalizeSettings(undefined), problems: [], damaged: false }
    return damagedSettings(
      { code: 'file_unreadable' },
      `the stored settings file could not be read (${code ?? 'unknown error'}); defaults are shown`,
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return damagedSettings({ code: 'file_json' }, 'the stored settings file is not valid JSON; defaults are shown')
  }
  if (!isRecord(raw)) {
    return damagedSettings(
      { code: 'file_object' },
      'the stored settings file does not hold a JSON object; defaults are shown',
    )
  }
  const problems: StoredProblem[] = []
  return { settings: normalizeSettings(raw, { problems }), problems, damaged: false }
}

function damagedSettings(issue: SettingsIssue, detail: string): StoredSettings {
  const problems: StoredProblem[] = []
  reportStoredProblem(problems, issue, detail)
  return { settings: normalizeSettings(undefined), problems, damaged: true }
}

export function saveSettings(settingsPath: string, next: Settings): void {
  const temp = `${settingsPath}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, settingsPath)
}

/** Settings as the browser may see them: the stored API key never leaves the host. */
export function publicSettings(settings: Settings): PublicSettings {
  const { apiKey, ...visible } = settings
  return { ...visible, hasApiKey: apiKey !== '' }
}

/** Overlay one browser update onto the stored settings. The API key is
 * write-only: an absent or empty `apiKey` keeps the stored one, a non-empty
 * one replaces it, and `clearApiKey: true` removes it. */
export function mergeSettingsUpdate(current: Settings, update: Record<string, unknown>): Record<string, unknown> {
  const { apiKey, clearApiKey, hasApiKey, ...fields } = update
  const merged = { ...current, ...fields }
  if (clearApiKey === true) merged.apiKey = ''
  else if (typeof apiKey === 'string' && apiKey !== '') merged.apiKey = apiKey
  return merged
}
