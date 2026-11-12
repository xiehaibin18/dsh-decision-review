# Repository Guidelines

## Structure & Ownership

Keep policy and engines in `src/server/`, UI/API code in `src/client/`, contracts in `src/shared/`, preview fixtures in `preview/`, and regressions in `test/`. See [development](docs/development.md) for assets, scripts, and generated outputs.

Entry points own host integration; components receive props/callbacks. Preview reuses production components and validation. Give state/resources an instance owner; dispose registrations and cancel/drain pending work.

Reviewer approval never overrides host denial, confirmation, or cancellation. Validate external input; trust validated internal types. Never conceal mismatches with double casts or silent defaults.

## Code & UI

Use strict TypeScript, camelCase functions/variables, PascalCase components/types, UPPER_SNAKE_CASE constants, kebab-case filenames, and `.js` import suffixes. Bun formatting uses two spaces, single quotes, no semicolons, and 120 columns.

Use native React controls and scoped CSS for the current rules form. Derive render values directly; handle user actions in handlers. Effects may synchronize external resources with explicit cleanup and stale-response protection.

Route product copy, including errors and accessibility labels, through bilingual dictionaries. Preserve user/model text and rule whitespace; use stable identifiers for logic. Follow [preview guidance](docs/preview.md#ui-维护约定): prototype important interactions in the shared preview; verify small edits directly.

## Toolchain & Verification

Use the fixed Bun revision in [development](docs/development.md#固定工具链); production remains Node-hosted. `package.json` defines commands; read documented side effects first.

```sh
bun install --frozen-lockfile
bun run dev     # Shared UI preview
bun run check   # Types, lint, formatting, build, tests
bun run pack    # Installable package
```

Follow the [check ladder](docs/testing.md#按改动选择检查): focused iteration, one `check` before code PR delivery, static checks for documentation, and additional browser/package/host checks where affected. Avoid redundant successful reruns.

Test public behavior with `bun:test`; reproducible defects need failing-before/passing-after evidence. Mock external dependencies, not core implementations. Report exact revisions, executed checks, reused evidence, and limitations separately; failed verification must invalidate stale success evidence.

## Worktrees & Delivery

Use isolated worktrees on `codex/` branches with independent `node_modules`; share download caches only. Check resolved output paths: builds/tests rewrite `dist/`, and HMR verification edits sources. Keep live installations separate; code delivery does not imply deployment.

Keep secrets out of tracked files. Automated checks use synthetic data and temporary profiles. Classify dependencies by runtime and verify installed bytes; preserve shared React and package closure.

Use focused, imperative English commits. PRs describe behavior, validation, and applicable UI evidence. Abstractions, retries, and compatibility paths need current consumers or observed failures. Record durable decisions in existing docs; avoid duplicating policies or adding approval gates.
