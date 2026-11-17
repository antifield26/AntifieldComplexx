# AGENTS.md — AntifieldComplexx 工程约定

本项目是个人综合交互平台，以统一账号整合个人数据与分享、Minecraft 与 mcbot、QQ Bot、DeepSeek Harness（DSH）工作区、主机监控及备份灾备。`apps/workbench` 是 Web 端技术名。

## 1. 开始任务与授权边界

- 先检查 `git status --short --branch`、HEAD 和已有改动；保护用户未提交的内容，不擅自覆盖、清理、切分支或回退。需要新分支时使用 `codex/` 前缀。
- 明确本次任务属于分析、规划、实现、部署还是发布。按已授权范围持续完成；已有授权不重复询问，分析与规划不自动扩展到实施或生产变更。
- 修改前按下表读取适用的局部 AGENTS 与权威文档。从根目录启动也要主动读取相关局部指令；跨目录改动读取各自说明，并在任务更新中说明范围，无须为每次任务改写本文件。
- 用户在任务中的明确指令优先于仓库约定；发现代码、文档或现场状态冲突时先核对拥有该行为的代码或只读证据，说明差异，不把历史记录当成当前事实。
- Cloudflare 后台、QQ 开放平台登记、密码/TOTP/恢复码设置、离线私钥保管及 Windows 备份计划任务的管理员安装由用户完成。可准备和校验脚本；任务中明确授权的操作按授权执行。密码、验证码和私钥内容不得索取到聊天中。
- 不修改现有 Minecraft/OpenCode/frpc/SSH 配置，不重启 Minecraft，除非用户明确授权且已有备份。更改防火墙前必须确认当前 SSH 来源仍可达并保留回滚通道。旧 PiForge 残留保持原样。

## 2. 按任务读取

下表路径均相对仓库根；局部约束补充根规则，不得降低跨模块安全边界。

| 改动范围 | 必须读取的局部指令 | 按需读取的文档 |
|---|---|---|
| React、Tauri、Windows/Android | [客户端](apps/client/AGENTS.md) | [API](docs/API.md)、[UI-SPEC](docs/UI-SPEC.md) |
| Workbench 服务端、SQLite | [服务端](apps/workbench/server/AGENTS.md) | [API](docs/API.md)、[ARCHITECTURE](docs/ARCHITECTURE.md)、[SECURITY](docs/SECURITY.md) |
| Minecraft Bot、动作与自主会话 | [mcbot](apps/mcbot/AGENTS.md) | [MCBOT](docs/MCBOT.md)、[API](docs/API.md) |
| 备份、恢复、部署与检查脚本 | [脚本](scripts/AGENTS.md) | [DEPLOY](docs/DEPLOY.md)、[ACCEPTANCE](docs/ACCEPTANCE.md) |
| systemd、主机与运行时配置 | [部署](deploy/AGENTS.md) | [DEPLOY](docs/DEPLOY.md)、[SECURITY](docs/SECURITY.md) |
| DSH 包装器、插件、SSO | [部署](deploy/AGENTS.md)、[DSH](deploy/dsh/AGENTS.md) | [CHATBOT](docs/CHATBOT.md)、[MCBOT](docs/MCBOT.md)、[DEPLOY](docs/DEPLOY.md) |
| 文档、根 README/CHANGELOG/AGENTS | [文档](docs/AGENTS.md) | [INDEX](docs/INDEX.md)、[PLAN](docs/PLAN.md)、[AUDIT](docs/AUDIT.md) |

事实各有唯一维护位置，其他文档只保留必要摘要与链接：

- 产品版本：根及各工作区 `package.json`；schema、契约和 DSH 等期望版本：[tool-versions](deploy/tool-versions.json)，并与实际迁移和契约常量交叉校验。
- 当前范围：[PLAN](docs/PLAN.md)；版本沿革：[ROADMAP](docs/ROADMAP.md) 与 [CHANGELOG](CHANGELOG.md)。范围变更须由当前任务明确支持，不能由 Agent 自行扩大。
- 操作与回滚：[DEPLOY](docs/DEPLOY.md)；已观测的部署、包哈希和验收缺口：[ACCEPTANCE](docs/ACCEPTANCE.md)；残余风险：[AUDIT](docs/AUDIT.md)。现场事实必须带日期与来源，生产操作前复核。
- 实际地址及受限文件位置只查 gitignored 的 `.local/DEPLOYMENT.md`，按任务需要最小读取，不批量输出 `.local`、环境文件或凭据。

## 3. 跨模块安全边界

- 密码、TOTP、Cookie、Authorization、平台凭据、设备私钥与 age 私钥不得进入仓库、日志、错误响应、前端 bundle 或审计正文。公开文档只用 `app.<domain>`、`ai.<domain>`、TEST-NET 等占位值。
- 文件访问只经 DB id，不接受客户端路径；内容不可变，禁止覆盖上传。预览仅允许白名单类型内联，SVG/HTML/XML 强制下载；文本预览上限 1 MiB。
- 应用 API 的写请求要求 CSRF；经设备签名验证的 Bearer 可豁免 CSRF。非法 `Authorization` 不回退 Cookie。Cookie 保持 `HttpOnly + Secure + SameSite=Lax`，仅 loopback HTTP 可例外。
- AI 代理与 mcbot 上游只走启动校验过的固定 loopback；覆盖浏览器传入的 Authorization，HTTP/WS 均校验 Origin。原生远端 AI 页面不得获得设备命令能力。
- 应用 Minecraft API 只提供白名单增删和只读状态，不提供任意 RCON、启停、封禁或 OP。世界备份脚本是固定 RCON 动词的受限例外，不能从应用 API 触达。
- 备份私钥只离线保存且至少两份，Pi 只持独立公钥。启用整包加密时失败关闭，不降级明文；Web 对加密归档在读取/解包前返回 `409 archive_encrypted`。异地副本只上传 `.age`，保留最新 full 及其增量链。
- 备份、拉取、演练与异地状态由 root/PC 脚本写，应用只读；状态不含密钥或远端真实路径，读取上限 64 KiB，失败降级 null。部署和备份脚本必须幂等、可重试，错误可诊断。
- 审计失败不能回滚已完成的业务，也不能静默吞掉：事务外 best-effort 记录失败计数与最近错误到 `/api/version.audit`；安全关键审计逐条记录，公开下载计数保持在事务内。
- 生产 QQ 与 Minecraft Agent 由独立 DSH 环境管理。Workbench 不恢复旧 QQ 收发/发布、OpenCode Chat、QQ 告警入队或旧上下文文档目录；告警只走 webhook。OpenCode 仅作离线回滚运行时。
- mcbot 读/控制 Token 分离且不进入浏览器。动作须经主人显式指令和白名单；急停先撤销执行权，不经过模型。聊天、事件和 DSH 步骤仅存内存，不向应用 SQLite 写入正文或工具参数。
- 数据库迁移集中在 `apps/workbench/server/src/db.ts`，只追加、不修改已发布迁移；高于程序支持 schema 的数据库拒绝启动。同 schema 回滚保留现行 DB/WAL；跨 schema 回退先保全现行库，再按 DEPLOY 验证并使用匹配快照，不能只切 release。

## 4. 编码与兼容约定

- 除根 CHANGELOG 与 docs/ROADMAP 外，文档只描述当前行为、配置、操作和验收状态；不写引入版本、改动经过或逐次发布叙述。日期仅用于当前证据时间、资源标识或协议示例，变更经过统一归入上述两份文件。
- 代码注释、文档、提交信息和 UI 文案使用中文，技术标识符除外。注释说明当前职责与约束，不写修复历史或轮次。新建模块顶部说明职责与安全边界；已有模块按相关改动补充，避免无关格式化。
- Node >= 26，服务端原生 TypeScript 直接运行，不引入服务端编译/打包；相对导入带 `.ts`，不使用 enum/namespace/参数属性等非可擦除语法。不使用 Docker，Pi 使用 systemd。
- 前端源码在 `apps/client`，Vite 产物写入 `apps/workbench/web/dist`。运行时依赖放 `dependencies`，React/Vite/ESLint 等构建依赖放 `devDependencies`，兼容 Pi 的 `npm ci --omit=dev`。
- 保留 TS7 与 TS6 双 alias：`@typescript/native` 提供 tsc，`typescript` 的 TS6 alias 供 typescript-eslint 使用；未验证其 API 兼容前不合并或删除。具体版本从锁文件读取。
- 产品显示名为 **AntifieldComplexx**。既有 `antifieldcloud` 路径、用户/组、systemd 单元、Windows 任务名、`%LOCALAPPDATA%\AntifieldCloud`、webhook source/HMAC 头、恢复码哈希域盐和历史缓存标识保持兼容。运行时改名必须单独迁移，不顺手替换。
- 时间存 ISO 8601 UTC，展示使用 `Asia/Shanghai`。提交信息使用 Conventional Commits，说明正文用中文。

## 5. 验证与交付

命令默认从仓库根执行。开发过程中先跑受影响范围的验证，代码交付前完成全量门禁；同一代码状态已通过的检查无需无理由反复运行。

| 任务 | 验证要求 |
|---|---|
| 只读分析/规划 | 核对代码与文档，报告证据和未检查范围，不要求构建 |
| 仅文档/工程指令 | `npm run check:agents`、`npm run check:docs`、`npm run check:naming`、`node scripts/check-version.mjs --quiet`、`git diff --check` |
| 服务端或脚本逻辑 | 相关成功/失败夹具；最终 `npm run check`、`npm run build`、版本检查 |
| 客户端或原生逻辑 | 相关 UI/Rust 回归；最终全量检查与构建，涉及原生时完成对应平台 CI；不得把 UI mock 当真机验收 |
| mcbot 或 DSH 逻辑 | 相关任务/会话/权限夹具；最终全量检查；运行时安装与真实平台仅在获准候选/验收范围内验证 |
| 部署/发布 | 在代码门禁外，按 DEPLOY 核对备份、回滚源与健康状态，并逐项记录实际验收结果 |

常用命令：`npm ci`、`npm run dev`、`npm run dev:web`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:web`、`npm run check:mcbot`、`npm run check:client`。

- `npm run check` 包含应用、mcbot、命名、工程指令、文档声明及客户端版本检查。CI 还要求 coverage、audit、secret-scan、依赖边界及适用原生构建全绿。前端入口体积门禁随生产构建检查。
- 自动化测试只用进程内假平台、临时目录及 loopback 夹具，不访问真实 Minecraft、QQ、模型、Cloudflare、Pi 或外部网络。Windows 无法运行的 systemd 用例明确 skip 并由 Linux CI 验证。真实平台负路径放隔离候选，生产只执行获准验收。
- 新逻辑覆盖成功与失败路径；修复补能复现问题的回归。纯文案与低影响可逆改动无需编写镜像测试。指令检查只证明预算、引用及命令存在，不证明所有文档语义或生产行为正确。
- API 变更同步 API，交互变更同步 UI-SPEC，部署/灾备变更同步 DEPLOY。验收记录标明提交、环境、时间和结果，区分夹具、CI、候选、生产与用户真机证据；失败、跳过和待用户操作不得写成已通过。
- 每阶段报告产出、未决问题与验证证据。发布时区分 Tag、应用基包 commit、DSH runtime 和现场覆盖补丁哈希；文档提交不能冒充已部署代码。
- 本文件只保留稳定规则与读取入口；根文件预算 12 KiB、局部文件 8 KiB、根到叶累计 24 KiB，为全局指令留余量。修改指令时同步更新导航并执行 `npm run check:agents`。
