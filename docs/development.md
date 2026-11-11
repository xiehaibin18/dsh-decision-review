# 开发与安装

工程使用固定 Bun canary 构建；安装后的插件由 DSH 的 Node 宿主运行。当前支持 DSH `0.2.2-rc.1`、Node `>=24.9.0`，客户端使用宿主的 React 18 共享实例。

## 固定工具链

本阶段确认使用 Bun 的原生 `fmt`、`check` 和 `lint`。所选二进制为 `1.4.4-canary.1`，完整修订为 `963452075e9d7e2a47a482f297143af5ed4f76c0`。`bun --version` 只显示 `1.4.4`，不足以区分它与没有原生 lint 的稳定版。

官方 npm 分发标签为 `bun@1.4.3-canary.20261021.1`；它安装的二进制正是上述修订。因此 `packageManager` 固定 npm 标签，项目的工具链检查同时核对实际二进制。可以安装到独立目录，不替换全局 Bun：

```sh
mkdir -p "$HOME/.local/share/decision-review-toolchain"
npm install --prefix "$HOME/.local/share/decision-review-toolchain" --no-save --no-audit --no-fund bun@1.4.3-canary.20261021.1
export PATH="$HOME/.local/share/decision-review-toolchain/node_modules/.bin:$PATH"
bun --revision
bun run toolchain:check
bun install --frozen-lockfile
```

这里的 npm 仅用于安装固定工具链。项目依赖使用 Bun 与提交的 `bun.lock` 管理；不要使用会漂移的 `bun upgrade --canary`。已核验 macOS arm64 分发包的官方完整性信息，并确认它与本机二进制逐字节一致；其他平台尚未实测。[固定分发版本](https://www.npmjs.com/package/bun/v/1.4.3-canary.20261021.1) · [Bun 原生 lint](https://bun.com/docs/lint)

## 源码与产物

| 路径 | 用途 |
| --- | --- |
| `src/server/index.ts` | 宿主插件入口；设置、快照、两个评审引擎、裁决、路由和记录各自独立 |
| `src/client/index.ts` | React 客户端入口；配置面板、文案、样式和统计展示 |
| `src/shared/contracts.ts` | 插件拥有的设置、规则限制和 HTTP 消息类型 |
| `assets/` | patch、图标与插件元数据的中英文 locale |
| `scripts/`、`test/` | 开发、打包与验收工具，不进入安装包 |
| `dist/` | 生成的 Node ESM、浏览器 classic script 与运行资源，不提交 |
| `artifacts/` | 本地安装用 tarball，不提交 |

服务器和客户端分别进行严格类型检查，开发脚本只使用 Node API。宿主类型来自固定版本的官方 npm 包；其声明引用的一些可选依赖也作为开发依赖显式安装。Bun 使用 hoisted 布局，TypeScript 保留包的符号链接解析路径，以便这些声明找到依赖。没有关闭第三方声明检查，也没有把宿主服务替换为自造类型。客户端额外声明了上游类型文件引用的 KaTeX CSS 副作用资源。

服务端构建目标明确为 Node ESM，产物仅保留 Node 内置模块导入。客户端输出 CJS 后包装为 DSH 的 `window.__ModuleLoader__.load` 工厂：只有 React 与 JSX runtime 可以从宿主共享模块表取用，其他普通运行依赖默认打包。当前客户端只需要 React；官方宿主依赖全是 type-only 导入，运行时不会加载这些开发包。构建会检查外部依赖清单，不允许意外遗留宿主包导入。产物不包含源码映射、本机绝对路径或开发服务器地址。

## 日常操作

在源码仓库运行：

```sh
bun run fmt
bun run typecheck
bun run lint
bun run test
bun run check
bun run pack
```

`test` 先构建，再用 Node 的 `node:test` 运行回归；原生 `bun:test` API 迁移留待后续阶段。`check` 汇总类型、lint、格式检查和测试。`pack` 的 prepack 钩子会重新构建，因此干净源码也可直接打包。修改依赖后提交 `package.json` 和 `bun.lock`；格式化单独提交，方便审查。

## 安装包验收

```sh
bun run verify:package
bun run verify:package --keep
bun run verify:host --dsh /usr/local/bin/dsh artifacts/local-decision-review-0.1.0.tgz
```

`verify:package` 从当前 Git 源文件及尚未提交的新增源文件创建两个独立临时副本，不复制忽略的依赖、产物或配置文件；分别冻结安装、严格检查、构建并打包，比较 tarball SHA-256。它会核对包内的九个文件，在空缓存目录中离线生产安装，并用 Node 验证包导出和运行资源，再针对已安装产物重跑不依赖第三方测试工具的回归。真实 React DOM 测试在干净源码副本中执行，其 React/jsdom 仅为开发依赖。

`verify:host` 需要已安装的 DSH 和 Python 3，使用临时 profile，验证真实宿主安装、启用、认证 API、客户端资源、中英文元数据及图标；不调用模型。执行范围和版本来源见[宿主验证说明](host-verification.md)。

这些证据分为三层：Node 与真实 React DOM 下的模拟宿主回归、安装包隔离验收、已安装 DSH 的实际加载与资源/API 验收。它们没有覆盖真实 DSH 浏览器页面的完整交互，也不证明付费模型的判定准确率。

## 本地安装

从源码构建 tarball 后，明确指定要安装到的 profile：

```sh
bun run pack
dsh plugin --profile YOUR_PROFILE add ./artifacts/local-decision-review-0.1.0.tgz --offline --ignore-scripts
```

安装只需要 tarball 与支持版本的 DSH，不需要仓库源码、Bun、开发依赖或开发服务器。不要把源码目录直接作为插件安装。启用本插件时，官方 auto-review 插件应保持禁用；两者使用同一个 Auto 集成槽位。

本阶段保留 PR #2 的生命周期、授权、无损多行规则和 i18n 行为。DSH rc.1 的同值权限选择不写事件，以及未修改宿主忽略 Auto presentation metadata 的限制仍然存在，详见 README。后续的深入 TSX 拆分、原生 Bun 测试 API、热更新预览及 UI 库接入不在本阶段内。

类型迁移保留了合法输入的原有裁决与协议。解析边界有两处小调整：评审日志中的非对象 JSON 记录会被跳过；部分畸形 Decisions 字段返回明确的校验错误，仍然失败关闭。公开辅助函数原有的数字字符串置信度比较和空拒绝原因回退也保留了回归覆盖。
