# DSH 0.2.2-rc.3 compatibility evidence

The initial validation below covers `ae827d3205582164e378950206be1f14e9d7d3ae` against baseline `8df209ebabab9061e23805050cece0ef1c322127`. The repair adds only the exact `0.2.2-rc.3` manifest entry, updates the package verifier's allowlist, and documents support. The rc.1 type dependencies, lockfile, and production JavaScript are unchanged. The documentation follow-up has a separate artifact record below.

## Source and runtime

- Official source comparison: [`dsh-v0.2.2-rc.2` (`ddac967`)](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.2) to [`dsh-v0.2.2-rc.3` (`38a6a5c`)](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3). The scoped diff was empty for the loader and shared React table, locale, config/composer slots, permission and approval services, agent/session and pre-tool hooks, profile context, and authenticated Connection registration. The host plugin manager source was also unchanged.
- Installed host: macOS `/usr/local/bin/dsh`, CLI and Web boot version `0.2.2-rc.3`, Web build `6b729fe`, embedded Node `24.21.0` and Electron `44.7.0`. The installed build identifier is recorded separately from the public source tag commit. Installed `app.asar` SHA-256: `c0ce89f77d25e98e11952728d1fc054b6e2300db17402af83a1a225c8b36e843`.
- Local tooling: Bun `1.4.4-canary.1`, revision `963452075e9d7e2a47a482f297143af5ed4f76c0`; standalone Node probe `24.22.3`.

## Before and after

| Check | Result |
| --- | --- |
| Baseline `verify:host dist` | Exit 1. Offline installation was rejected because the old manifest declared only rc.1 and rc.2. DSH reported that nothing was installed. |
| Rebuilt `dist` | Source and output manifests both list exactly rc.1, rc.2 and rc.3. |
| Corrected `verify:host --browser dist` | Exit 0. Offline installation and activation, authenticated configuration read/save, unauthenticated HTTP 401, ModuleLoader Client delivery, bilingual metadata and SVG icon passed. All 10 configuration browser groups passed, including seconds, radio/threshold keyboard input, rule popup, multiline save/reopen, theme and 390px layout. No console errors or warnings. |
| Corrected `verify:host` on the verified tarball | Exit 0. The same installation, activation, authenticated route, Client delivery, metadata and icon checks passed in a separate disposable profile. |
| `bun run check` | Exit 0, 305 tests passed. |
| `bun run verify:package` | Exit 0. Two frozen builds produced identical tarballs; offline directory and tarball installs passed independent Node probes, and 267 installed-byte regressions passed. |

The archive contains the same ten files, byte for byte, as the `dist` directory tested on rc.3. Comparing the baseline and corrected `dist` directories, only `package.json` and `README.md` differ.

| Artifact | SHA-256 |
| --- | --- |
| `local-decision-review-0.1.0.tgz` | `b96fbcc62bd911bcef79485a0636478d037e0dbf13ec19cbe036a3615b76c92c` |
| `dist/package.json` | `72190205c607cb3b682a987ca99f9246311cf913dbb2b78e313b3736ae82cecc` |
| `dist/index.js` | `eff73834cf0a1bec5473d8c156cb9fa0685ff146530401fa697f3faf92d04a65` |
| `dist/client.js` | `652677439f671ec2c3a964176e3412395ddcd188f94ef0e88fe095608d03321a` |

Local transcripts and the configuration browser report/screenshots are in `artifacts/dsh-rc3-compat/`. The host checks used fresh temporary profiles and no version exemptions or model calls. The browser run covered the configuration page; the actual composer dock, real review execution, and the user's existing profile were not exercised. This run did not retest the older host releases.

## Auto limitation documentation follow-up

Independent review found that the supported rc.3 host still has both Auto limitations previously documented for rc.1: selecting unchanged permission values records no event, and `registerAuto()` ignores the presentation metadata while the host keeps its built-in same-model confirmation. README now explicitly includes unpatched rc.3 in both statements. This finding comes from host source and installed-code inspection, not an Auto-selection or model-review browser test. No host or plugin runtime behavior was changed.

`git diff --check` and a fresh `bun run pack` passed. The new archive SHA-256 is `4c25766d9fb460bc65762c222f8c6171d6cd3f2d50be788a39bcb5e39f9aaf38`. Its ten files match the rebuilt `dist` byte for byte; comparison with the initial verified archive shows that only `README.md` changed. The manifest, server/client JavaScript, locales, icon, patch and license files remain identical.

The earlier engineering, installed-byte, Node, host and browser results are reused for those unchanged runtime bytes; they were not rerun locally for this documentation-only follow-up. The new archive is not described as independently reinstalled. Comparison details and the pack log are in `artifacts/dsh-rc3-compat/doc-fix-artifact-comparison.json` and `doc-fix-pack.log`. The main checkout's delivered `dist` and tarball were left unchanged.
