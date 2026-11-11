# @local/decision-review

Fork of `@deepseek-ai/dsh-experimental-auto-review` with a pluggable review engine, configured from the Web plugins page.
The upstream copyright and MIT license are preserved in [LICENSE.upstream](LICENSE.upstream).

## Engines

| engine | reviewer | judgment |
|---|---|---|
| `decisions` (default) | OpenAI Decisions API (`gpt-6-luna`), independent second opinion | 7 typed questions (1 choice + 6 predicates) over the same frozen snapshot the official plugin builds; deterministic policy composition in `composeDecision()` (v0.5). Illegal verdicts (`high+allow`) are unrepresentable by construction. |
| `session` | the session's own route/model (official mirror) | the official review projection and strict risk/decision protocol, with the same effective-authorization policy as the Decisions engine. The stream is read with a port of the host's block assembler (`block-start` / `text-delta` / `reasoning-delta` / `block-end` / `finish`), because profile bundles cannot import `@deepseek-ai/*`. A bare denial becomes a localized approval ask instead of an error. |

Both engines consume the same complete `snapshotAutoReview` projection (including the `shown` schema memory). Pending arguments, current tool schemas, instruction history, authorization, and restrictions are retained without a reduced-input mode. Tool outputs, assistant prose, and reasoning stay excluded from the review input. Both engines bound each review with `timeoutMs`; a timeout fails closed (`AUTO_REVIEW_FAILED`).

Both reviewers are instructed to use the same effective-authorization policy in Session order: later instructions revoke or replace earlier authority only when they explicitly say so; unresolved conflicts block medium-risk approval. A direct-parent instruction can authorize a child task but cannot override a user restriction. Constraints only narrow scope, and checkpoints, tool schemas, tool-call facts, and source metadata cannot grant authorization. Authorization must cover the actual action, target, effects, scope, count, and duration. No instruction can authorize a high-risk action.

## Configuration

Settings live in `<profile>/decision-review.settings.json` (plaintext, mode `0600`, written atomically on first save) and are edited live from the plugin's detail page in the Web UI — writes apply to the next review without a reload. Fields: `engine`, `endpoint`, `apiKey`, `model`, `timeoutMs` (integer, 5000–600000), `denialRoute`, thresholds `tConf` / `tHighPred` / `tMedPred` / `tStrongPred` / `tAuth`, `rules`.

The retired `stateBudget` field in an older file is ignored and removed on the next save; it cannot enable truncation.

Saving is strict: an invalid endpoint or model, an invalid rule, an out-of-range threshold or `timeoutMs`, or an oversized request is rejected with an explanation and nothing is written.

`endpoint` and `model` default only when omitted. Explicit invalid values, including wrong types and blank strings, are rejected. Endpoints must be absolute HTTP(S) URLs without embedded credentials; invalid stored endpoint/model values pause review and must be repaired before reviews or smoke tests can send requests. They are shown blank rather than replaced by a different destination. The repair inputs remain visible even in Session mode until a valid save.

Thresholds and `timeoutMs` accept only a finite number or a plain decimal string (what the form sends); other types (`false`, `true`, `[]`, objects) are rejected rather than coerced.

Reaching `tHighPred` produces a high-risk reviewer denial, not necessarily a final denial. It still follows `denialRoute` and the session approval policy; a matched operator `deny` rule forces final denial regardless of that routing.

`engine` and `denialRoute` use their defaults when omitted. An unrecognized value is rejected on save and stops review when found in stored settings, so a typo cannot switch the reviewer, change the data sent for review, or loosen denial routing.

Loading a hand-edited file never stops the plugin from starting, so the configuration page stays reachable to repair it. A value that cannot be used (a threshold outside [0,1] or of the wrong type, a bad `timeoutMs`, a rule that fails validation, a file that is not valid JSON) is replaced or dropped and listed in a notice on the page and in `GET /config` (`problems`), and **stops review**. The plugin can no longer tell whether a call would have matched a deny rule, so every call that would need review is denied outright, in every session and whatever `denialRoute` says; it never becomes an approval card. Read-only tools still bypass review as usual. Saving valid settings from the page clears the notice and resumes review. Problem texts name the setting but never quote the file or the rejected value, because they reach the web page, the console, denial reasons and the review trail. If the file was not readable as a settings object, the next save first copies it to `decision-review.settings.json.invalid-<timestamp>`, so the stored key is not lost. Hand edits take effect after a plugin reload.

### HTTP API

The detail page talks to the host's authenticated Connection service (`connection.fetch`), not to the unauthenticated web-server resource routes, so all calls require the logged-in browser session (Host/Origin check, cookie, owner principal). Responses are `Cache-Control: no-store`; write routes require `Content-Type: application/json` and cap the body at 64 KiB.

| route | purpose |
|---|---|
| `GET /api/decision-review/config` | current settings; the API key is never returned, only `hasApiKey`; `problems` lists stored values that were replaced (review is stopped while it is not empty) |
| `POST /api/decision-review/save` | `{settings}` — validate strictly, merge, persist. The key is write-only: an absent or empty `apiKey` keeps the stored one, a non-empty one replaces it, `clearApiKey: true` removes it |
| `GET /api/decision-review/stats?session=<id>` | per-session approval counts for the dock pill |
| `POST /api/decision-review/test` | smoke test; optional `{scenarios: [...]}` of distinct built-in names (benign / exfiltration / plugin install), runs against the saved settings only |

`denialRoute` chooses where a reviewer denial goes: `ask` (default, official semantics) follows the session approval policy — `ask` sessions prompt the user, `never` sessions final-deny; `final` always final-denies and feeds the reason back to the model, which may adapt with a fresh (re-reviewed) call.

The detail page's smoke test runs three synthetic scenarios through the decisions engine and shows per-scenario verdicts, latency, and the composed decision. It reads one settings snapshot per run, honours the timeout and cancellation, and reports an upstream failure as a failed row instead of failing the whole run. The button is disabled while the form has unsaved edits, so it never tests values other than the ones in effect.

Every reviewed call appends one record to `<profile>/decision-review.log.jsonl` (mode `0600`, rotated at 8 MB, one predecessor kept): engine, tool, route (`allow`/`ask`/`final`/`fail`), latency, the composed verdict with structured `why`, and — decisions engine only — the raw per-predicate answers including refusals, plus token usage. Read-only fast-path calls and smoke tests are not logged. The recorded route reflects what actually happened after the rest of the approval chain: a reviewer verdict that a later layer overrode is not counted as an auto-pass.

The bundle also observes the `approval/request` waterfall without answering, appending one `approval` record per settled ask. The stats route folds the trail (including one rotated predecessor) into per-session counts, and the composer dock (slot `conversation.composer.dock`, entry `decision-review-approvals`) renders `自动审批 N · 通过率 P%` from it, polling every 4 s and staying hidden until the session has at least one reviewed call. The pass rate is the reviewer's own auto-pass share over reviewed calls — asks, final denials, and reviewer failures count against it, while the human's allowed-once answers never do. Read-only fast-path calls bypass review and stay out of both numbers.

## Operator rules

`settings.rules` holds operator-authored natural-language rules as native `{condition, verdict}` pairs. The panel provides a verdict selector and multiline condition editor for each rule, plus add/remove controls and per-rule validation. Newlines and bars remain condition text and never create another rule. Verdicts are `allow` / `allow_if_requested` / `ask` / `deny`; limits are 20 rules, 400 characters per condition, and 2000 condition characters in total. Invalid entries block saving, and the panel displays counts and errors beside the affected rule. Rules are reviewer-side only — the agent and the session context never see them, and with the plugin off they do not exist.

- **Decisions engine**: rules ride a dynamic `operator_rule` choice question appended per request (options `none` + one per rule). The model only answers which rule condition matches — with confidence and refusal semantics — and the compose layer applies the operator's stored verdict deterministically: `allow` returns an auto-allow (operator pre-authorization), `allow_if_requested` is a real gate — it allows only when the user's explicit-authorization score reaches `tAuth`, otherwise it returns a medium deny (`rule_unrequested`) that is routed to the user, `ask` returns a medium deny routed to the user, `deny` is a hard refusal. A low-confidence match, `none`, or refusal falls back to the base predicates; the exfiltration hard line and the `high` class are not overridable by rules.
- **Hard refusal**: a matched `deny` rule marks the decision `hardDeny`, separately from the finding that supplies the reason. Whatever else the reviewer found (a high-risk class, exfiltration, a refused classification), the call is closed with a final denial and never becomes an approval card, even under `denialRoute: ask`; the trail record keeps both the specific finding and the rule.
- **Session engine**: rules are appended to the session reviewer's system policy as an authoritative section, and the model reflects a matched rule's verdict in its risk/decision answer directly (no separate matching question exists in that protocol). Because the plugin cannot tell which rule the model applied, a `deny` rule there is advice to the reviewer rather than a hard refusal: its denial follows `denialRoute` like any other. Use the decisions engine when a matched deny rule must produce a final denial; whether a natural-language condition matches still depends on the reviewer model.

## Session and lifecycle behavior

- Only the `auto` permission preset is gated; the outer `run_code` transport is excluded; PTC inner calls are reviewed.
- Truly new main sessions default to Auto review. Restored or seeded sessions, recorded permission choices (including setup choices), and delegated children retain their recorded permissions. An empty resumed session is still a restore; absence of user messages does not establish that it is new. Same-value setup selections have a host-contract limitation described below.
- Reviewer denials under the `ask` approval policy ask the user (localized display reason, raw engine reason preserved); under `never` they are final. Reviewer failures never execute (`AUTO_REVIEW_FAILED`).
- Unloading migrates live Auto sessions to `danger-full-access`; app shutdown preserves selection.

## Differences from the official plugin

- The `decisions` engine sends the review projection to the configured API endpoint (OpenAI by default) and uses the configured reviewer model and endpoint instead of the session route. Thresholds are engine-bound — recalibrate after changing the reviewer model.
- Structurally read-only tools (`read`, `read_image`, `grep`, `glob`, `skill`) bypass the reviewer entirely; they still enter the `shown` schema memory so later review prefixes stay byte-stable.
- The decisions engine reads a refused predicate at low risk with adequate confidence as "not applicable to this call" and allows; at medium risk any refused predicate, a medium/high class, or low confidence fails closed (calibrated on 2026-11-10 revealed preferences: 15/15 refusal asks were user-approved, 32/32 total asks allowed-once, 0 rejected). The Decisions response itself is validated: a missing, duplicated or malformed answer fails closed instead of being read as "refused".
- Settings are a plugin-owned plaintext JSON file instead of a Loader `Config` declaration: profile-installed local bundles cannot resolve `@deepseek-ai/*` packages (no schemastery in the profile scope), and a self-managed file applies changes without a plugin reload.
- API key is stored in plaintext (mode `0600`) by explicit user choice, and the Web UI never receives it back: the field is write-only.
- The shipped official auto-review plugin must stay disabled while this bundle is enabled (`registerAuto` admits one integration).

## Host integration requirement

The tested host API target is `dsh-v0.2.2-rc.1`. Its Auto preset uses full access with `ask`; a delegated child may retain `never`.

In rc.1, `permissionPresets.set()` appends no event when the selected preset and its permission values already match the effective defaults. For example, setup can explicitly select `workspace-write` on an otherwise empty new main session and still leave `session.seq === 0`. The plugin cannot distinguish this unrecorded same-value selection from no selection, so the session can subsequently default to Auto. This is a documented host-contract limitation; this plugin delivery does not modify the host or work around it.

The plugin supplies localized presentation metadata as the optional second argument to `permissionPresets.registerAuto(admit, { description, confirmationDescription })`. The companion host change exposes this metadata in the permission catalog and uses it in both Auto pickers. The confirmation explains that Decisions sends review input to a separately configured endpoint/model, while Session uses the session route. The official reviewer retains its existing description when it supplies no metadata.

An unpatched rc.1 host ignores the extra argument and still displays its built-in same-model confirmation; updating the plugin alone cannot correct that host-owned dialog. Host support is outside this plugin delivery, so the metadata must not be treated as a correction to the confirmation text in an unpatched installation.

## Development and packaging

The plugin now builds from strict TypeScript with separate server, React client, and shared API contracts. Install the packed artifact, not the source directory. The package contains Node ESM, a DSH ModuleLoader client, locales, icon and bundle patch under `dist/`; it has no runtime npm dependencies. Supported host: DSH `0.2.2-rc.1`, Node `>=24.9.0`.

Development is pinned to Bun `1.4.4-canary.1+963452075` for native formatting, type checking and lint. Its immutable npm distribution is `bun@1.4.3-canary.20261021.1`; the version labels differ, so scripts check the full binary revision. See the [development guide](https://github.com/xiehaibin18/dsh-decision-review/blob/main/docs/development.md) for isolated toolchain setup, source/output boundaries, commands, and local installation.

```sh
bun install --frozen-lockfile
bun run check
bun run pack
bun run verify:package
bun run verify:host artifacts/local-decision-review-0.1.0.tgz
```

`verify:package` builds from two clean source copies, compares tarball bytes, installs offline with an empty package cache and no development dependencies, then checks Node exports and reruns the original regressions against installed artifacts. The package is self-contained; Bun is a development tool, not a requirement of the installed plugin.

## Testing

The suite covers the compose rules (including the hard refusal), Decisions response validation, settings normalization and the paused-review behaviour for invalid stored settings, the session engine against the host stream protocol, the Connection routes, the approval flow with the review trail, a host-integration double for `apply()`, and the Web UI panel through a fake renderer. It uses doubles for the host, so it does not replace a live check of an installed host. The additional DOM test executes the built classic script with real React, the actual config/save/test handlers, a temporary synthetic profile, and simulated Decisions responses. The separate installed-host verifier uses the real DSH loader and authenticated HTTP stack, including its resolved locale/icon metadata and client artifact URL. It does not mount the actual DSH browser UI. Neither test uses a real user profile or an external model. See the [host verification scope](https://github.com/xiehaibin18/dsh-decision-review/blob/main/docs/host-verification.md). Tests use synthetic fixtures only. Offline policy and projection checks verify the inputs and deterministic routing; they do not establish a model misjudgment rate or prove real-model authorization behavior.
