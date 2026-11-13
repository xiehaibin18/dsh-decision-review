# Bun 独立开发预览

预览用于日常插件界面开发，与 DSH 使用同一套业务组件、样式和中英文文案。固定工具链为 npm `bun@1.4.3-canary.20261021.1` 对应的 binary `1.4.4-canary.1`、revision `963452075e9d7e2a47a482f297143af5ed4f76c0`。生产插件的宿主和 Node 版本见[开发指引](development.md)。

## 启动与操作

```sh
bun install --frozen-lockfile
bun run dev
# 自动选择空闲端口；打开命令输出的 URL。
PREVIEW_PORT=0 bun run dev
```

默认 URL 为 `http://127.0.0.1:4317/`，服务仅绑定本机。没有真实凭据、用户 profile、会话历史或模型请求。配置仅在进程内存中保存；重启服务后消失。只在预览中输入合成测试内容。

控制区固定中文。「宿主槽位」只显示选中的实际插件组件；窗口的其余内容是静态模糊的宿主示意。可独立切换中英文与明暗主题。

| 槽位选项 | 注册与位置 |
| --- | --- |
| 插件详情 · 配置 | `plugins.row.config` 的 `page` 视图：在插件行的标题和说明下方挂载真实 `ConfigPanel`。该注册另有简短的 `summary` 视图；`plugins.detail.actions` 是详情页顶部的操作槽位。 |
| 会话输入框 · 统计栏 | `conversation.composer.dock`：在会话输入框卡片下方，和宿主统计读数并排显示真实 `ApprovalStatsPill`。 |

拖动画布右下角，或输入宽、高后按 Enter 或离开输入框，可调整窗口的逻辑尺寸。桌面尺寸为 1280 × 820，最小窗口为 520 × 600；输入和拖动均遵守最小尺寸。「缩放」只改变显示比例；默认「适应空间」让窗口适配可用区域，固定比例下较大的画布可以滚动查看。侧栏与详情留白始终根据逻辑尺寸变化。

- 切换场景或点击「重置当前场景」：丢弃草稿与结果，销毁旧场景，取消旧请求，重新载入初始 fixture。
- 切换槽位、语言、主题、尺寸或缩放：保留配置草稿、已保存数据和当前场景。离开统计栏会停止轮询，再次打开时重新读取。
- 「重新加载已保存配置」：丢弃草稿，从当前场景的内存 HTTP 服务重新读取；可检查保存后的规范化结果和多行内容。
- 「恢复接口」：移除当前场景的模拟故障。保存失败时保留草稿供重试；加载失败时自动重新加载；统计失败后在统计栏等待下一次轮询。

macOS 壳以 DSH `dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）为参照：[桌面主进程](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/apps/desktop/src/main.ts)定义普通窗口的初始与最小尺寸及交通灯位置；960px 最小宽度只在新手引导期间生效。[窗口列宽](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-layout/src/client/columns.ts)定义默认 280px 侧栏与 1024px 自动收起阈值，[AppFrame](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-layout/src/client/AppFrame.tsx)在 macOS 收起时不保留控制栏。[插件页样式](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css)把详情列限制为 960px，并在低于 768px 时使用 20px 横向留白；插件自己的表单最大宽度为 680px。[InputBar](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx)在输入框下方渲染 dock。这些是代表性的窗口布局，不引入 DSH 客户端、真实会话或截图，也不作为 rc.2 像素级校对的证据。

## 场景

| 场景 | 可检查的行为 |
| --- | --- |
| 正常 Decisions | 配置、保存、统计、合成测试结果 |
| 正常跟随会话 | 真实业务隐藏 Decisions 字段，冒烟测试禁用 |
| 慢响应 | 配置/保存/测试延迟 2 秒，统计延迟 1 秒；检查加载、保存中和取消 |
| 配置加载失败 | HTTP 503、错误展示、恢复后重新加载 |
| 保存失败 | HTTP 503、草稿保留、恢复后重试 |
| 无效配置 | 宽松加载报告错误，严格保存要求修复；跟随会话下也能修复 Decisions 地址与模型 |
| 多行规则 | 空行、缩进、中文、英文和末尾换行无损往返；空规则阻止保存 |
| 测试接口失败 | HTTP 503 与恢复重试 |
| 测试结果含失败 | 放行、拒绝和单行失败同时展示 |
| 统计接口失败 | 隐藏失败读数，恢复后继续轮询 |
| 暂无统计 | 零评审数时真实 pill 保持隐藏 |

未保存修改通过编辑真实表单产生，不直接注入组件状态。保存中通过慢响应场景产生。保存期间继续编辑时，返回结果更新已保存基线，同时保留后续编辑。编辑或保存会取消/清除旧冒烟结果，避免展示不再对应当前表单的结果。

## 目录和职责

| 位置 | 职责 |
| --- | --- |
| `src/client/index.ts` | DSH slot/locale 注册、HTTP 客户端注入、共享 CSS 的安装与清理 |
| `src/client/panel.tsx` | 配置加载与表单状态；真实保存、错误和未保存修改行为 |
| `src/client/rules-editor.tsx`、`rules.ts` | 规则组件与草稿校验 |
| `src/client/smoke-test.tsx`、`stats-pill.tsx` | 真实测试结果和统计展示 |
| `src/client/api.ts` | 两个入口共用的 `ReviewApi` 与 HTTP/JSON 客户端，支持取消 |
| `src/client/messages.ts`、`styles.ts`、`styles.css` | 两个入口共用的文案与业务样式 |
| `src/client/ui/`、`scripts/build-ui-css.ts` | 共享 shadcn/ui 控件与同一份编译 CSS |
| `preview/main.tsx`、`app.tsx` | 独立 React DOM 根、槽位选择和场景控制 |
| `preview/canvas.tsx`、`host-preview.tsx` | 可调整的逻辑画布、静态 DSH 宿主壳及业务组件的挂载边界 |
| `preview/http.ts`、`locale.ts`、`preview.css` | 场景控制请求、语言解析及代表性宿主主题变量注入 |
| `preview/server.ts`、`service.ts` | Bun HTML 服务、场景生命周期与模拟 HTTP 路由 |
| `preview/scenes.ts`、`fixtures.ts` | 场景描述和合成输入 |
| `preview/service.test.ts`、`verifier.test.js` | 源码侧接口、校验、生命周期及 HMR 文件还原回归 |
| `scripts/verify-preview.mjs`、`preview-source-edits.mjs` | 真实浏览器验收、临时源码修改与内容核对清理 |

预览保留真实 HTTP/JSON 边界。每次创建场景都有独立 ID，配置、保存、统计和测试使用该 ID 下的 URL；不同标签页互不覆盖。删除场景会中止等待中的保存，避免延迟结果写入后来创建的场景。浏览器卸载时尽力释放场景；异常关闭遗留的内存数据在服务退出时清空。

模拟服务直接调用生产的 `normalizeSettings`、`mergeSettingsUpdate` 和 `publicSettings`，保留写入/移除密钥、默认值、严格保存和无损规则行为。合成测试的固定判定输入交给真实 `composeDecision` 和原因翻译，因此阈值变化仍通过同一裁决逻辑。fixture 不做自然语言规则匹配，也不评估模型质量。Session 引擎仅预览其真实配置行为，沿用生产界面对冒烟测试的禁用。

业务组件接收 `t`、`resolveText`、稳定的 `ReviewApi` 和必要的 `sessionId`，不直接依赖宿主服务实例。宿主使用其真实 locale 与 CSS 变量；预览注入代表性明暗配色，并通过页面标记让 Dark Reader 跳过预览，避免浏览器扩展覆盖所选主题。预览可验证变量适配、布局和文案，但不承诺与任一宿主主题逐像素相同。

## UI 维护约定

界面衍生值直接由 props、状态或请求结果计算，保存等用户动作由事件处理器发起。确实需要随挂载同步的加载、轮询或订阅可以使用 Effect，但应明确资源所有者、触发条件、取消和清理方式，并防止过期响应覆盖当前状态；不通过 Effect 将可直接计算的值回写为第二份状态。不引入零 Effect 门禁，也不为遵循文件模板拆分简单组件。

配置面板和规则编辑器使用本地维护的 shadcn/ui Base UI 控件与插件作用域 CSS，沿用宿主的 React、React DOM 和明暗主题。重要交互先在共享预览中建立有代表性的正常、加载、错误或草稿场景，再按影响范围检查真实宿主；文案、间距等微调直接验证受影响场景。需要产品取舍时说明选项、影响和推荐，不为每次 UI 修改增加固定阶段审批。

产品文案包含错误、提示、placeholder、ARIA 名称、tooltip 和状态格式化文字。客户端文案归 `src/client/messages.ts`，服务端本地化裁决原因归 `src/server/review-outcome.ts`，插件元数据归 `assets/locale/`；修改时同步对应中英文键、占位符和语义，不向组件添加另一套兜底文案。用户输入、模型原文、代码和规则内容不是产品文案，保持原样，特别是规则的空白与换行；逻辑判断使用稳定标识，不匹配翻译后的显示文本。

可见改动应按影响检查中英文、明暗主题、窄屏、长文本、键盘焦点和错误提示，并提供相应截图或交互证据。自动化未覆盖的浏览器、触屏、IME 或屏幕阅读器行为应明确列为未验证，不能用可访问性属性或截图代替实际交互证据。

## 热更新的真实语义

该固定 revision 的 [Bun HTML 服务](https://bun.com/docs/bundler/fullstack) 在 `development.hmr: true` 下提供 React Fast Refresh 与 CSS 热更新。以下行为经过浏览器实测，详见[验收记录](preview-acceptance.md)。

| 修改 | 结果与状态 |
| --- | --- |
| `panel.tsx` 的展示 JSX | 立即更新；草稿保留，`performance.timeOrigin` 和页面导航计数不变 |
| `src/client/styles.css` | 立即更新样式；草稿保留，不整页刷新 |
| `src/client/ui/control-styles.css` 或控件的工具类 | Tailwind watcher 编译后，Bun 更新共享 CSS；生成文件不直接编辑 |
| `preview/index.html` | 整页重载；草稿和场景控制回到初始值 |
| 修改组件 Hook 顺序或组件身份 | Fast Refresh 可能重新挂载并丢失状态，应重新建立场景；不保证所有 TSX 编辑都保留状态 |
| 为现有组件新增文案键 | 开着预览时先更新中英字典，再更新组件。若组件先热更新并读到旧字典，渲染失败可能使预览草稿丢失 |
| 服务端、fixture、端口或依赖 | 停止并重启 `bun run dev`，再刷新浏览器；服务器源码不自动热重启 |

[Fast Refresh 会重新运行 effects](https://reactnative.dev/docs/fast-refresh#fast-refresh-and-hooks)。配置加载按稳定 API 实例记住已加载状态，以免展示 JSX 更新时覆盖草稿；已在途的保存/测试会被清理并结束忙碌状态。真实宿主的取消是客户端取消，已经开始的服务端保存仍可能完成；预览销毁场景时还能取消其内存保存。需要确定状态时使用场景重置。

## 扩展与验证

增加场景时，在 `scenes.ts` 添加 ID 和中文说明，再在 `fixtures.ts`/`service.ts` 定义合成输入或故障。配置必须经过真实校验，响应遵守 `src/shared/contracts.ts`；不添加另一套表单或放宽业务断言。只为新增的接口与状态边界补充测试，样式检查使用浏览器。

```sh
bun run check
bun run test:ci
bun run test:preview
# 先启动 dev；需要本机 Chrome/Chromium 和固定 Bun 的 WebView。
bun run verify:preview -- http://127.0.0.1:4317 --hmr
bun run verify:package
bun run verify:host --dsh /usr/local/bin/dsh artifacts/verification/local-decision-review-0.1.0.tgz
```

浏览器验证使用独立、临时的 Chrome 进程，保存截图与 JSON 证据到 `artifacts/browser/`。`--hmr` 会临时修改并还原本工作树的共享 TSX、CSS 和 HTML；验证时仍应避免同时编辑这三个文件。每次写入和还原前，脚本会核对当前内容是否仍为自己预期的版本；发现变化时保留当前文件、报告具体路径并以失败退出，不把旧快照覆盖回去。正常还原与异常清理使用同一路径，一份文件冲突或恢复失败不会阻止其余文件清理；验证错误和清理冲突共同写入失败诊断。保留下来的文件可能同时包含编辑器修改与临时 HMR 标记，应手动检查后再验证。内容检查不使用跨进程锁。浏览器在导航、验证或证据保存失败时也会关闭；由开发者另行启动的预览服务仍由开发者管理。省略该参数可仅检查交互。

新增 `@types/bun` 与 `@types/react-dom` 均为开发依赖。`patches/bun-types@1.4.4.patch` 修正上游声明中四处与 Node 24 不匹配的类型引用：TextEncoder 返回值从真实方法签名取得，TLS 与 KeyObject 使用显式模块类型。固定 Bun、现有 Node 类型与第三方声明检查均保留；冻结安装会复现该补丁。

生产包在既有文件之外附带客户端依赖许可。共享 CSS 作为文本嵌入 classic ModuleLoader 客户端，在宿主启用/卸载时安装/移除；React 与 React DOM 由宿主共享。每个已挂载表单拥有自己的 Select Portal 容器，菜单继承同一主题及缩放，离开该表单时随之移除。构建元数据拒绝预览源码和打包进客户端的 React/React DOM。预览服务器、fixtures、浏览器驱动、类型补丁及开发依赖都不会随插件安装。

可复用经验目前限于「业务组件 + 类型化服务 + 宿主/预览入口」这一明确边界。共享工具包、第二插件接入、完整 i18n 改写、GitHub template 和脚手架 CLI 均未实现。
