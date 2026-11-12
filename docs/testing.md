# 测试与 CI

Bun 负责测试编排；生产插件仍由 DSH 的 Node 宿主运行。测试直接加载构建后的 `dist`，不以源码导入替代交付产物。固定工具链与安装步骤见[开发指引](development.md)。

## 迁移基线与覆盖映射

迁移基线是 PR #3 合并提交 `4ac7576`，本次先在 Node 24.22.2 复现了 143 项通过、无跳过的测试。原安装包验证会在已安装字节上运行其中 142 项，另 1 项真实 React/jsdom 测试需要开发依赖。迁移不保留第二套 Node 测试运行器；输入表改为 `test.each` 后，每个输入有独立的失败名称，因此数量不再与原测试一一对应。业务回归仍为 228 项：纯逻辑由 37 项展开为 85 项，服务端由 87 项展开为 121 项，客户端由 19 项增至 22 项。除拆开原有多场景断言，还补充了临界值、实际超时、取消和轮询清理检查；没有删除原有业务检查。另有 14 项 preload 防线检查，总计 242 项。

| 测试文件 | 保留的业务边界 | 迁移方式 |
| --- | --- | --- |
| `answers` | 完整答案、缺失/重复/错误类型、拒答、概率与规则编号 | 原生错误匹配与命名输入表 |
| `compose` | 硬拒绝优先级、授权阈值、规则组合、拒答、双语原因、数字字符串兼容行为 | 确定性 `expect` 断言及边界表 |
| `settings` | 超时与概率边界、规则数量/长度、无损多行规则、endpoint/model 校验 | 独立边界用例及 `test.each` |
| `stored-settings` | 无效配置暂停、显式修复、保存原子性、备份、密钥和错误不回显 | 临时 profile、fetch spy、持久化断言 |
| `review-flow` | 完整审查输入、两个拒绝路径、下游限制、硬拒绝、统计和 trail | 原生 mock/断言，假时钟验证超时与取消 |
| `session-engine` | 严格流协议、结束原因、完整上下文、撤销与后续限制、会话路由 | 异步拒绝匹配、协议表、假时钟 |
| `routes` | 受保护路由注册、配置/保存/统计/烟测、密钥不回显、烟测冻结配置 | spy、临时文件、请求/响应断言 |
| `host-integration` | profile 选择、恢复与子会话权限、Auto 注册/卸载、取消并排空评审 | 生命周期 hooks、临时目录、异步清理 |
| `client` | 模式切换、保存状态、非法配置修复、多行规则、中英文和统计轮询 | 真实 React/jsdom、原生 mock、时间与清理控制 |
| `client-dom` | 构建的 classic ModuleLoader、真实 React 挂载、保存和重新加载 | jsdom + React act，完整卸载与全局恢复 |
| `preload` | 导入、初始化、测试及收尾阶段的意外 fetch 不得漏报；后续用例和文件不受污染 | 真正启动 Bun 子进程，核验退出码、诊断、正常对照及临时 profile 清理 |

所有审查输入、密钥和会话都是合成数据。Connection 的鉴权声明由模拟宿主测试检查；真正 HTTP 401 和认证 cookie 的有效性属于独立 DSH 验收，不能从模拟路由调用推断。

## 运行与复现

```sh
bun run test
bun run test --randomize --seed=12345
bun --no-env-file test --isolate test/session-engine.test.js
bun --no-env-file test --isolate -t 'timeout'
bun run test:ci
bun run verify:package
```

`test` 和 `test:ci` 会先构建；直接调用 `bun test` 前需先构建。`bunfig.toml` 的 `env = false` 禁止外层命令和子进程自动加载本地 `.env`，测试命令还显式使用 `--no-env-file`。`test/preload.js` 在测试导入前设置临时 profile 和临时 home，并默认拒绝所有 fetch；计数只在检查并报告后清零，preload 的 afterEach 和最终 afterAll 覆盖导入、beforeAll、测试正文和收尾阶段；即使业务代码捕获错误，遗漏合成替身的请求也会使进程失败。每个套件负责恢复自己的 spy、模拟时钟、DOM、环境和临时文件。

使用 `--isolate` 为每个文件建立新的全局对象和模块注册表。文件内修改 fetch、console、环境、DOM 或时间的测试保持串行；没有启用全局 `--concurrent`，也不使用 retry 掩盖污染。不要用 `mock.module` 替换真实插件或 React 模块。当前没有需要维护的大型快照，业务结果使用有判别力的字段断言。

`test:ci` 采用两个隔离 worker 并行运行文件；结果与报告经过串行对照验证。日常 `test` 默认串行隔离，便于定位；共享状态用例在文件内串行，客户端用例还显式声明 `test.serial`。该 revision 支持 `--shard` 和耗时分配，但当前仅十一个文件，未增加分片作业和耗时缓存。

`test:ci` 使用随机顺序和固定 seed `963452075`。复现时保留日志里的 seed 和同一 Bun revision。时间测试用 `jest.useFakeTimers` 启用假时钟，最后用 `jest.useRealTimers` 恢复。`jest.setSystemTime` 调整系统时间，`jest.advanceTimersByTime` 同步推进假时钟并触发到期的定时回调和 `AbortSignal.timeout`。评审测试在推进后显式等待结果，客户端统计测试在 React 的 `act` 中推进时间并等待界面更新。

JUnit 位于 `artifacts/test/junit.xml`，文本覆盖率输出到日志，LCOV 位于 `coverage/lcov.info`。覆盖率针对加载的构建代码；classic 客户端通过 VM/jsdom 执行，不能把这份统计当作完整客户端源码覆盖率。因此暂不设置会造成错误信心的全局覆盖率门槛；客户端行为由真实挂载及交互断言保护。

## 安装产物和生产 Node

`verify:package` 冻结安装两个独立源码副本，检查类型并构建，比较 tarball SHA-256。它将 `dist/` 复制到源码树之外，在各自的空缓存中离线安装目录和 tarball，并比较安装后九个文件的内容。两种形式分别由独立 Node 子进程从包名加载，验证导出、资源及关键行为。生产消费目录没有源码和开发依赖，Node 进程使用隔离环境和无 Bun 的 PATH。Bun 通过独立测试目录在相同的安装字节上重跑完整回归，包括真实 React/jsdom。Node 验证入口只使用 Node 内置 API 和共用合成 fixtures，不另建长期分叉的业务套件。

构建、安装和 Node 验证证据保存在 `artifacts/verification/`。目录受 Git 忽略，CI 会上传作为限时保留的构建附件；失败日志用于定位具体阶段。真实 DSH 的加载、认证 HTTP 和资源交付仍使用现有独立入口：

```sh
bun run verify:host --dsh /usr/local/bin/dsh dist
bun run verify:host --dsh /usr/local/bin/dsh artifacts/local-decision-review-0.1.0.tgz
```

CI 不安装或启动真实 DSH，也不声称完成宿主验收。该入口的隔离及范围见[宿主验收说明](host-verification.md)。禁止用真实模型、真实用户 profile 或运行中宿主代替测试 fixtures。

## GitHub Actions

工作流响应 pull request、main push 和手动触发，权限只有 `contents: read`，不发布或部署。Ubuntu 24.04 x64 上使用固定 npm 分发 `bun@1.4.3-canary.20261021.1`，每次核对完整 revision，不使用 `latest` 或 `canary` 浮动标签。官方 npm 元数据已确认对应 Linux x64 平台包存在，远端 CI 执行负责验证其实际功能。

工程检查作业在 Node 24.21.0 上执行格式、类型、lint、构建和原生测试。安装包作业覆盖 Node 最低支持版本 24.9.0 和此前验收过的宿主版本 24.21.0。两个版本用于检出生产运行时差异；没有扩张为多操作系统与多 Node 大矩阵。本机 macOS arm64 验证提供另一平台的开发工具证据，不等同于所有平台支持。

仅缓存 Bun 下载依赖，键包含系统、架构、revision 和锁文件 hash；缓存命中后仍执行 frozen install 与工具链检查。工具链和 `node_modules` 不从缓存恢复。Actions 固定提交 SHA，checkout 不保存推送凭据。JUnit、覆盖率和安装包证据通过 `always()` 上传，保留 14 天；失败不自动重试。

参考：[Bun 时间控制](https://bun.com/docs/test/dates-times)、[隔离和并行](https://bun.com/docs/test/parallel)、[配置与报告](https://bun.com/docs/test/configuration)。文档描述不替代锁定 revision 的实测；新增 API 时同时检查该二进制和真实 CI。
