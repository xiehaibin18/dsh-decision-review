# Installed DSH host verification

Run the optional check with Python 3 and an installed DSH CLI. Use a tarball produced by this checkout's build and pack commands.

```sh
python3 scripts/verify-host.py /path/to/local-decision-review-0.1.0.tgz
python3 scripts/verify-host.py --dsh /usr/local/bin/dsh /path/to/local-decision-review-0.1.0.tgz
```

The verifier installs the tarball offline with install scripts disabled. It starts an ephemeral Web profile on loopback, exchanges the temporary launch token for a session cookie, and checks the authenticated settings read and save. It also checks that an unauthenticated settings request gets HTTP 401, that the advertised Client resource serves a ModuleLoader factory, and that the Host's plugin inventory resolves the active bundle and row with English and Chinese text and an SVG icon.

The process uses a temporary DSH home, agents directory, package manager storage, and working directory. It does not inherit credential environment variables. The verifier disables telemetry, configures a synthetic DeepSeek credential and loopback provider endpoint, opens no browser, and removes its temporary profile after shutting down the Host. It needs permission to bind and connect to a loopback port.

The installed-host check covers installation, activation, authenticated HTTP routes, metadata resolution, and delivery of the Client artifact. The automated suite exercises review behavior with synthetic host and provider data. Browser rendering of the Plugins configuration page and composer dock requires a separate check in a browser connected to an isolated DSH profile. The verifier sends no model requests.

## Release reference

The package targets DSH `0.2.2-rc.1` and uses its published TypeScript declarations, including Cordis `4.1.0`, as development dependencies. The official release tag points to `66491b0`. The installed macOS CLI used for verification was `/usr/local/bin/dsh`, backed by Electron `44.7.0` and Node `24.21.0`. Its Web boot graph reported `0.2.2-rc.1` at build commit `c59d10a`, so the binary check provides independent evidence alongside the tag's declarations. [Official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)

The bundle manifest, patch, and installation flow follow the tagged [publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/docs/user/develop/basic/publish.md). The Client is a classic script that registers a lazy factory under the package name. The Host supplies shared React and its JSX runtime through the module table. [Client loader](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/modules/src/client/manifest.ts) · [Shared modules](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/web/src/platform.ts)
