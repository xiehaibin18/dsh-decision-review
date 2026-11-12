# Bun 独立开发预览

预览用于日常配置界面开发，与 DSH 使用同一套业务组件、样式和中英文文案。固定工具链仍为 npm `bun@1.4.3-canary.20261021.1` 对应的 binary `1.4.4-canary.1`、revision `963452075e9d7e2a47a482f297143af5ed4f76c0`。生产插件继续由 Node `>=24.9.0`、DSH `0.2.2-rc.1` 运行。

## 启动与操作

```sh
bun install --frozen-lockfile
bun run dev
# 自动选择空闲端口；打开命令输出的 URL。
PREVIEW_PORT=0 bun run dev
```

默认 URL 为 `http://127.0.0.1:4317/`，服务仅绑定本机。没有真实凭据、用户 profile、会话历史或模型请求。配置仅在进程内存中保存；重启服务后消失。只在预览中输入合成测试内容。

控制区固定中文，业务界面可切换中英文、明暗主题与宽/窄展示。窄屏选项把内容区限制为 390px；检查真实移动视口时还需把浏览器窗口或模拟视口改为 390px。

- 切换场景或点击「重置当前场景」：丢弃草稿与结果，销毁旧场景，取消旧请求，重新载入初始 fixture。
- 切换语言、主题或宽度：保留编辑、已保存数据和当前场景。
- 「重新加载已保存配置」：丢弃草稿，从当前场景的内存 HTTP 服务重新读取；可检查保存后的规范化结果和多行内容。
- 「恢复接口」：移除当前场景的模拟故障。保存失败时保留草稿供重试；加载失败时自动重新加载；统计失败后等待下一次轮询。

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
| `preview/main.tsx`、`app.tsx` | 独立 React DOM 根和中文控制区；按场景身份重新挂载业务组件 |
| `preview/http.ts`、`locale.ts`、`preview.css` | 场景控制请求、语言解析及代表性宿主主题变量注入 |
| `preview/server.ts`、`service.ts` | Bun HTML 服务、场景生命周期与模拟 HTTP 路由 |
| `preview/scenes.ts`、`fixtures.ts` | 场景描述和合成输入 |
| `preview/service.test.ts`、`verifier.test.js` | 源码侧接口、校验、生命周期及 HMR 文件还原回归 |
| `scripts/verify-preview.mjs`、`preview-source-edits.mjs` | 真实浏览器验收、临时源码修改与内容核对清理 |

预览保留真实 HTTP/JSON 边界。每次创建场景都有独立 ID，配置、保存、统计和测试使用该 ID 下的 URL；不同标签页互不覆盖。删除场景会中止等待中的保存，避免延迟结果写入后来创建的场景。浏览器卸载时尽力释放场景；异常关闭遗留的内存数据在服务退出时清空。

模拟服务直接调用生产的 `normalizeSettings`、`mergeSettingsUpdate` 和 `publicSettings`，保留写入/移除密钥、默认值、严格保存和无损规则行为。合成测试的固定判定输入交给真实 `composeDecision` 和原因翻译，因此阈值变化仍通过同一裁决逻辑。fixture 不做自然语言规则匹配，也不评估模型质量。Session 引擎仅预览其真实配置行为，沿用生产界面对冒烟测试的禁用。

业务组件接收 `t`、`resolveText`、稳定的 `ReviewApi` 和必要的 `sessionId`，不直接依赖宿主服务实例。宿主使用其真实 locale 与 CSS 变量；预览注入代表性明暗配色。预览可验证变量适配、布局和文案，但不承诺与任一宿主主题逐像素相同。

## 热更新的真实语义

该固定 revision 的 [Bun HTML 服务](https://bun.com/docs/bundler/fullstack) 在 `development.hmr: true` 下提供 React Fast Refresh 与 CSS 热更新。以下行为经过浏览器实测，详见[验收记录](preview-acceptance.md)。

| 修改 | 结果与状态 |
| --- | --- |
| `panel.tsx` 的展示 JSX | 立即更新；草稿保留，`performance.timeOrigin` 和页面导航计数不变 |
| `src/client/styles.css` | 立即更新样式；草稿保留，不整页刷新 |
| `preview/index.html` | 整页重载；草稿和场景控制回到初始值 |
| 修改组件 Hook 顺序或组件身份 | Fast Refresh 可能重新挂载并丢失状态，应重新建立场景；不保证所有 TSX 编辑都保留状态 |
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

生产包仍只有既有九个文件。CSS 作为文本嵌入 classic ModuleLoader 客户端，在宿主启用/卸载时安装/移除；React 由宿主共享。构建元数据拒绝预览源码和打包进客户端的 React/React DOM。预览服务器、fixtures、浏览器驱动、类型补丁及开发依赖都不会随插件安装。

可复用经验目前限于「业务组件 + 类型化服务 + 宿主/预览入口」这一明确边界。共享工具包、第二插件接入、UI 库、完整 i18n 改写、GitHub template 和脚手架 CLI 均未实现。
