# UI 组件与样式选型验证

状态：2026 年 11 月 12 日的评估原型，尚未正式采纳或部署。基于 main `ced2775cab757bef69a442b1d96b8276b3e84153`，全部开发、安装和构建在独立工作树 `5230/dsh-decision-review`。真实桌面 profile、主目录的链接安装产物和宿主源码不属于本次写入范围。

原型交付版本为 `7423a1af48c9b1723f41739b0e297e48fd8750b6`。独立审查未发现规则编辑器的可行动业务缺陷，但发现三项验收脚本问题；本次仅修复这些问题并补充反例验证，等待独立复审。下文原型截图、依赖探针、体积和安装包记录保留原交付版本；修复后的验证范围见[验收脚本修复](#验收脚本修复)，不把自测通过视作审查关闭。

## 推荐与选项

**当前建议：继续使用 React 原生表单控件，把规则编辑器的样式集中到有插件前缀的 CSS。** 本轮原型就在宿主与预览共用的 `RulesEditor` 中实现，不另造展示副本。四个固定判定选项不需要自定义弹层；新增依赖尚不能带来足以抵消接入与升级成本的业务收益。这个判断针对当前规则表单，不排除以后按明确交互需求接入组件库。

| 组合 | 能解决的问题 | 本项目的代价与判断 |
| --- | --- | --- |
| 原生 React + 局部 CSS | 表单语义、浏览器键盘操作；自主控制卡片、间距、错误与焦点样式 | 无新依赖或编译阶段；原生下拉菜单外观受系统控制。当前推荐，已实现真实原型 |
| Base UI + 局部 CSS | 无样式交互原语，自定义 Select、弹层定位与焦点管理 | 可与普通 CSS 单独使用；Select 依赖 React DOM，需改变本插件外部模块清单并重新验收。已做类型与构建探针，未接入宿主界面 |
| 原生 React + Tailwind CSS | 统一工具类与样式编译约定 | 不替代交互组件或业务校验。需为生产 CSS 文本注入和 Bun HTML 预览提供同一编译结果；当前仅一个局部编辑器，收益不足以立即增加流程 |
| shadcn/ui + Base UI 或 Radix + Tailwind CSS | 可直接修改的组件源码、样式与组合示例 | 是源码分发方式，底层交互和样式仍各有依赖；复制后升级、差异合并、宿主 token 映射归项目维护。暂不引入整套脚手架 |

三者不是同一层面的替代品，也无需一起引入。[Base UI 样式指南](https://base-ui.com/react/handbook/styling)、[shadcn 源码分发说明](https://ui.shadcn.com/docs#distribution)、[Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli)。

## 版本与集成边界

工程保持 React/React DOM `18.3.1`、React 类型 `18.3.31`、Node `>=24.9.0` 和固定 Bun revision `963452075e9d7e2a47a482f297143af5ed4f76c0`。未升级工具链、修改项目依赖或使用 `any` / `skipLibCheck` 掩盖不兼容。已安装 `/usr/local/bin/dsh` 实际为 `0.2.2-rc.2`；宿主验收从运行中的 boot graph 读取 build，不用本地宿主源码版本代替。

[Base UI 1.9.0](https://base-ui.com/react/overview/releases) 的[版本 peer 声明](https://github.com/mui/base-ui/blob/v1.9.0/packages/react/package.json#L153-L170)包含 React、React DOM 和 React 类型 18。隔离探针已严格检查原生、带 Portal 和内联 Select 三个入口，全部通过。Base UI 本身不要求 Tailwind 或应用级主题 Provider；Select/Field 的组合部件依赖各自 Root 的局部 context，业务草稿与服务端校验仍归本项目。

**构建阻碍来自插件当前契约，不是 DSH 没有 React DOM。** `scripts/build.ts` 只允许宿主共享 `react` 与 `react/jsx-runtime`，同时拒绝打入 React/React DOM。带 Portal 和去掉 Portal 的 Base UI Select 均被原样复制的生产构建器拒绝：后者仍通过定位、弹层状态和动画使用 React DOM。探针没有更改生产允许清单，也没有把第二份 React DOM 作为可安装方案。[Portal 源码](https://github.com/mui/base-ui/blob/v1.9.0/packages/react/src/floating-ui-react/components/FloatingPortal.tsx#L125-L130)、[定位调用链](https://github.com/mui/base-ui/blob/v1.9.0/packages/react/src/floating-ui-react/hooks/useFloating.ts#L1-L5)。

官方 [DSH rc.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/web/src/seed.ts#L26-L35) 与 [rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/client/web/src/seed.ts#L26-L35) 源码已经提供共享 `react-dom`。未来可以评估只扩展插件允许清单、仍禁止打包 React/React DOM 的做法；这需要单独的契约决策和匹配宿主验收，本轮未实施。不能从这个源码事实推断 Base UI 的宿主渲染、焦点或弹层已通过。

shadcn 的 [4.23.0 发布点](https://github.com/shadcn-ui/ui/releases/tag/shadcn%404.23.0)对应的 [Base Select](https://github.com/shadcn-ui/ui/blob/96da9cc/apps/v4/registry/bases/base/ui/select.tsx) 和 [Radix Select](https://github.com/shadcn-ui/ui/blob/96da9cc/apps/v4/registry/bases/radix/ui/select.tsx)都默认创建 Portal，包装层未暴露容器参数。官方 v4 组件更新面向 React 19，并移除了 `forwardRef`；React 18 项目不能只看 JSX 能编译，就认定复制的组件及 ref 调用兼容。需逐组件检查并适配。[shadcn v4 指南](https://ui.shadcn.com/docs/tailwind-v4)。本轮没有运行 shadcn 初始化器或声称全部组件不支持 React 18。

## 样式、主题与弹层

原型仅调整规则区域，CSS 类和变量以 `decision-review-` 为前缀，映射现有 `--dsw-*` 色彩、圆角和焦点变量。没有全局 reset、`:root` 主题定义或独立 Provider。样式继续随插件启用注入、卸载移除；既有 Node probe 覆盖该生命周期。聚焦卡片使用整体表面与边框反馈，控件另有清晰的 `:focus-visible` 描边。

若后续采用 [Tailwind 4.3.5](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.5)，应分别导入 theme/utilities、禁用 Preflight、限定源码扫描路径，并配置工具类/生成变量前缀。前缀不等于完整的 CSS 作用域隔离；不应直接复制 shadcn 的全局 `:root`、`.dark` 或基础选择器。需要检查生成 CSS 而不只检查输入文件。[禁用 Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight)、[限定扫描范围](https://tailwindcss.com/docs/detecting-classes-in-source-files#disabling-automatic-detection)、[shadcn 默认主题](https://ui.shadcn.com/docs/theming#default-theme-css)。Tailwind 在构建时生成 CSS，没有浏览器 JavaScript 运行时；本轮没有实测它的构建耗时或包体积。

Base UI Select 默认 Portal 到 `body`，支持指定元素、ShadowRoot 或 ref 容器。React context 随 React 树传播，但 CSS 变量与祖先选择器依赖实际 DOM 祖先；局部主题容器、滚动裁切、叠层顺序与关闭后焦点都需实测。原型使用原生下拉框，不引入这些弹层路径。[Select Portal API](https://base-ui.com/react/components/select#portal)、[React createPortal](https://react.dev/reference/react-dom/createPortal)。

## 原型行为与验证

原型保留原有增删、修改条件与判定结果、数量/字符限制、保存校验以及父表单草稿逻辑。当前业务没有单条规则启停或排序字段，本轮没有新增这些能力。多行条件不做 trim、分隔或重写。新增规则聚焦条件框；删除时聚焦下一条、上一条或空列表的添加按钮。规则按有序列表组织，标签、必填状态、字符计数与逐项错误保留可访问的关联。

共享预览的 15 组浏览器检查通过，见 [完整请求、错误与断言](evidence/ui-evaluation/preview-acceptance.json)。其中新增了 Tab/Shift+Tab、字符键选值、焦点描边、标签/必填/错误关联、增删后焦点、中英文切换保留规则、390px 长文本及超长错误、保存中继续修改规则。已有 HTTP 错误恢复和场景取消检查仍通过。所有请求留在 localhost，没有未处理运行异常。

[中文浅色规则](evidence/ui-evaluation/zh-light-rules.png) · [英文深色窄屏](evidence/ui-evaluation/en-dark-narrow-rules.png) · [窄屏超长规则错误](evidence/ui-evaluation/en-dark-narrow-long-rule.png) · [空规则校验](evidence/ui-evaluation/zh-validation.png)。已实际查看截图，未见横向溢出、重叠或错误遮罩。

内置 Browser 在本次会话不可用，主要验证使用 Bun.WebView 的独立 Chrome 后端。原生下拉框的方向键序列在 Bun.WebView 和 Playwright 交叉检查中均未改变选值；两者的字符选择成功，中文“拒”和英文“d”均可选中 deny。自动化记录的是实际通过的字符选择，不把它写成方向键菜单验收。浏览器检查不等价于 VoiceOver 人工验收，未验证 IME 组合输入、原生菜单全部键位、所有浏览器或触屏。预览使用合成接口，宿主仅使用一次性 profile，不调用模型。

隔离安装后的 DSH `0.2.2-rc.2`、build `a6b1b85` 完成 6 组真实浏览器检查：ModuleLoader 挂载与单份样式、键盘字符选值、保存后退出/重进页面逐字一致、空规则校验、增删焦点、宿主明暗主题与 390px 窄屏。窄屏等待宿主响应式侧栏动画完成，编辑区宽 345px；检查条件框左/中/右三点均无遮挡，不能只以没有水平溢出代替可用性。见 [宿主 JSON](evidence/ui-evaluation/host-acceptance.json)、[浅色截图](evidence/ui-evaluation/host-zh-light-rules.png)、[深色截图](evidence/ui-evaluation/host-zh-dark-rules.png)、[窄屏截图](evidence/ui-evaluation/host-zh-dark-narrow-rules.png)。该测试没有调用冒烟或模型接口，没有 console warning/error 或未处理异常；临时 profile 已停止并清理。真实用户 profile 的当前进程加载验收仍是另一项待办。

临时 HOME 下 Chrome 写 cookie 的最小探针出现等待；同一探针使用测试专用 mock keychain 后完成。因此宿主浏览器验证为一次性 Chrome 配置指定 mock keychain/basic password store，避免访问真实钥匙串；这些参数不写入真实浏览器或系统设置。验收脚本在页面加载后模拟系统明暗偏好，观测真实宿主的主题属性与计算色值变化，没有直接改写插件颜色或宿主主题 DOM。

工程检查（严格类型、lint、格式及 265 项测试）通过。安装包验收从两份干净副本构建，目录与归档的九个文件一致；空缓存离线安装、Node `24.22.2` 探针及 246 项安装字节回归通过。两次 tarball SHA-256 均为 `1e32c400616da62e68d08e0489fbb4b3353dc81f6c17e96d8a659ce8990b114c`，见 [安装包证据](evidence/ui-evaluation/package-verification.json)。

## 验收脚本修复

三项修复及前后对照汇总于 [review-fixes.json](evidence/ui-evaluation/review-fixes.json)，其中记录了被验证脚本的 SHA-256、实际事件与时序观测。原始日志、反例脚本及完整浏览器 JSON 保留在本实施工作树的 `artifacts/ui-evaluation/review-fixes/`。

1. **失败记录先于辅助截图写入。** 浏览器创建或启动失败时，先用失败 JSON 替换旧通过记录，再尽力截图；截图或关闭失败只作为辅助诊断，保留首要错误并非零退出。持久回归在原样 verifier 源码前注入浏览器替身，检查“已有通过记录 + 启动失败 + 截图失败 + 关闭失败”，并在截图执行前读取失败 JSON。相同两项用例在旧脚本上均失败，在修复后通过。
2. **识别真实 warning 事件。** 过滤同时包含 `error`、`warn` 和 `warning`。在独立 Chrome 的 `about:blank` 执行真实 `console.warn`，再完成临时 DSH 原流程：固定 Bun 返回 `warning`；旧脚本错误通过，修复后写入失败记录并退出 1。原交付的正常宿主记录确实没有 warning，不因这次注入反例将旧成功记录改称失败。
3. **证明修改完成于保存响应之前。** 保存中编辑用例确认新请求已发出；模型和规则修改完成后，同时断言表单仍在保存、该请求尚未收到 HTTP 响应，再截图并等待响应，检查新草稿未被覆盖、重载仍得到提交时的旧值。人为在编辑前延迟 2,600ms、确认保存已结束后，旧脚本仍通过，新脚本明确失败；没有增加服务端延时或改动业务保存行为。

本次严格检查与 **267 项测试**通过，正常预览 **15 组**、临时 DSH `0.2.2-rc.2` / `a6b1b85` **6 组**回归通过。正常预览实际记录 `savingAfterEdits=true`、`responsePendingAfterEdits=true`，随后 HTTP 200；正常宿主没有 warning/error 或未处理异常。所有重检查串行执行，未调用模型。

重新构建的客户端 SHA-256 仍为 `3751bcfad0ca69db590d319ca7b2faefdf0be6014db2eba150c99fe86b56d916`，与独立审查的原交付字节一致；本次没有修改产品源码、样式或依赖。既有客户端截图、Base UI 探针和完整本地包验证按上述交付版本复用，没有重复生成交付截图或重复运行无关探针。原生菜单方向键、IME、屏幕阅读器、真实用户 profile 和候选库真实接入的边界保持不变。

## 体积与维护成本

测量使用固定 Bun、当前生产 CJS 包装和 gzip level 9，没有额外开启 minify。基线完整客户端为 **44,443 B / gzip 12,460 B**；原型为 **50,401 B / gzip 13,531 B**，增量 **5,958 B / gzip 1,071 B**。这是传输体积测量，不是加载速度或交互性能结论。项目运行时和开发依赖均没有增加，独立九文件安装包契约保留。

[Base UI 探针证据](evidence/ui-evaluation/dependency-probe.json)包含冻结依赖及完整 peer 解析结果：Base UI 之外有 8 个运行时传递依赖（不计 peer），React/React DOM 各解析到一份。下表是独立 Select 示例，不可直接与完整插件相减当作接入增量。

| 独立入口 | 原始字节 | gzip 字节 | 实际结果 |
| --- | ---: | ---: | --- |
| 原生 Select | 2,784 | 1,015 | 生产构建器通过 |
| Base UI Select + Portal | 1,191,969 | 203,489 | 打入 React DOM，生产构建器拒绝 |
| Base UI Select 内联 | 1,191,302 | 203,371 | 同样拒绝 |
| Base UI + Portal，额外 external React DOM | 331,427 | 69,443 | 仅诊断测量，不符合本轮插件契约，未装入宿主 |

源码分发会减少开始时的样式编写，却不会免除后续维护。直接用 Base UI 时主要审查原语版本及交互回归；使用 shadcn 时还要合并本地组件源码差异；使用 Tailwind 时需要维护编译、扫描及预览热更新一致性。当前纯 CSS 由项目维护，增长后也应按实际重复整理。跨插件复用可以沿用既有业务组件/服务/宿主入口分离，本轮不提取共享工具包或 template。

## 复现与后续实施

```sh
bun install --frozen-lockfile
bun run check
PREVIEW_PORT=0 bun run dev
# Use the printed localhost URL in another terminal.
bun run verify:preview -- http://127.0.0.1:PORT
bun --no-env-file scripts/probe-ui-dependencies.ts
bun run verify:package
bun run verify:host --dsh /usr/local/bin/dsh --browser dist
```

探针在专属临时目录冻结安装依赖并清理，不修改项目 lockfile。若存在 `artifacts/ui-evaluation/baseline/client.js`，它会同时测量该基线；没有该文件时明确输出 `null`，不伪造基线。基线可在当前工作树的 `artifacts/` 下从 `git archive ced2775` 解包、冻结安装和构建后取得，不能在真实客户端所链接的主目录重建。原生原型的字节数用 `dist/client.js` 与该基线按同一 gzip 参数比较。

1. **本批交付审查**：审查局部原型和证据，确认是否采纳原生控件 + CSS；原型本身不代表正式选型。未合并、发布或部署。
2. **后续按需求逐项接入**：若确认原生方案，先处理真正重复的表单/反馈样式，再评估整体界面；完整 i18n 和真实用户 profile 验收仍保持独立待办。
3. **复杂交互出现时再评估 Base UI**：单独决定共享 React DOM 允许清单，选一个真实需要自定义弹层的控件，验证 Portal 容器、宿主主题、焦点与 Node/打包契约。shadcn 和 Tailwind 分别决定，不捆绑引入。至少两个插件证实复用需求后，再考虑提取共享层。
