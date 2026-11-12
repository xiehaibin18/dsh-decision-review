# 独立预览验收记录

验收日期：2026 年 11 月 12 日。固定 Bun revision：`963452075e9d7e2a47a482f297143af5ed4f76c0`。应用内 Browser 不可用，因此使用 Bun.WebView 的独立 Chrome 后端，页面均为 localhost。表单输入和按钮点击使用浏览器原生事件；选择框通过 DOM change 事件操作，未直接修改 React 状态。视口覆盖 1280px 宽屏与 390 × 844 窄屏。

## 可复现步骤与结果

先启动预览，再执行完整浏览器驱动：

```sh
PREVIEW_PORT=0 bun run dev
bun run verify:preview -- http://127.0.0.1:PORT --hmr
```

脚本保存完整请求、console、运行异常、热更新导航计数和检查结果到 `artifacts/browser/acceptance.json`。以下 16 组检查已通过；截图为相同实现的实际浏览器输出。

| 操作组合 | 实际结果 |
| --- | --- |
| 中文、浅色、宽屏、Decisions，运行合成冒烟测试 | 显示三行结果和会话统计 |
| 修改模型但不保存，切换英文/深色/窄屏，再缩小浏览器至 390px | 草稿保留，测试按钮禁用，文案换行正常，无水平溢出 |
| 保存再重新加载配置 | HTTP 保存成功，规范化后的值仍在 |
| 英文、浅色、窄屏、跟随会话 | 隐藏 Decisions 字段，测试按真实业务规则禁用 |
| 配置加载失败，再恢复接口 | 显示 HTTP 503 对应错误，恢复后自动加载 |
| 保存失败，再恢复和重试 | 草稿保留，重试保存成功 |
| 多行条件保存/重新加载，再添加空规则并保存 | 空行、缩进、中英文、竖线、末尾空格与换行逐字保留；空规则阻止保存并显示提示 |
| 无效配置场景，直接保存再修复地址与模型 | 首次被真实校验拒绝；修复成功后错误提示消失，跟随会话保持选中 |
| 慢加载中切到跟随会话，等待原请求时间过去 | 旧场景不会覆盖新表单 |
| 慢保存中继续修改模型 | 显示保存中，测试禁用；保存结束保留后续编辑，重新加载读到提交时的值 |
| 慢测试中切到跟随会话 | 旧结果不会出现在新场景 |
| 测试接口失败恢复，再切到混合结果场景 | 整体错误可恢复，单行失败与成功/拒绝结果正常共存 |
| 统计失败恢复，再切到暂无统计 | 下一次轮询恢复；零评审时 pill 隐藏 |
| 在真实 `panel.tsx` JSX 中加入可见标记，再修改共享 `styles.css` 轮廓 | 草稿仍为 `hot-refresh-unsaved`；两次更新的页面导航计数均保持 1，`performance.timeOrigin` 不变 |
| 修改 HTML 入口标题 | 页面导航计数变为 2，`timeOrigin` 改变，草稿回到初始 fixture |
| 检查所有浏览器请求与未处理运行异常 | 请求全部留在 localhost；未捕获未处理运行异常 |

实际请求包含故意制造的四次 HTTP 503、无效配置保存的 HTTP 400，以及取消/中断中的请求。它们属于上述故障场景；没有外部模型请求。浏览器驱动没有捕获其他 `console.warn/error`；Bun 服务端输出了无效 fixture 的预期配置校验警告。截图检查未发现横向溢出、重叠或错误覆盖层。

## 截图

[中文浅色与合成测试结果](evidence/preview/zh-light-wide-results.png) · [英文深色窄屏草稿](evidence/preview/en-dark-narrow-dirty.png) · [多行规则及保存校验](evidence/preview/zh-multiline-validation.png) · [真实 TSX 与 CSS 热更新](evidence/preview/shared-tsx-css-hmr.png)。

## 工程与宿主证据

严格类型检查、lint、格式检查以及原生测试和 CI 模式均通过：246 项生产业务/防线回归（原有 242 项保留并增加 4 项客户端生命周期用例）与 12 项预览服务边界用例，共 258 项。CI 模式沿用 seed `963452075` 和两个 worker，生成统一 JUnit/LCOV。

`bun run verify:package` 已通过真实 pack/prepack、两次干净构建、九文件归档、空缓存离线生产安装及 246 项安装字节回归。两次 tarball SHA-256 均为 `982ba53c2bff68963f9416f1bb1ea727c229d004d5d205a091ebc9eac05d6de8`。独立 Node `24.22.2` 探针通过生产 exports、资源、ModuleLoader、共享样式注册/清理和两个引擎检查；消费目录没有 Bun、源码或开发依赖。可移植证据见 [package-verification.json](evidence/preview/package-verification.json)。

最新归档还通过既有临时 DSH 验收入口的加载、未认证 401、认证配置读写、Client 资源及中英文插件清单检查。实际 Host 为 `0.2.2-rc.1`、build `c59d10a`。随后在隔离 Chrome 中从「插件 → 决策评审 → 包含的组件 → 决策评审」打开真实配置页：共享 CSS 仅注入一次且布局生效，切换跟随会话并保存成功；输入含空行、缩进、竖线和末尾换行的合成规则，保存并退出/重新进入后逐字一致；切回 Decisions 后，未保存/已保存状态正确控制冒烟按钮。没有发送冒烟或模型请求，HTTP 请求均为 localhost，另有内联 data URL 图标；没有 console 错误或未处理运行异常。见 [宿主截图](evidence/preview/host-configuration.png) 和 [浏览器结果](evidence/preview/host-acceptance.json)。临时 profile 已停止并清理。

宿主浏览器验收聚焦本次改变的入口、共享样式和配置行为；没有在真实 Host 发起模型评审或验证有评审记录的 composer pill。统计轮询和双引擎裁决仍由共享预览、生产回归及独立 Node 探针提供合成证据。远端 CI 状态记录在 PR 中。

## 范围与限制

此验收覆盖共享 UI 的合成状态与交互，不评估模型判定准确率，不执行自然语言规则匹配。预览的明暗色值是宿主变量的代表性注入；宿主主题和语言仍由真实 DSH 管理。Hook 顺序/组件身份变化可能重挂载；服务器与 fixture 改动需要重启服务并刷新页面。HMR 标记与样式在验收后均已还原。

实际使用中的 DSH profile 未被修改或重启。本次交付不包含 UI 库选型、整体 UI 重设计、完整 i18n 审校、共享工具包或第二插件接入。
