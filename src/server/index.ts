/**
 * Host entry point for profile-installed decision review.
 * The host injects its services; the built plugin has no host runtime imports.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionStartSource } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { decisionsClassifyRisk } from './decisions-engine.js'
import { AUTO_PRESENTATION, askUser, denied, failed, settingsInvalidDecision } from './review-outcome.js'
import { guarded, reviewRoutes } from './routes.js'
import { sessionClassifyRisk } from './session-engine.js'
import { loadSettings, SETTINGS_FILE } from './settings.js'
import { snapshotAutoReview, type ShownSchemas } from './snapshot.js'
import { createReviewTrail, type ReviewRoute } from './trail.js'

export { decisionsMessages, toComposeInput, validateAnswers } from './decisions-engine.js'
export { humanWhy } from './review-outcome.js'
export { readDecision } from './session-engine.js'
export { normalizeSettings } from './settings.js'
export { createReviewTrail } from './trail.js'
export { composeDecision } from './verdict.js'

export const name = 'decision-review'
export const inject = ['approval', 'llm', 'permissionPresets', 'sessions', 'tools', 'workingDirectory']

const AUTO_PRESET = 'auto'
// FiberState.ACTIVE in the host's Cordis runtime. Profile bundles cannot import it.
const CORDIS_FIBER_ACTIVE = 2
const RUN_CODE_NAME = 'run_code'
/** Structurally side-effect-free tools: never reviewed, always delegated. */
const READ_ONLY_TOOLS = new Set(['read', 'read_image', 'grep', 'glob', 'skill'])

/** Resolve the active profile directory: the host's profile context first
 * (it names the profile this host actually runs), then an explicit
 * DSH_PROFILE_DIR override, then the legacy desktop default. */
function resolveProfileDir(ctx: Context): string {
  const profile = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined
  const dir =
    (typeof profile?.dir === 'string' && profile.dir !== '' ? profile.dir : undefined) ||
    process.env.DSH_PROFILE_DIR ||
    (process.env.HOME ? `${process.env.HOME}/.dsh/profiles/desktop` : undefined)
  if (!dir) throw new Error('decision-review: no profile directory (no host profile context, DSH_PROFILE_DIR, or HOME)')
  return dir
}

/** Read live abort state across awaits without relying on stale narrowing. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function isUnchosenMainSession(session: Session, source: SessionStartSource): boolean {
  const { origin, parentSession, isSeeded } = session.header
  return source === 'startup' && origin !== 'subagent' && parentSession === undefined && !isSeeded && session.seq === 0
}

export function apply(ctx: Context): void {
  const permissionPresets = ctx.permissionPresets
  const profileDirectory = resolveProfileDir(ctx)
  const settingsPath = `${profileDirectory}/${SETTINGS_FILE}`
  const trail = createReviewTrail(profileDirectory)
  // `problems` lists stored values that had to be replaced; while it is not
  // empty, review is stopped and calls that need it are denied (see the pre-execute listener).
  const holder = loadSettings(settingsPath)
  let accepting = true
  const active = new Set<Promise<void>>()
  const lifecycle = new AbortController()
  const shownBySession = new WeakMap<Session, ShownSchemas>()

  const routes = reviewRoutes(settingsPath, holder, trail, () => ({ accepting, active: active.size }), lifecycle)

  ctx.effect(function* () {
    const stopListener = ctx.on(
      'tools/pre-execute',
      async (exec, next): Promise<PreToolDecision> => {
        const agent = exec.agent
        if (agent === undefined || (exec.parent === undefined && exec.name === RUN_CODE_NAME)) return next()
        if (permissionPresets.current(agent.session) !== AUTO_PRESET) return next()
        if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }

        const completed = Promise.withResolvers<void>()
        active.add(completed.promise)
        try {
          const { settings, problems } = holder
          const signal = AbortSignal.any([exec.signal, lifecycle.signal])
          let shown = shownBySession.get(agent.session)
          if (shown === undefined) {
            shown = new Map()
            shownBySession.set(agent.session, shown)
          }
          // Structurally read-only calls have no side effects to judge; keep the
          // shown-schema memory consistent for later history prefixes, then skip
          // the reviewer entirely (latency, tokens, and refusal ask-spam).
          if (READ_ONLY_TOOLS.has(exec.name)) {
            const cwd = await ctx.workingDirectory.ensure(agent, signal)
            const snapshot = snapshotAutoReview(agent, exec, cwd, shown)
            shown.set(snapshot.pending.key, snapshot.pending.schema)
            return next()
          }
          // Invalid stored settings stop review: nothing is allowed on the
          // strength of values that were replaced by defaults, and nothing can be
          // sent to the user either (see settingsInvalidDecision).
          const review =
            problems.length > 0
              ? {
                  ok: true as const,
                  value: {
                    decision: settingsInvalidDecision(problems.map(({ detail }) => detail)),
                    telemetry: { ms: 0, answers: null, usage: null },
                  },
                }
              : await (
                  settings.engine === 'session'
                    ? sessionClassifyRisk(ctx, agent, exec, signal, shown, settings)
                    : decisionsClassifyRisk(ctx, agent, exec, signal, shown, settings)
                ).then(
                  (value) => ({ ok: true as const, value }),
                  (error: unknown) => ({ ok: false as const, error }),
                )
          if (isAborted(lifecycle.signal)) return { kind: 'cancel' }
          if (!review.ok) {
            trail.record({
              event: 'review',
              session: agent.session.id,
              engine: settings.engine,
              tool: exec.name,
              callId: exec.callId,
              route: 'fail',
              error: review.error instanceof Error ? review.error.message : String(review.error),
            })
            return failed(exec, review.error)
          }
          const { decision, telemetry } = review.value
          const record = (route: ReviewRoute, downstreamKind?: PreToolDecision['kind']) =>
            trail.record({
              event: 'review',
              session: agent.session.id,
              engine: settings.engine,
              tool: exec.name,
              callId: exec.callId,
              route,
              ms: telemetry.ms,
              decision,
              answers: telemetry.answers,
              usage: telemetry.usage,
              ...(downstreamKind === undefined ? {} : { downstream: downstreamKind }),
            })
          if (decision.decision === 'deny') {
            // Denial routing: 'final' always closes here (reason feeds back to the
            // model, which may adapt); 'ask' defers to the session approval policy
            // — ask sessions prompt the user, never sessions final-deny. A matched
            // operator deny rule (`hardDeny`) and a decision made without trusted
            // settings (`final`) always close here, whatever else was found.
            const routeFinal =
              settings.denialRoute === 'final' ||
              ctx.approval.overrideOf(agent.session) === 'never' ||
              decision.hardDeny !== undefined ||
              decision.final === true
            if (routeFinal) {
              record('final')
              return denied(exec, decision.reason)
            }
          }
          const downstream = await next()
          if (isAborted(lifecycle.signal)) return { kind: 'cancel' }
          // The trail records outcomes: a call another layer denied or deferred
          // is not an auto-pass, whatever the reviewer's own verdict was.
          if (downstream.kind !== 'allow') {
            record(downstream.kind === 'ask' ? 'ask' : 'final', downstream.kind)
            return downstream
          }
          if (decision.decision === 'allow') {
            record('allow')
            return downstream
          }
          record('ask')
          return askUser(exec, decision)
        } finally {
          active.delete(completed.promise)
          completed.resolve()
        }
      },
      { prepend: true },
    )
    yield stopListener

    // The pinned host reads only the first argument; retain presentation for hosts that accept it.
    const registerAuto: (
      admit: () => void,
      presentation: typeof AUTO_PRESENTATION,
    ) => ReturnType<typeof permissionPresets.registerAuto> = permissionPresets.registerAuto.bind(permissionPresets)
    const stopContribution = registerAuto(() => {
      if (!accepting) throw new Error('decision-review: integration is closing')
    }, AUTO_PRESENTATION)
    yield stopContribution

    // Agent creation runs after the Session is writable and setup has settled.
    // Prepend puts this dependent listener ahead of the provider's initial
    // permission pin. Any prior record, including an empty restore's end-seed
    // marker or a choice recorded by setup, rules out the new-session default.
    yield ctx.on(
      'agent/created',
      ({ agent, source, signal }) => {
        if (!accepting || signal?.aborted || !isUnchosenMainSession(agent.session, source)) return
        permissionPresets.set(agent.session, AUTO_PRESET)
      },
      { prepend: true },
    )

    // Observe the approval waterfall without answering: each settled ask
    // feeds the per-session approval stats served to the composer dock chip.
    yield ctx.on('approval/request', async (req, next) => {
      const outcome = await next()
      trail.record({
        event: 'approval',
        session: String(req.agent.session.id).replace(/^session-/, ''),
        tool: req.toolName,
        callId: req.callId,
        outcome,
      })
      return outcome
    })

    yield async () => {
      accepting = false
      try {
        // Root unload begins before child cleanup; only live plugin removal changes Session policy.
        if (ctx.root.fiber.state === CORDIS_FIBER_ACTIVE) {
          for (const session of ctx.sessions.list()) {
            if (permissionPresets.current(session) !== AUTO_PRESET) continue
            permissionPresets.set(session, 'danger-full-access')
          }
        }
      } finally {
        lifecycle.abort(new Error('decision-review integration disposed'))
        await Promise.allSettled([...active])
      }
    }
  }, 'decision-review lifecycle')

  // Mount the routes inside the host Connection's authentication fence; they
  // exist only while that service does.
  ctx.inject(['connection'], (scope) => {
    for (const route of routes) {
      scope.effect(
        () =>
          scope.connection.fetch.register({
            path: route.path,
            methods: route.methods,
            requestBody: 'buffered',
            fetch: guarded(route.handle),
          }),
        `decision-review: ${route.path}`,
      )
    }
  })

  if (holder.problems.length > 0) {
    console.warn(
      `[decision-review] review is STOPPED and calls that need it are denied until valid settings are saved from the plugin page: ${holder.problems.map(({ detail }) => detail).join('; ')}`,
    )
  }
  console.info(`[decision-review] ready: engine=${holder.settings.engine} endpoint=${holder.settings.endpoint}`)
}
