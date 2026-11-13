# 开发与安装

工程使用固定 Bun canary 构建；安装后的插件由 DSH 的 Node 宿主运行。当前支持 DSH `0.2.2-rc.1`、`0.2.2-rc.2` 和 `0.2.2-rc.3`，要求 Node `>=24.9.0`，客户端使用宿主的 React 18 共享实例。开发依赖仍使用 `rc.1` 的类型声明。

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

这里的 npm 仅用于安装固定工具链。项目依赖使用 Bun 与提交的 `bun.lock` 管理；不要使用会漂移的 `bun upgrade --canary`。已核验 macOS arm64 分发包的官方完整性信息，并确认它与本机二进制逐字节一致；Linux x64 的同 revision 分发包也已核验，GitHub Actions 会验证其实际功能。[固定分发版本](https://www.npmjs.com/package/bun/v/1.4.3-canary.20261021.1) · [Bun 原生 lint](https://bun.com/docs/lint)

## 源码与产物

| 路径 | 用途 |
| --- | --- |
| `src/server/index.ts` | 宿主插件入口；设置、快照、两个评审引擎、裁决、路由和记录各自独立 |
| `src/client/index.ts` | DSH 入口；slot、locale、共享 React 与样式生命周期适配 |
| `src/client/*.tsx`、`api.ts`、`messages.ts`、`styles.*` | 宿主与预览共用的真实组件、类型化 HTTP 客户端、文案和样式 |
| `src/client/ui/`、`components.json` | 本地维护的官方 shadcn/ui Base UI 源码、Tailwind 输入与 registry 配置 |
| `preview/` | Bun HTML/TSX 入口、中文控制区、内存 HTTP 场景服务和开发测试；不进入安装包 |
| `src/shared/contracts.ts` | 插件拥有的设置、规则限制和 HTTP 消息类型 |
| `assets/` | patch、图标与插件元数据的中英文 locale |
| `scripts/`、`test/` | 开发、打包与验收工具，不进入安装包 |
| `dist/` | 可直接安装的目录，包含独立的 `package.json`、Node ESM、浏览器 classic script、运行资源及说明，不提交 |
| `artifacts/` | `dist/` 打成的 tarball 和本地验收证据，不提交 |

服务器和客户端分别进行严格类型检查，构建与打包脚本使用 Node API；独立预览服务使用 Bun API，单独进行严格类型检查。宿主类型来自固定版本的官方 npm 包；其声明引用的一些可选依赖也作为开发依赖显式安装。Bun 使用 hoisted 布局，TypeScript 保留包的符号链接解析路径，以便这些声明找到依赖。没有关闭第三方声明检查，也没有把宿主服务替换为自造类型。客户端额外声明了上游类型文件引用的 KaTeX CSS 副作用资源。

服务端构建目标明确为 Node ESM，产物仅保留 Node 内置模块导入。客户端输出 CJS 后包装为 DSH 的 `window.__ModuleLoader__.load` 工厂：只从宿主共享模块表取用 `react`、`react/jsx-runtime` 和 `react-dom`。Base UI 与样式辅助库进入客户端生产包，宿主类型包只用于编译，Tailwind 只用于生成 CSS。构建检查输入元数据和最终 JavaScript 导入，防止打入第二份 React 或留下未声明的运行时导入。产物不包含源码映射、本机绝对路径或开发服务器地址。

## 维护约定

入口负责 Cordis、Connection、slot 和 locale 等宿主适配，评审引擎、裁决与配置校验保持在各自模块。共享状态归服务或插件实例所有，不通过模块级“当前会话”单例或全局缓存绕过所有权。组件和预览的职责见[UI 维护约定](preview.md#ui-维护约定)。

监听器、slot、样式、定时器和异步请求都要有明确的释放责任。注册返回的释放函数应归入所属插件生命周期；卸载时停止接收新工作，取消并等待已接收工作收尾。修改生命周期时，要验证释放后的监听或贡献确实消失，以及进行中的请求不会继续更新已卸载实例。

reviewer 的放行只代表本插件的判断，不能覆盖宿主下游的拒绝、人工确认或取消。权限约束必须在实际执行路径生效，不能依赖隐藏 UI、提示词过滤或监听器顺序。配置不可信或评审失败时保留既有失败关闭语义，不通过静默默认值恢复放行；配置写入成功后再发布成功状态。

设置文件、HTTP、模型输出和持久化记录是运行时校验入口，可以先接收 `unknown` 再收窄；已经验证的同进程类型直接使用。不要靠双重类型断言、宽泛的 `any` 或静默回退隐藏类型不匹配，也不要为静态类型已经排除的内部输入增加重复校验。确有无法收窄的外部类型限制时，在局部说明原因。

新增依赖先说明服务端、浏览器或开发用途，再分别检查安装关系与实际构建内容。生产 Node 入口不能意外依赖 Bun、源码目录或开发依赖；客户端保留宿主共享 React，不打入第二份 React/React DOM。调整共享模块清单属于显式契约变更，应核对所支持宿主版本并执行[安装产物验收](testing.md#安装产物和生产-node)，不能只靠源码运行通过。

抽象、配置项、缓存、重试和兼容路径应对应当前调用方或已观察的失败。内部接口调整时一起更新调用方，不为假设用户维护兼容包装；协议常量和安全上限不必变成配置项。非平凡的长期决策、明确取舍和未解决问题写入现有相关文档；机械改动无需另建决策记录。命令以 `package.json` 为准，每项事实尽量只维护一处，根 `AGENTS.md` 保留稳定要求和入口链接。

## 工作树与运行文件

开发与审查使用独立工作树和 `codex/` 分支，各自安装 `node_modules`，不链接其他 checkout 的安装目录；允许共享 Bun 下载缓存，安装仍使用冻结锁文件。先检查已有修改并保留归属不明的文件，跨分支对比在另一工作树进行。

隔离要检查解析符号链接后的最终路径。构建、测试、工程检查及打包可能重写 `dist/`，DSH 的目录安装又会链接该目录；不能在实际安装目标上运行开发检查。[HMR 验收](preview.md#扩展与验证)还会临时修改源码，其写入、还原和证据都必须留在本工作树。提交代码或 PR 不自动包含安装、启用、卸载或重启；只有当前任务覆盖相应运行操作时才执行，不重复索取已经给出的授权。

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

`test` 先构建，再以原生 `bun:test` 运行隔离回归；`test:ci` 额外输出固定随机 seed、JUnit 和覆盖率。复现方式、迁移覆盖和运行时边界见[测试与 CI](testing.md)，按其中的[检查分层](testing.md#按改动选择检查)选择本次必要命令，不默认逐条重跑。`check` 汇总类型、lint、格式检查和测试。`pack` 先重新构建，再把 `dist/` 作为包根目录打包，因此干净源码也可直接打包。修改依赖后提交 `package.json` 和 `bun.lock`；格式化单独提交，方便审查。

提交主题使用简洁的英文祈使句，沿用现有历史，不强制 Conventional Commit 前缀。PR 描述最终行为、相关 issue、实际验证与限制；影响可见 UI 时附相应截图或交互证据。说明新增问题与既有问题的区别，不借机扩大修复范围。

## 安装包验收

```sh
bun run verify:package
bun run verify:package --keep
bun run verify:host --dsh /usr/local/bin/dsh dist
bun run verify:host --dsh /usr/local/bin/dsh artifacts/local-decision-review-0.1.0.tgz
```

`verify:package` 从当前 Git 源文件及尚未提交的新增源文件创建两个独立临时副本，不复制忽略的依赖、产物或配置文件；分别冻结安装、严格检查、构建并打包，比较 tarball SHA-256。它会把 `dist/` 复制到源码树之外，分别在空缓存目录中离线安装目录和 tarball，核对两者安装出的文件逐字节一致，并用隔离 Node 子进程分别验证导出、资源和关键生产行为。Bun 针对已安装产物重跑同一套回归。真实 React DOM 测试使用的 React/jsdom 仅为测试工具依赖，不进入生产消费目录。

`verify:host` 需要已安装的 DSH 和 Python 3，使用临时 profile，验证真实宿主安装、启用、认证 API、客户端资源、中英文元数据及图标；不调用模型。执行范围和版本来源见[宿主验证说明](host-verification.md)。

这些证据分为三层：Bun 与真实 React DOM 下的模拟宿主回归、安装包隔离验收、已安装 DSH 的实际加载与资源/API 验收。它们没有覆盖真实 DSH 浏览器页面的完整交互，也不证明付费模型的判定准确率。

## 本地安装

从源码构建后，明确指定要安装到的 profile：

```sh
bun run build
dsh plugin --profile YOUR_PROFILE add ./dist --offline --ignore-scripts
```

DSH 会链接安装目录。可以把整个 `dist/` 复制到固定位置再安装；安装后应保留该位置。如果需要分发单个文件或独立于该目录使用，可以从同一构建产物打包：

```sh
bun run pack
dsh plugin --profile YOUR_PROFILE add ./artifacts/local-decision-review-0.1.0.tgz --offline --ignore-scripts
```

安装只需要完整的 `dist/` 或 tarball 与支持版本的 DSH。构建工具、源码和开发依赖不进入交付包。启用本插件时，官方 auto-review 插件应保持禁用；两者使用同一个 Auto 集成槽位。

本阶段保留 PR #2 的生命周期、授权、无损多行规则和 i18n 行为。DSH rc.1 的同值权限选择不写事件，以及未修改宿主忽略 Auto presentation metadata 的限制仍然存在，详见 README。配置面板、规则和测试结果现已整理为共享 TSX 组件，Bun 热更新预览见[独立预览说明](preview.md)。配置与规则的基础控件已接入 shadcn/ui 的 Base UI 版本。

类型迁移保留了合法输入的原有裁决与协议。解析边界有两处小调整：评审日志中的非对象 JSON 记录会被跳过；部分畸形 Decisions 字段返回明确的校验错误，仍然失败关闭。公开辅助函数原有的数字字符串置信度比较和空拒绝原因回退也保留了回归覆盖。

## 独立 UI 开发

使用 `bun run dev` 启动仅绑定 `127.0.0.1` 的预览；可用 `PREVIEW_PORT=0` 自动选择空闲端口。具体场景、热更新语义、组件边界、类型声明补丁和浏览器验收命令见[独立预览说明](preview.md)。安装包验收同时运行源码侧预览测试；已安装字节回归只运行生产业务与测试防线用例，预览服务不会进入消费目录。

## 表单控件与样式

配置面板和规则编辑器使用 [shadcn/ui Base UI 的接入方案](ui-style-evaluation.md#当前接入决策)。`build` 与 `dev` 都用冻结的 Tailwind CLI 从 `src/client/ui/control-styles.css` 编译同一个忽略提交的 `control-styles.generated.css`；开发服务另起一个随服务退出的 CSS watcher。Tailwind 扫描只包含同目录控件 TSX；布局和宿主颜色变量仍由插件作用域 CSS 管理。

升级 registry 组件时，先在临时目录取出固定上游源码，再逐个合并所需改动；`components.json` 记录 Base Nova、前缀及本地路径。保留 React 18 的引用转发、表单语义和本地 Portal。构建和隔离 Node 探针检查最终 CSS 的每个选择器：选择器列表中的每一项必须从 `dr:` 工具类或 `decision-review-` 类开始。只允许项目当前使用的分组规则和有父级作用域的嵌套修饰，拒绝全局选择器、越出插件范围的同级选择器、Preflight 和未加前缀的内部变量。与浏览器 bundle 一同分发的第三方许可记录在 `assets/LICENSE.client`。
