# Changelog

## [v1.2.2] - 2026-11-13

- 消息发送失败不再阻断后续队列；自主进食在装备等待后重新检查停止状态。
- 状态文件采用同句柄、64 KiB 实际字节上限，告警与维护入口一致降级。
- 矿物与天然林只自动记录已扫描并复核的资源点；主世界、下界与末地分别保存记忆，备份兼容历史清单。
- MC 面板增加本地自然语言目标草案，可编辑标题和步骤；明确确认创建，开始仍走原有二次确认。
- AI 反代替换为固定 httpxy 0.5.6，保留 HTTP／WebSocket、SSO、流式与失败响应边界。
- 整包 age 加密已启用，固定动词维护入口替代无限免密 sudo；独立 rclone 配置参数支持替换异地服务，OneDrive 因回下载失败未通过验收。
- QQ 启动或断连持续未就绪 90 秒后结束子进程，5 秒宽限后强制收口，由 systemd 恢复；日志不记录平台正文或凭据。
- Google Drive 应用密文链通过分段、回下载解密及云端隔离恢复，自动任务实跑通过；远端名称规范化，拒绝误用本地路径。
- schema 21、mcbot 契约 v2、DSH 与 13 个自主工具不变。双端登录通过，MC 真机验收按用户要求跳过；完整 Access smoke 39／0，应用与世界恢复演练通过。交付证据见 docs/app/ACCEPTANCE.md。
- 已发布 annotated Tag `v1.2.2` 与 GitHub Release。Tag 指向 `e2ec493`，生产进程仍是 `58b7693`。发布页附带 `AntifieldComplexx_1.2.2_x64-setup.exe`（3,401,307 字节）、`AntifieldComplexx-1.2.2-arm64.zip`（6,160,540 字节）与 `SHA256SUMS`。

## [v1.2.1] - 2026-11-12

- 双端暗色青蓝精修：首页常用入口与异常摘要、Bot 三步目标、手机四项导航及更多页、Windows 自绘标题栏。
- 只读请求合并、有限退避、独立取消及账号浏览偏好；网络故障与会话失效分别处理。
- 原生签名流式下载、可撤销 Range 预览、Android 隔离 AI 页面及固定 AI／Access 来源的一次续票。
- 笔记附件支持完成分片的事务接管，原 multipart 接口兼容。
- 修正设备 Cookie 降级认证、nonce 末秒重放、严格 HTTP 自主入口；异地上传或确认失败时禁止清理旧链。
- 原生覆盖升级清理遗留静态离线缓存；Android 从版本控制同步完整 AC 图标，关闭牵动固定导航的容器回弹。
- 增加 Rust、双端原生 CI、版本一致性及登录入口 500 kB 构建门禁。
- schema 21、契约 v2、DSH 版本不变。生产、双端覆盖升级、完整 Access smoke 与 schema 21／世界隔离恢复验收通过。
- 已发布 annotated Tag `v1.2.1` 与 GitHub Release。Tag 指向 `26bcc70`，生产进程仍是 `0f7be18`。发布页附带 Windows x64 安装包、Android arm64 压缩包与 SHA256SUMS。


## [v1.2.0] - 2026-11-11

- 同一账号可登记最多 10 台 Windows 或 Android 客户端。设备用 Ed25519 签名 Bearer 请求。前台每 30 秒心跳，90 秒内算在线。浏览器仍用 Cookie 与 CSRF。
- `PUBLIC_APP_SHELL` 默认开启。关闭后，应用公网主机只返回「请使用客户端」和分享页；`127.0.0.1`、`localhost` 与 `::1` 仍提供完整界面。健康检查、公开分享、QQ Webhook 与 AI 反代保持可用。
- schema 21 已于 2026-11-11 部署。已发布 annotated Tag `v1.2.0`。迁移前快照 `db-predeploy-20261111T104848131Z.sqlite`（schema 20，sha256 `e7eb8486f0158f0002e9bccad7ea0b6699f657581c3d9e64cd16ecfd838518bd`）。迁移后的演练按 schema 21，当前演练仍是 `20261110T022941Z`。客户端与 schema 21 绑定。退回 v1.1.1 必须恢复该快照、旧 release、当时的 Access 策略与公网界面。
- 冒烟脚本读取公网首页时使用 `$page`，避免占用 PowerShell 只读变量 `$HOME`。
- Windows 客户端 1.2.0 已按当前用户安装。Android `app.antifieldcomplexx.client` 1.2.0（versionCode 1002000）已用 debug 密钥签名后侧载。两端使用原有 AC 图标，接口源只存在于本机构建。`tauri android build` 在本机的退出码仍是 1。Windows 计划任务于 `2026-11-11T11:40:23.6416579Z` 重装为 1.2.0。用户已放行应用 `/api`，双端登录验收通过。已发布 annotated Tag `v1.2.0` 与 GitHub Release，发布页附带 Windows x64 与 Android arm64 安装包。

## [v1.1.1] - 2026-11-10

- Minecraft Bot 按所属动作结果推进采集、存箱与回家，支持暂停、取消和按步骤恢复。修正 `forest-01` 等资源记忆键的分类。
- 防御准备识别已经装备的护甲和副手盾牌，避免重复前往补给箱。
- 树场优先选择最近的原木。每次成功砍伐后立即计数，达到采集上限即结束。
- 分享下载在发送前原子预占名额，正常中断时按会话归还。分片拼接逐片校验 SHA-256，仅重传缺失或损坏的分片。
- age 密钥包加入 mcbot 目标库、任务状态和世界记忆。部署验证文件清单与一致性快照，同 schema 回滚保留数据库及 WAL。

## [v1.1.0] - 2026-11-08

- 增加隔离的 DeepSeek Harness Web、QQ 和 Minecraft Agent。提供 Workbench 单点登录换票、腾讯插件接入和 13 个原生自主工具。
- 增加 QQ 记忆迁移与审核、DSH 加密备份、状态监控和固定版本门禁。Workbench schema 20 与 mcbot 契约 v2。
- QQ 私聊确认清除会撤销同一 AppID 下可确认归属的私聊和群记忆，并轮换会话。生产告警由 Workbench 投递至企业微信。
- Pi 上 OpenCode 与旧 MCP 已退役。生产验收、加密冷备和回滚记录见 `docs/app/ACCEPTANCE.md`。

## [v1.0.13] - 2026-11-07

- 挖矿和天然林先读 `resource` 记忆坐标。坐标要能解析出整数 x,y,z，并用矿或树的关键词区分。只取两倍 `SCAN_RADIUS` 内、从新到旧最多 8 个点。
- 方块已加载且仍符合现有裸露矿或自然树条件时，本轮不做半径扫描。方块未加载时走近一次再确认，确认失败才做原来的半径扫描。
- 不写记忆，不新增 MCP 工具，不新增环境变量，不增加模型调用。决策提示要求把已经看到的矿或自然树坐标记入 `resource`。
- schema 保持 20，契约保持 v2，OpenCode 保持 2.2.5。应用侧无行为变更，只对齐版本轴。

## [v1.0.12] - 2026-11-07

- 自主决策前重建短环境快照。提示词带坐标、血量、饥饿、敌对和任务，不带完整方块清单。`observe` 仍做半径扫描。
- 世界记忆与聊天记忆分开，文件为 dataDir 下的 `world-memory.json`（0600）。分类只有 `place`、`resource`、`food`、`danger`、`route`、`note`。最多 200 条，键 ≤64，正文 ≤240。已有键可更新，满额后拒绝新键。损坏或超大文件隔离后从空库继续。
- 模型通过 `memory_read`、`memory_write`、`memory_forget` 读写。三个工具计入既有工具预算，不启动任务。提示词只带分类计数和最近 8 个键。审计只记分类和键。
- 本版与 v1.0.11 分开发布。生产部署一次，运行的进程版本是 1.0.12，其中包含 v1.0.11 的反射。v1.0.11 的代码边界是 `c7dd74b`。
- schema 保持 20，契约保持 v2，OpenCode 保持 2.2.5。应用侧无行为变更，只对齐版本轴。

## [v1.0.11] - 2026-11-07

- 白名单敌对生物用最好的剑、斧或拳头近战，不要求护甲。不近战苦力怕、末影人和玩家。女巫只有正在攻击时才还手。低血量、低饥饿、敌人过多或战斗超时仍撤退。
- 饥饿时先吃背包，再捡 8 格内的食物掉落，然后去食物箱取 8 个。仍然挨饿且空闲时排队种田，下一轮改排队钓鱼。不打猎、不烧炉。
- 梯子和藤蔓可上下。木门、栅栏门和木活板门由执行器打开。铁门和铁活板门挡住，并记为 `iron_door`。pathfinder 仍不挖掘、不跑酷、不开门。
- 单独发布 Tag `v1.0.11`（`c7dd74b`）。与 v1.0.12 同一次部署验收，不单独切换生产进程。
- schema 保持 20，契约保持 v2，OpenCode 保持 2.2.5。

## [v1.0.10] - 2026-11-07

- 行走不再受 `SAFE_*` 矩形限制。寻路走廊仍受 `PATH_OUTSIDE_SAFE_RADIUS`、节点上限和规划超时约束。`SAFE_*` 继续解析，不再当作移动围栏，锚点和探索路点也不再要求落在矩形内。
- 挖矿、天然林、资源扫描、环境扫描和 `inspect_chest` 改为以 Bot 为圆心的 `SCAN_RADIUS`（默认 32，最大 64）。巡逻和清怪绕家。护送可以跟出旧矩形，仍不跨维度。
- 寻路失败停在原地。`PATH_TELEPORT_FALLBACK` 仍被读取，但不把任意目标点当作传送落点。已配置锚点，以及同维度且实体已加载的玩家名，仍可传送。
- 血量 ≤ `CRITICAL_HEALTH`（默认 6，0 关闭）时立即传送回基地，并打断移动。防御不再因怪物在旧矩形外撤退。没有铁剑时仍撤退。
- 实机：濒危传送回基地已发生；巡逻走出旧矩形南边后，回程停在距家数格处，没有传送到该目标。基地边缘没有铁剑时会反复阵亡，本次由管理员治疗后把 Bot 送到食物箱。空手战斗、主动找食物、梯子和门留到 v1.0.11。
- schema 保持 20，契约保持 v2，OpenCode 保持 2.2.5。应用侧无行为变更，只对齐版本轴。

## [v1.0.9] - 2026-11-06

- 增量按最近有效全量链的文件清单选择，覆盖回收站、笔记附件、同毫秒写入和已找回的缺失文件。pending 损坏或缺失时停止生成并保留证据。归档时间不早于最近一份本机归档。
- `drill.ps1 -RestoreOutputDir` 在链、目标库和引用文件通过后，把 `db.sqlite` 与引用文件发布到尚不存在的目录。失败不创建该目录。
- 主机告警的 firing、resolved、unknown 与周期重通知进入既有投递箱。Webhook 与 QQ 分通道处理，同一条件按顺序投递。
- `GET /api/alerts` 返回只读 `deliveries`。历史事件没有投递箱记录时为 null。
- 同一 bootId 的事件序号空洞写入 `eventGap`，面板保留当前 Bot 状态。契约仍为 v2。
- `smoke.ps1` 核对每日备份与周度世界拉取任务的 `-File` 路径，以及已安装脚本与标记的 SHA-256。

## [v1.0.8] - 2026-11-05

- 修复增量断链误报，恢复演练核对快照引用文件的存在、大小与哈希，支持隔离解包世界归档。
- Web 恢复可取回后续归档补齐的内容，分片上传在同一事务内登记文件并完成会话。
- schema 20 持久化外部告警的 Webhook 与 QQ 入队，重启补投。QQ Chat 全模式要求工具隔离。
- mcbot 契约 v2 使用控制 Token 发言，Workbench 兼容 v1 读与其他控制。收口自主启动/急停、决策超时和移动取消。
- 管理页按路由加载，Windows CI 运行实际演练脚本，mcbot 增加覆盖率门禁。

## [v1.0.7] - 2026-11-04（已部署；OpenCode 2.2.5；已发布 Tag/Release）

v1.0.7 主题是运行时可信：告警可重放、轮询成功时间可见、mcbot 进入服务告警，以及寻路兜底进入自主重决策。app 与 mcbot 同为 1.0.7。schema v18 → v19，只追加可空 `alert_events.dedupe_key`。OpenCode 针为 2.2.5，与应用同一发布窗口升级。

### 修复

- schema v19：`alert_events.dedupe_key` 可空，部分唯一索引允许多个 NULL。mcbot 告警键为 `mcbot:<bootId>:<eventId>`。同一键再次写入不新增行、不重复 webhook、不重复入队 Bot 通知。空键与纯空白键不参与去重。
- `GET /api/mcbot/status` 下发 `lastSuccessAt`。只有完整上游 `/status` 成功才更新；失败轮询只推进 `lastPollAt`。面板过期文案用成功时间，从未成功时显示“尚无成功轮询”。
- `MCBOT_ENABLED=true` 时，mcbot 进程不在或轮询快照过期走既有 `service_down` 的 firing/resolved。单次失败且未过期不触发。上游 `alert` 仍为 `status='event'`，不写入 `alert_state`。Dashboard 服务卡显示 mcbot。
- `install-backup-task.ps1` 在安装每日任务的同时，把 `scripts/world-pull.ps1` 复制到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，并注册周任务 `AntifieldCloud-World-Pull`（周日 12:00）。任务名与 `%LOCALAPPDATA%\AntifieldCloud` 不变。缺源文件时在 DryRun 之前失败。

### 特性

- 寻路兜底进入自主会话重决策。安全传送的提示为“寻路兜底：已安全传送”，停止且没有路径为“寻路兜底：已停止、没有路径”。沿用 30 秒去重与每会话最多 6 次，不新增 MCP 工具，模型不能调用传送。面板在寻路 Fact 下显示 `lastFallbackReason` 短文本；该原文不进入自主提示。

### 运维

- `deploy/tool-versions.json`：schema 19、OpenCode 2.2.5、mcbot 1.0.7。升级步骤见 `docs/app/DEPLOY.md` §3.2。回滚 OpenCode 使用本次升级前的 v2.2.0 备份。矩阵失败则恢复该备份并停止应用部署。
- 本地门禁（2026-11-04）：`npm run check` 与 `npm run build` 通过；app **608**（607 pass、1 skip）+ web **279**（50 文件）+ mcbot **144**。
- 生产（2026-11-04，commit `b17102b`）：app `/opt/antifieldcloud/releases/20261104T093100Z`，迁移前 DB 快照 `db-predeploy-20261104T093146763Z.sqlite`（sha256 `1b09c9…fa03`）；mcbot `/opt/mcbot/releases/20261104T092858Z`（契约 v1，仅 `127.0.0.1:3010`）。部署内 smoke **26/0/1/2**；带 mcbot 版本与本机任务/归档旁文件后，经 Pi 出口的完整 Access smoke **36/0/1/2**（当时 WARN=演练 schema 18；SKIP=加密/异地默认关闭）。`service_down` 在停止 mcbot 后 firing「未运行：mcbot」，恢复后 resolved。Minecraft 保持运行。已发布 annotated Tag `v1.0.7` 与 GitHub Release。
- 实机与演练（2026-11-04，部署之后）：管理员在线时，安全区内临时 5 格密封圆石箱（x134–136, y64–68, z424–426）让 `go_home` 走规划器 `no_path`/`exhausted`，安全传送到 `174.5,64,410.5`（区内），自主会话 `decisionCycles=1`、`lastEvent=寻路兜底：已安全传送`。围墙已拆除。bot 回到 `183.5,64,435.5` 后只重启了 mcbot。Minecraft 未重启，`FORCE_ONLINE` 未改。同日演练 `20261104T103202Z` 通过：full `snapshot-20261102T014632977Z-full.tar.gz` + 7 inc，最新 DB `db-20261104T103144405Z.sqlite` schema 19，世界归档 `world-20261101T040001Z.tar.gz` 只做 SHA/`level.dat` 名校验。增量 `snapshot-20261104T103144405Z-inc.tar.gz`（576694 bytes，secrets=ok）。早先 Access smoke 的 schema-18 WARN 是演练前快照，未重跑 smoke。`movement.stop()` 不清除 `cancelled`，下一次 `go_home` 会直接「移动已取消」，直到 `come`/`follow` 或进程重启；这是观察，本版不修。mcbot 已删除超出保留 3 份的 `20261030T120449Z` 与 `20261030T142942Z`（各 538 MiB）。仍保留 current、v1.0.6 回滚 `20261030T143538Z` 与 `20261030T143306Z`。应用 release 已是 3 份，未再删。
- OpenCode（2026-11-04）：树莓派运行中版本为 2.2.5。备份 timestamp `20261104T062115Z`。矩阵见 `docs/app/DEPLOY.md` §3.2。未改配置。
- schema v19 写入后，应用回退到 v1.0.6 必须先恢复迁移前 DB 快照。

### 本版不修

- `stop()` 不取消在途轮询、契约版本无守卫、`lastError` 原样透传、告警风暴并发上限、5 格垂直墙、`http-proxy` 弃用警告。这些仍是审计残余。

## [v1.0.6] - 2026-10-30（已部署，核心实机矩阵通过；已发布 Tag/Release）

v1.0.6 聚焦 MC Bot 已知寻路局限：新增统一导航层（pathfinder 快速路径 → 确定性 A* → 受控路点执行 → 受控 AI 路点建议 → 安全兜底），覆盖 1–5 级逐级台阶、1 格矮墙、2 格墙绕行；5 格垂直墙/断崖明确失败，不伪造到达。不挖掘、不放置、不跑酷、不跨维度；任务/目标/自主仍限安全区。

### Added

- 新增 `apps/mcbot/src/minecraft/routing/`：方块采样（支持台阶/楼梯/半砖碰撞形状）、确定性 A*、受控路点执行器、导航诊断。
- 新增 `apps/mcbot/src/ai/path-advisor.ts`：仅确定性失败后单次请求，严格 JSON/边界/可站立校验；默认在 OpenCode 配置可用时开启，可用 `PATH_AI_ENABLED=false` 关闭。
- `/status` 增加可选 `navigation` 快照；app 面板显示寻路状态/来源/最近兜底；兜底同时写 `movement` 事件、聊天提示。
- 新增 `PATH_PLANNER_ENABLED`、`PATH_PLANNER_MAX_NODES`、`PATH_PLANNER_TIMEOUT_MS`、`PATH_MAX_REPLANS`、`PATH_TELEPORT_FALLBACK`、`PATH_OUTSIDE_SAFE_RADIUS`、`PATH_AI_ENABLED`、`PATH_AI_TIMEOUT_MS`、`PATH_AI_COOLDOWN_MS`。

### Changed

- `goNearPoint/comeTo/follow/home` 统一经过新导航层；`过来/跟随`允许安全区外路径，但不传送出安全区；任务/目标/自主仍禁止越界。
- 安全传送改为最后兜底并显式可见；不再用零散“起跳重试”冒充规范路径。

### Tests

- 新增 v1.0.6 规划器/执行器/AI advisor/app 状态测试；全部回归通过后更新基线。
- 实机矩阵：1/2/3/5 级台阶、1 格矮墙、2 格墙绕行、安全区外路径通过；5 格垂直墙明确安全兜底；取消/死亡与 AI off 由单元/集成覆盖。

## [v1.0.5] - 2026-10-30（已部署并发布 Tag/Release）

v1.0.5 为 MC Bot 修复与新特性版本，并包含一次全仓 Debug：修复安全区高低差寻路、增加可持久化 `auto/always/off` 在线模式、空闲自动进食/换装/补货、安全区清怪任务、多步目标/长期记忆与失败分类；app 新增在线模式/目标代理与面板卡片。app schema 保持 v18（mcbot 本地 `goals.db`/`presence.json` 为 additive，无 app DB 迁移）。

### Added

- **在线模式**：mcbot `GET/POST /presence` 与 app `GET/POST /api/mcbot/presence`；`auto/always/off` 持久化到 `presence.json`，`off` 在任务/自主会话运行时拒绝（409）。
- **安全区清怪**：新增 `clearing` 任务与中文命令「清理安全区」，仅攻击现有敌对生物白名单，不追出安全区、不攻击玩家。
- **自动生存/补货**：新增 `AUTO_SURVIVAL`/`AUTO_EAT_BELOW`，默认开启空闲进食与护甲升级；`AUTO_RESTOCK` 默认改为开启。
- **多步目标**：mcbot 本地 SQLite `goals.db`（goals/goal_steps），支持 task/deposit/home 串行、失败分类、path 一次重试、生存中断一次自动恢复；重启后 paused 不自动执行。app 代理与面板卡片支持预设计划/开始/暂停/取消。
- **寻路回退**：`maxDropDown=2`、水平目标/安全中间点/安全区传送三层兜底，降低 PaperMC 高低差卡死。

### Fixed

- 缓解 mineflayer 在 PaperMC 高低差地形停滞的问题：增加停滞看门狗、显式起跳重试与安全传送；复杂高差仍可能回退传送，未宣称规范寻路修复（不开放挖掘/建造/跑酷/跨维度）。
- 修复自动补货只有代码路径、默认关闭且缺少空闲生存循环的问题。

### Verification

- 门禁：app 603（602 pass、1 skip）+ web 275（49 文件）+ mcbot 127；`npm run check`/`build`/`check-version`（严格 1.0.5）/`check-naming`/`check:docs` 通过。
- 生产：app `/opt/antifieldcloud/releases/20261030T110436Z`、mcbot `/opt/mcbot/releases/20261030T120449Z`；部署内 smoke 26/0/1/2，最终 `-SkipPublic` 本机 smoke 29/0/1/2，Windows 任务标记 1.0.5；实机验证在线模式/目标/清怪/自动生存；高低差路径仍会安全传送，残余见 `docs/app/AUDIT.md`。
- 发布：[GitHub Release v1.0.5](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.0.5)。

## [v1.0.4] - 2026-10-30（已部署生产（最终构建）；已发布 Tag/Release）

v1.0.4 主更新为 **Bot 出站可用性中心**：管理页可见出站健康快照、连续失败触发 `chatbot_outbound_down` 告警、失败/死信可受控批量重试；同时修复 QQ Bot 出站 token 端点与备份面板历史错误误报。不改变 schema/API 破坏性契约，mcbot 仅版本对齐。2026-10-30 已部署生产（app `/opt/antifieldcloud/releases/20261030T021856Z`、mcbot `/opt/mcbot/releases/20261030T005014Z`），已发布 [GitHub Release v1.0.4](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.0.4)。

### Added

- **Bot 出站可用性**：`ChatbotStatus.outbound` 聚合 enabled Bot 的投递/发布队列；窗口内失败达到阈值且晚于最近成功时 `degraded=true`，新成功发送后恢复。新增 `chatbot_outbound_down` firing/resolved 告警，凭据类错误为 critical；历史死信只计数、不永久触发。
- **管理端重试**：新增 `POST /api/chatbots/:id/deliveries/retry-failed`，批量最多 20 条 failed/dead，排除 `partial_text_sent`；`/chatbots` 概览显示出站状态/最近成功，投递面板增加批量重试与确认。

### Fixed

- **QQ Bot 出站**：access_token 端点从不可解析/证书不匹配的 `https://chatbots.qq.com/app/getAppAccessToken` 修正为官方 `https://bots.qq.com/app/getAppAccessToken`；连通性探针同步改为 `https://bots.qq.com/`，测试常量同步并增加旧域名不得回归断言。
- **备份面板误报**：`backup.mjs --ack` 成功后清除该归档的 `last_error`；Dashboard 与备份列表的全局最近错误只考虑未 ack、未删除归档，已确认归档的文件缺失不再长期标记“备份异常”。

### Verification

- 本地：`npm run check`（含 docs/naming）、`npm run build`、`check-version`（严格 1.0.4）通过；app **603**（602 pass、1 skip）+ web **274** + mcbot **122**；QQ token 端点用生产加密凭据实测返回 200（不打印 Token）。
- 生产：部署内只读 smoke **26/0/1/2**，完整 Access smoke **36/0/1/2**（含 Windows 任务标记 1.0.4；WARN=drill schema17；2 SKIP=加密/异地默认关闭）；app 1.0.4/schema18/OpenCode2.2.0，mcbot 1.0.4/contract1；生产 outbound 快照 `active=true, degraded=false, recentFailures=0`，51 条历史死信不触发告警，`chatbot_outbound_down` 无 firing 事件；部署后已用实际部署代码获取 QQ access_token 成功，并清除 1 条已 ack 归档历史 `last_error`。
- 部署前 DB 快照 `/var/lib/antifieldcloud/backups/db-predeploy-20261030T021908886Z.sqlite`（sha256 `7c8c474a2161221172928535fc626bac1d685e1232593497723b717a50ee1872`）；手工备份 `/var/backups/antifieldcomplexx/v1.0.4-final-predeploy-20261030T020959Z`。

### Migration / Rollback

- 无 schema/DB 迁移；上一 app release 为热修构建 `/opt/antifieldcloud/releases/20261030T005200Z`，回滚切回该 release 并恢复部署前 env；mcbot 保持 `/opt/mcbot/releases/20261030T005014Z`。出站健康/告警/重试均为应用侧变更。已发布 Tag v1.0.4 + GitHub Release。

## [v1.0.3] - 2026-10-28（已部署生产；已补发 Tag/Release）

v1.0.3 是 mcbot 环境感知/自主决策增强与文档-实现一致性审计版本：新增有界环境快照、附近方块/容器扫描、只读容器读取、进食/装备工具与事件驱动重决策；未变更 schema。2026-10-28 已部署生产（app `/opt/antifieldcloud/releases/20261028T144416Z`、mcbot `/opt/mcbot/releases/20261028T144253Z`），完整 Access smoke 36/0/1/2；已补发 [GitHub Release v1.0.3](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.0.3)。

### Added

- **mcbot 环境感知**：`observe` 提供基础状态 + 安全区 allowlist 方块/容器扫描（默认半径 16、最多 48，只读已加载区块）；普通聊天仍使用轻量上下文。
- **只读容器**：`inspect_chest` 仅安全区、allowlist 容器、无 active/queue/pending 时短距寻路打开；不传送、不破块、不取物，读取摘要后立即关闭。
- **生存动作**：`eat` / `equip` 仅空闲时对背包内食物/护甲/工具生效，固定冷却、策略校验与审计。
- **事件驱动自主决策**：任务生命周期与安全告警触发重决策；同原因 30s 去重、最多 6 次，无周期空转；任务存在才保持会话。
- **文档审计**：新增 `docs/mcbot/CONSISTENCY-AUDIT.md` 声明/实现矩阵与 `scripts/check-mcbot-claims.mjs` 自动检查；修正 v1.0.2 生产状态、AI 能力、工具语义等陈旧声明。

### Verification

- 本地：`npm run check`、`npm run build`、`check-version`（1.0.3）、`check-naming`、`check:docs` 全绿；app 591（590 pass、1 skip）+ web 273 + mcbot 122；服务端覆盖率 93.10/78.88/88.86，前端 56.27/51.88/49.16。
- 生产：mcbot 1.0.3、app 1.0.3/schema18/OpenCode2.2.0；部署内只读 smoke 26/0/1/2，完整 Access smoke 36/0/1/2（WARN=drill schema17；2 SKIP=加密/异地默认关闭）；Windows 备份任务标记 1.0.3。
- 实机 Agentic：`observe` + `task_status` + `finish`（toolCalls=3），`low_health` 安全告警触发事件驱动重决策，任务未启动，session/MCP 清理；`FORCE_ONLINE` 恢复 false。

### Migration / Rollback

- 无 schema/DB 迁移；部署前快照 `/var/lib/antifieldcloud/backups/db-predeploy-20261028T144601033Z.sqlite`；人工备份 `/var/backups/antifieldcomplexx/v1.0.3-predeploy-20261028T144245Z`。
- 回滚：切回 app `/opt/antifieldcloud/releases/20261028T085429Z`、mcbot `/opt/mcbot/releases/20261028T091246Z`，并恢复部署前 env；自主模式仍默认关闭，生产 `AUTONOMY_ENABLED=true` 保持不变。已补发 Tag/Release `v1.0.3`。

## [v1.0.2] - 2026-10-28（已部署生产；已补发 Tag/Release）

v1.0.2 是 mcbot AI 自主能力与 Agentic 验收版本：模型通过 OpenCode 原生 MCP 工具循环驱动现有 10 种任务与回家/存箱，确定性策略层负责权限、预算、急停和审计；应用面板增加自主控制，并补 mcbot 运维残余。2026-10-28 已部署生产（app `/opt/antifieldcloud/releases/20261028T085429Z`、mcbot `/opt/mcbot/releases/20261028T091246Z`）；生产已启用自主模式（仅主人显式启动），Windows 备份任务已重装到 1.0.2；已补发 [GitHub Release v1.0.2](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.0.2)。

### Added

- **mcbot AI 自主会话**：仅主人显式启动；OpenCode 运行时注册 MCP server，模型原生调用 `start_task`/`stop_task`/`go_home`/`deposit`/`task_status`/`finish`；每次会话随机 run_id + Bearer；OpenCode session 使用 deny-all + `mcbot_autonomy_*` 白名单；预算/失败/超时/断线/急停/任务清理；审计与 `autonomy` 事件。
- **应用**：mcbot 面板新增自主模式卡（状态/目标/时间/工具调用/最近决策，启动/急停二次确认）；任务下拉同步 10 种任务（guard/escort/explore）；`GET /api/mcbot/autonomy`、`POST /api/mcbot/autonomy/start|stop`，CSRF/限流/审计。
- **运维**：mcbot 纳入服务监控与 `service_down` 告警；`McbotService.stop()` 中止并等待在途轮询、停止后不写告警游标；`/api/mcbot/status|history` GET 60/min 限流。
- **Agentic 验收**：`test/agentic` 离线 scenario harness（CI）；`scripts/agentic-acceptance.mjs` 可选实机 conductor（默认 dry-run，需显式 `--allow-writes`）；`docs/mcbot/ACCEPTANCE.md` 三角色流程。

### Verification

- 本地：root `npm run check` 通过；app 591（590 pass、1 skip）、web 273、mcbot 108；服务端覆盖率 93.10/78.89/88.86，前端 56.27/51.88/49.16；build/check-version（1.0.2）/check-naming 通过。
- OpenCode 2.2.0 原生 MCP Phase 0：运行时注册/工具调用/权限前缀/Authorization/清理通过。
- 已部署生产；生产 app/mcbot 1.0.2；已补发 Tag `v1.0.2` + GitHub Release（补充发布，部署时间仍为 2026-10-28）。

### Migration / Rollback

- 无 schema/DB 迁移；生产回滚使用部署前 DB 快照或切回上一 release；自主模式代码默认关闭（生产当前已启用，可随时设 `AUTONOMY_ENABLED=false` 重启）。已补发 Tag/Release `v1.0.2`。
## [v1.0.1] - 2026-10-28

v1.0.1 是定位同步与 OpenCode 升级版本：运行时 UI/元数据切换为“个人综合交互平台”，OpenCode 从 2.1.4 升级到 2.2.0，无 schema 迁移。

### Changed

- **运行时定位文案**：HTML title/meta、PWA manifest/离线页、Logo/登录页/设置页/页面标题与 systemd Description 从“个人工作台”切换为“个人综合交互平台”。
- **版本**：根/workbench/mcbot 统一 1.0.1；`APP_VERSION=1.0.1`。
- **OpenCode 2.2.0**：2.2.0 的 breaking changes 仅涉及 `@opencode/ai` Promise API、GitHub Action 移除、TUI 插件 OpenTUI 0.7；应用使用原生 HTTP API + MCP，无需业务改动。升级前备份 v2.1.4 binary/data/env/unit/MCP；生产兼容矩阵与 /api/mcp 通过。
- **mcbot 1.0.1**：版本随统一版本轴发布，功能无变更。
- **文档**：README/AGENTS/PLAN/ROADMAP/UI-SPEC/ACCEPTANCE/DEPLOY/SECURITY/CHATBOT/mcbot 文档与版本/OpenCode 事实对齐；修复历史生产 facts 漂移。

### Fixed

- OpenCode 升级后运行进程未重启，导致 CLI 已 2.2.0 而 OpenCode Web/`/api/info` 仍显示 2.1.4；重启服务并在运行中的 2.2.0 上重跑兼容矩阵，smoke 增加 `/api/info` 运行版本与进程 exe 校验。

### Verification

- 本地：`npm run check`、`npm run build`、`check-naming` 通过；app 574/573 pass、web 256、mcbot 94。
- 生产：app `20261028T021311Z`（1.0.1/schema18/OpenCode 2.2.0）、mcbot `20261028T021116Z`（1.0.1）；部署内 smoke 26/0/1/2、完整 Access smoke **36/0/1/2**（WARN=drill schema17）。
- OpenCode 兼容：Basic/session list、permissions deny/allow、prompt/wait/assistant 形状、图片 prompt files、/api/mcp、MCP 进程唯一性、资源余量通过；模型不支持图片的回复不影响 API 兼容。

### Migration / Rollback

- 无 DB/schema 变更；应用回退上一 release；mcbot 回退上一 release；OpenCode 用 `/var/backups/opencode/20261028T020723Z` 备份回滚到 2.1.4。
## [v1.0.0] - 2026-10-28

v1.0.0 是 AntifieldComplexx 的架构收敛版本：工作台与 Minecraft bot 合并为 npm workspaces 单仓库，QQ Bot 子系统更名 chatbot（DB schema v18），原 lofii-bot 以全历史导入 `apps/mcbot` 并硬切换。

### Changed

- **项目定位**：重新定义为“个人综合交互平台”（统一入口整合个人数据/分享、Minecraft 与 mcbot、QQ chatbot、OpenCode AI、主机监控与备份灾备）；本次同步 README/AGENTS/docs，运行时 UI/API/服务标识不变。
- **仓库布局**：迁移为 npm workspaces（`apps/workbench` + `apps/mcbot`），根包 `antifieldcomplexx` 统一编排；根 `package-lock.json` 单一锁文件；根 `npm run check` 覆盖两个 workspace。
- **chatbot 全量更名**（原 QQ Bot 子系统）：
  - 模块/文件/类型：`server/src/bot` → `server/src/chatbot`，`BotService` → `ChatbotService` 等。
  - HTTP：`/api/bots*` → `/api/chatbots*`，`/api/bot/webhook/:botId` → `/api/chatbot/webhook/:chatbotId`，`/api/bot/ai/tool/send` → `/api/chatbot/ai/tool/send`；错误码 `invalid_chatbot_config`。
  - env：`BOT_*` → `CHATBOT_*`；`CHATBOT_CONTEXT_DIR` 默认 `/var/lib/antifieldcloud-chatbot-context`。
  - DB：`bots`/`bot_*` 表、`bot_id` 列与 meta 键迁移为 `chatbot_*`；历史迁移 SQL 保持只追加，新增迁移 18 一次性改名。
  - Web：`/chatbots` 页面与组件、`/bots` 自动重定向；`/api/version` 字段 `botsEnabled` → `chatbotsEnabled`。
  - 数据：`DATA_DIR/bot-memory` 镜像目录启动时自动迁移到 `chatbot-memory`。
- **mcbot 合并与硬切换**（原 lofii-bot）：
  - `git subtree` 保留全历史导入 `apps/mcbot`；workspace `@antifieldcomplexx/mcbot`。
  - 服务/用户/路径：`mcbot.service`、`mcbot`、`/opt/mcbot`、`/etc/mcbot`、`/var/lib/mcbot`。
  - 接入面：env `MCBOT_*`、API `/api/mcbot/*`、审计 `mcbot.*`、meta `mcbot.event_cursor`（迁移 18 重命名旧游标）。
  - 游戏内人格名保留 `Lofii`，展示为 “mcbot (Lofii)”。
  - 部署脚本改为 workspace 感知布局；`scripts/sync-mcbot-tokens.sh`。

### Added

- mcbot 稳定性与运维：systemd `sd_notify` 看门狗（`Type=notify`/`WatchdogSec=90`）、RSS 内存治理告警、断线重连恢复增强（连接损失不消耗任务重试次数）、故障注入/soak 测试。
- mcbot 任务与存储：深层裸露矿（`MINE_DEEP_ENABLED`）、分类存箱（`CHEST_ORES/FOOD/SAPLINGS/MISC`）、库存/食物告警与自动补货、基地守卫、玩家护送、航点探索任务。
- mcbot AI：只读受控工具（`AI_TOOLS_ENABLED`，`status/inventory/task_status`），AI 动作仍只由确定性指令解析与权限校验执行。
- 迁移与发布：`scripts/migrate-v1.0.0.ps1`（Plan/Apply/Verify/Rollback）；`docs/` 分区为 `app/mcbot/legacy`；`docs/INDEX.md`。
- 门禁：`scripts/check-naming.mjs`（旧标识符扫描）；`check-version` 覆盖 mcbot 版本与文档路径。

### Breaking / Migration

- **旧应用无法读取 schema v18**：生产升级前必须做 DB 快照；回滚 = 恢复快照 + 旧 release/env。
- QQ 开放平台回调地址需改为 `https://app.<domain>/api/chatbot/webhook/<chatbotId>`；Cloudflare Access bypass 同步更新。
- 生产 env 需将 `BOT_*` → `CHATBOT_*`、`LOFII_*` → `MCBOT_*`；mcbot 服务/路径/数据按迁移脚本切换。
- 旧 CHANGELOG 已归档到 [`docs/legacy/CHANGELOG.md`](docs/legacy/CHANGELOG.md)，历史版本号/旧名称仅用于追溯。

### Verification

- root `npm run check`：app 574（573 pass）+ web 256 + mcbot 94（93 pass/1 skip）；typecheck/lint/build 通过。
- app 覆盖率：Lines 93.04% / Branches 78.74% / Functions 88.73%；前端 55.83% / 51.29% / 48.66%。
- schema v18 迁移测试覆盖 v6/v9/v11/v12/v13/v17→v18。
- **生产已部署（2026-10-28）**：app `20261028T002517Z`（1.0.0/schema18）、mcbot `20261028T000632Z`（1.0.0）；迁移前 DB 快照 `db-predeploy-20261028T000918146Z.sqlite`；smoke 27/0/1/2（部署内）与 36/0/1/2（完整 Access，2026-10-28 配置修复后）。

历史版本请见 [docs/legacy/CHANGELOG.md](docs/legacy/CHANGELOG.md)。
