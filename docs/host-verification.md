# Installed DSH host verification

Run the optional check with Python 3 and an installed DSH CLI. Pass either the generated `dist/` directory or a tarball produced by `bun run pack`.

```sh
python3 scripts/verify-host.py dist
python3 scripts/verify-host.py --dsh /usr/local/bin/dsh /path/to/local-decision-review-0.1.0.tgz
```

The verifier installs the bundle offline with install scripts disabled. For a directory it copies `dist/` out of the checkout before passing `./dist` to DSH, so the install cannot rely on the source package or its dependencies. It starts an ephemeral Web profile on loopback, exchanges the temporary launch token for a session cookie, and checks the authenticated settings read and save. It also checks that an unauthenticated settings request gets HTTP 401, that the advertised Client resource serves a ModuleLoader factory, and that the Host's plugin inventory resolves the active bundle and row with English and Chinese text and an SVG icon.

The process uses a temporary DSH home, agents directory, package manager storage, and working directory. It does not inherit credential environment variables. The verifier disables telemetry, configures a synthetic DeepSeek credential and loopback provider endpoint, opens no browser, and removes its temporary profile after shutting down the Host. It needs permission to bind and connect to a loopback port.

The installed-host check covers installation, activation, authenticated HTTP routes, metadata resolution, and delivery of the Client artifact. The automated suite exercises review behavior with synthetic host and provider data. Browser rendering of the Plugins configuration page and composer dock requires a separate check in a browser connected to an isolated DSH profile. The verifier sends no model requests.

## Release reference

The package declares support for DSH `0.2.2-rc.1` and `0.2.2-rc.2`, and still builds against the `rc.1` TypeScript declarations, including Cordis `4.1.0`. The previous tarball layout was verified on the installed `rc.1` host at build commit `c59d10a`. The standalone directory and its matching tarball were verified on the installed macOS `/usr/local/bin/dsh`, whose Web boot graph reported `0.2.2-rc.2` at build commit `a6b1b85`. [Official rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)

The bundle manifest, patch, and installation flow follow the tagged [publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/docs/user/develop/basic/publish.md). The Client is a classic script that registers a lazy factory under the package name. The Host supplies shared React and its JSX runtime through the module table. [Client loader](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/modules/src/client/manifest.ts) · [Shared modules](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/web/src/platform.ts)

## Isolated rules browser check

Pass `--browser` to additionally mount the actual plugin configuration page in a fresh Chrome process driven by the pinned Bun WebView. The disposable profile's origin and the verifier's freshly issued browser cookie are passed on stdin; credentials are never written to the browser evidence. The check covers rule add/remove focus, keyboard character selection, validation, multiline save/reopen, live system-theme resolution and a 390px viewport after the host sidebar transition completes. Capture waits for animations and checks that the textarea is unobstructed at three points. It never runs a smoke test or model request. Browser screenshots and JSON are written to `artifacts/ui-evaluation/host/`; the profile is still stopped and removed on completion or failure.

```sh
bun run verify:host --dsh /usr/local/bin/dsh --browser dist
```

The disposable Chrome process uses a mock keychain/basic password store so the temporary HOME does not access the real macOS keychain. The browser check assumes a fresh Simplified Chinese profile, as created by this verifier on the evaluated installation. Browser keyboard evidence covers Tab/Shift+Tab and character selection, not IME composition or the operating system's native popup arrow-key navigation. See [UI evaluation](ui-style-evaluation.md) for the exact observations and limitations.
