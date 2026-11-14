# AntifieldComplexx 实施计划与状态

## v1.2.3（本地，尚未部署）

范围是 Minecraft Bot 控制层和远程插件页。管理员对话是面板上的唯一行动入口。模型决定是否调用现有 13 个 mcbot 工具，以及 DSH 已有的 goal 与 todo。不改执行器，不新增工具名，不挂 goal-round-driver，不向模型开放插件管理。游戏内口令保留。急停不经过模型，空闲算成功。对话不进数据库。

应用退役任务开始、目标写、自主开始、移动和游戏发言，返回 409 且不调用上游。在线模式和只读状态保留。分页标签改为「Minecraft Bot」，路由和侧栏不变。

DSH Web 重新启用 `ui-plugin-manager` 与 `plugin-package-inventory-deepseek`。Workbench 仍拒绝无连字符的 `/api/pluginManager/`、上传、设置写入和凭据写入。已登录管理员经 Access 与应用会话可以安装或移除 DSH Web 进程中的插件。真实安装留待部署后在 Pi 上检查。

不迁移 schema。同 schema 回滚恢复 v1.2.2 的 Workbench `20261113T072133Z`、mcbot `20261113T072417Z`，以及关闭插件页的 DSH 配置，保留现行数据库及 WAL。只重启受影响的 Workbench、DSH Web 和 Minecraft Agent。

## v1.2.2（2026-11-13 已部署并验收）

本轮按用户指定版本统一处理 12 项修复、特性与治理，范围及逐项状态以 [BACKLOG](BACKLOG.md) 为准。Workbench、mcbot 与双端已升级；schema 21、契约 v2、DSH 版本及 13 个工具不变。双端登录通过，MC 远程管理真机验收按用户要求跳过。整包加密、固定 sudo 入口、应用及世界隔离恢复已验收；Google Drive 的分段、回下载解密、应用链云端恢复和自动任务实跑通过，最终 Access smoke 39／0。已发布 annotated Tag `v1.2.2`，指向 `e2ec493`；生产进程仍是 `58b7693`。发布页附带 Windows x64 安装包（3,401,307 字节）、Android arm64 压缩包（6,160,540 字节）与 SHA256SUMS。完整证据见 [ACCEPTANCE](ACCEPTANCE.md)。

## v1.2.1（2026-11-12 已部署，历史）

双端视觉与基础原生交互、认证文件传输、隔离 AI 容器以及全仓关键通路审计已交付。schema 21、mcbot 契约 v2、DSH 固定版本不变。Workbench `20261112T115350Z`、mcbot `20261112T115627Z`；完整 Access smoke 37／0／0／2，恢复演练 `20261112T115843Z` 通过。Windows／Android 覆盖升级及用户验收通过。已发布 annotated Tag `v1.2.1`，发布页附带 Windows x64 安装包、Android arm64 压缩包与 SHA256SUMS。Tag 指向 `26bcc70`，生产进程仍是 `0f7be18`。构建、审计残余、备份与同 schema 回滚证据见 ACCEPTANCE、AUDIT。


本文件记录当前版本的范围、决策、非目标与回滚方式。版本演进见 `docs/app/ROADMAP.md` 与仓库根 `CHANGELOG.md`；完整验收证据见 `docs/app/ACCEPTANCE.md`；契约见 `docs/app/API.md`；界面见 `docs/app/UI-SPEC.md`；审计见 `docs/app/AUDIT.md`。

> 项目定位：**个人综合交互平台**（统一入口整合个人数据/分享、Minecraft 与 mcbot、QQ chatbot、DeepSeek Harness AI 工作区、主机监控与备份灾备）。

## v1.2.0（2026-11-11 已部署）

- **版本**：应用版本 **v1.2.0**。schema **v21**。已发布 annotated Tag `v1.2.0`。Workbench `20261111T104738Z`，mcbot `20261111T105117Z`。
- **范围**：设备登记、Ed25519 请求签名、Bearer 会话、心跳、列表、改名与吊销。`PUBLIC_APP_SHELL` 默认 true，公网页面与 Cookie 登录保持可用。关闭后，应用公网主机只返回说明页「请使用客户端」和分享页；loopback 仍提供完整界面与 Cookie 登录。生产尚未关闭该开关。
- **客户端**：界面源码在 `apps/client`。Windows 与 Android 共用 Tauri 壳，登录后用设备密钥签名请求。构建产物仍输出到 `apps/workbench/web/dist`。本机 Windows 1.2.0 已按当前用户安装，图标为原有 AC 标记，接口源只写在本机构建，不进仓库。`tauri android build --target aarch64 --apk --ci` 在本机仍因不能创建 jniLibs 符号链接而退出码 1。arm64 包由已编译的 `libclient_lib.so` 经 `gradlew :app:assembleArm64Release` 生成，并用本机 Android debug 密钥签名后侧载。包名 `app.antifieldcomplexx.client`，versionName 1.2.0，versionCode 1002000，启动器图标为原有 AC 标记。Windows 与 Android 登录验收通过。
- **边界**：mcbot 仍是独立进程。健康检查、公开分享、QQ Webhook 与 AI 反代保持可用。生产页面仍经 Cloudflare Access。`/api` 到达应用，认证仍是密码、TOTP 与设备签名。Windows 计划任务于 `2026-11-11T11:40:23.6416579Z` 重装为 1.2.0，异地副本任务未安装。已发布 annotated Tag `v1.2.0`，发布页附带 Windows x64 与 Android arm64 安装包。schema 21 演练仍待下一次应用归档。
- **回滚**：回到 v1.1.1 必须同时恢复迁移前 schema 20 数据库快照 `db-predeploy-20261111T104848131Z.sqlite`、旧 release、Access 策略与公网界面。只恢复公网界面时，把 `PUBLIC_APP_SHELL` 设为 true 并重启，不改 schema。
- **测试**：2026-11-11 全量 `npm run check` 为服务端 **647**（646 pass、1 skip）+ web **307** + mcbot **181**。客户端 `cargo test` 8 通过。命名检查与文档声明检查通过。

## v1.1.1（2026-11-10）

- **版本**：**v1.1.1**；schema **v20**；mcbot **v1.1.1**（契约 v2）；DeepSeek Harness **0.2.2-rc.1**；QQ 插件 **0.5.5**。OpenCode **v2.2.5** 已从 Pi 退役，只作历史回滚运行时。
- **范围**：采集、存箱与回家按动作结果推进，支持暂停、取消和按步骤恢复。防御准备识别已装备的护甲和盾牌。树场选择最近的原木，成功砍伐后立即计数。分享下载在发送前原子预占名额。分片拼接逐片校验 SHA-256。age 密钥包收录 mcbot 目标库、任务状态和世界记忆。同 schema 回滚保留数据库及 WAL。
- **边界**：schema 与契约不变。整包加密与异地副本保持关闭。回滚到 v1.1.0 release，Workbench 保留现行 schema 20 库及 WAL。
- **状态**：Workbench `/opt/antifieldcloud/releases/20261109T143755Z`，mcbot `/opt/mcbot/releases/20261110T022539Z`，DSH `/opt/antifield-dsh/releases/20261108T143448Z`。部署前快照 `db-predeploy-20261109T143804671Z.sqlite` 已校验 schema 20。演练 `20261110T022941Z` 通过。Access smoke **37/0/0/2**。Windows 计划任务标记为 1.1.1。验收证据见 `docs/app/ACCEPTANCE.md`。
- **测试基线**：2026-11-09 全量 check 为服务端 **640**（639 pass、1 skip）+ web **283**。2026-11-10 mcbot 单测为 **181** pass。

## v1.1.0 已部署状态（历史）

- **版本**：**v1.1.0**；schema **v20**；mcbot **v1.1.0**（契约 v2）；DeepSeek Harness **0.2.2-rc.1**；QQ 插件 **0.5.5**。OpenCode **v2.2.5** 已从 Pi 退役，只作回滚运行时。
- **范围**：Web、QQ 与 mcbot Agent 使用隔离的 DeepSeek Harness。Workbench 做单点登录换票。QQ 记忆按平台确认的身份导入并审核。mcbot 的 13 个自主工具由 DSH 插件经私有 Unix socket 调用。配置该 socket 后，旧 `/autonomy/mcp` 返回 404。
- **边界**：schema 与契约不变。整包加密与异地副本保持关闭。密钥包和 Agent 冷备使用 age。回滚使用 PC 上验证过的加密档和 v1.0.13 release，Workbench 保留现行 schema 20 库。
- **状态**：Workbench 与 mcbot release `20261108T080545Z`，DSH release `/opt/antifield-dsh/releases/20261108T143448Z`。迁移前快照 `db-predeploy-20261108T080730455Z.sqlite`，SHA-256 `361d078c42a370d50fc92556a0a2ca1c142dd517d64c1acb2e947107a833d7ac`。演练 `20261108T143038Z` 通过。OpenCode 于 22:40:40（UTC+8）退役。退役后 smoke **30/0/0/2**。Windows 日备份与周度世界拉取已更新至 1.1.0。验收证据见 `docs/app/ACCEPTANCE.md`。
- **测试基线**：服务端 **633**（632 pass、1 skip）+ web **283** + mcbot **174**。

## v1.0.13 已部署状态（历史）

- **版本**：**v1.0.13**；schema **v20**；OpenCode **v2.2.5**；mcbot **v1.0.13**（契约 v2）。Workbench 继续兼容契约 v1 的读取与既有控制。
- **范围**：挖矿和天然林先读 `resource` 记忆坐标。坐标在两倍扫描半径内、方块仍有效时，本轮跳过半径扫描；区块未加载时走近一次再确认。不新增工具、环境变量或模型调用。
- **边界**：不启用整包加密与异地副本，不收紧 Pi sudo，不重启 Minecraft，不重启 OpenCode。本版只读 `resource` 坐标，写入仍只由模型的记忆工具完成。
- **状态**：提交 `1743323`。app `/opt/antifieldcloud/releases/20261107T121119Z`，mcbot `/opt/mcbot/releases/20261107T121646Z`。回滚到 v1.0.12：app `/opt/antifieldcloud/releases/20261107T105450Z`、mcbot `/opt/mcbot/releases/20261107T111407Z`，并保留现行库。演练仍为 `20261106T135130Z`。部署内 smoke **26/0/0/2**，随后 **28/0/0/2**。计划任务已于 `2026-11-07T13:13:54.6451312Z` 重装为 1.0.13。已发布 annotated Tag `v1.0.13`。
- **测试基线**：app **625**（624 pass、1 skip）+ web **283** + mcbot **173**。
- **发布门禁**：打 Tag 前再做一次文档对齐和临时文件清理。

## v1.0.12 已部署状态（历史）

- **版本**：**v1.0.12**；schema **v20**；OpenCode **v2.2.5**；mcbot **v1.0.12**（契约 v2）。Workbench 继续兼容契约 v1 的读取与既有控制。
- **范围**：v1.0.11 的空手战斗、找食、梯子和木门，加上 v1.0.12 的短环境快照和固定分类世界记忆。两个版本分开发布。生产部署一次，运行进程版本是 1.0.12。
- **状态**：v1.0.11 提交 `c7dd74b`，v1.0.12 功能提交 `b349b80`。app `/opt/antifieldcloud/releases/20261107T105450Z`、mcbot `/opt/mcbot/releases/20261107T111407Z`。回退到 v1.0.10：mcbot `/opt/mcbot/releases/20261107T094221Z`，Workbench `/opt/antifieldcloud/releases/20261107T094000Z` 并保留现行库。演练仍为 `20261106T135130Z`。部署内 smoke **26/0/0/2**，随后带 mcbot 契约的 smoke **28/0/0/2**。
- **测试基线**：app **625**（624 pass、1 skip）+ web **283** + mcbot **168**。

## v1.0.10 已部署状态（历史）

- **版本**：**v1.0.10**；schema **v20**；OpenCode **v2.2.5**；mcbot **v1.0.10**（契约 v2）。
- **范围**：去掉矩形围栏对行走和扫描的限制。扫描半径有硬顶。寻路失败停止。濒危只传送回基地。没有铁剑时仍撤退。
- **状态**：功能提交 `2f19440`。app `/opt/antifieldcloud/releases/20261107T094000Z`、mcbot `/opt/mcbot/releases/20261107T094221Z`。部署内 smoke **26/0/0/2**，随后带 mcbot 契约的 smoke **28/0/0/2**。
- **测试基线**：app **625**（624 pass、1 skip）+ web **283** + mcbot **154**。

## v1.0.9 已部署状态（历史）

- **版本**：**v1.0.9**；schema **v20**；OpenCode **v2.2.5**；mcbot **v1.0.9**（契约 v2）。
- **范围**：增量按最近有效全量链的清单覆盖；主机告警进入既有投递箱；告警列表只读展示 `deliveries`；同一 bootId 的事件序号空洞写入 `eventGap`。
- **状态**：运行 commit `7cfbf2d`。app `/opt/antifieldcloud/releases/20261106T134109Z`、mcbot `/opt/mcbot/releases/20261106T134625Z`；演练 `20261106T135130Z` 为 schema 20；Access smoke **36/0/0/2**。Tag `v1.0.9` 指向 `4381a7d`。
- **测试基线**：app **625**（624 pass、1 skip）+ web **283** + mcbot **147**。

## v1.0.8 已部署状态（历史）

- **版本**：**v1.0.8**；schema **v20**；OpenCode **v2.2.5**；mcbot **v1.0.8**（契约 v2）。
- **范围**：恢复演练核对链与引用文件；分片登记与完成放在同一事务；schema 20 持久化外部告警的 Webhook 与 QQ 入队，重启后续投；QQ Chat 全模式要求工具隔离；mcbot 契约 v2 发言使用控制 Token，Workbench 兼容契约 v1 的读取与既有控制；收口自主启动/急停、决策超时和移动取消。
- **边界**：不挖掘/不放置/不跑酷。应用从本版退回 v1.0.7 必须先恢复 schema 19 迁移前快照。mcbot 可独立切回 v1.0.7 release。
- **状态**：运行 commit `2440758`。app `/opt/antifieldcloud/releases/20261105T021739Z`、mcbot `/opt/mcbot/releases/20261105T021915Z`；迁移前快照 `db-predeploy-20261105T021746014Z.sqlite`；演练 `20261105T022152Z` 为 schema 20；Windows 任务已重装为 1.0.8；Access smoke **36/0/0/2**。Tag `v1.0.8` 指向 `6ad9449`。
- **测试基线**：app **613**（612 pass、1 skip）+ web **280** + mcbot **147**。

## v1.0.7 已部署状态（历史）

- **版本**：**v1.0.7**；schema **v19**；OpenCode **v2.2.5**；mcbot **v1.0.7**（契约 v1）。
- **范围**：`alert_events.dedupe_key`；mcbot `lastSuccessAt`；mcbot 进程或轮询过期进入 `service_down`；周度世界拉取安装到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`；寻路兜底进入自主重决策。
- **边界**：不挖掘/不放置/不跑酷；不新增 MCP 工具；5 格垂直墙仍只做兜底。应用从本版退回 v1.0.6 必须先恢复迁移前 DB 快照。
- **状态**：app `/opt/antifieldcloud/releases/20261104T093100Z`、mcbot `/opt/mcbot/releases/20261104T092858Z`；管理员在线时 5 格密封箱触发区内安全传送与一次重决策；演练 `20261104T103202Z` 为 schema 19；已发布 Tag/Release `v1.0.7`。
- **测试基线**：app **608**（607 pass、1 skip）+ web **279**（50 文件）+ mcbot **144**。

## v1.0.6 已部署状态（历史）

- **版本**：**v1.0.6**（已部署）；schema **v18**；OpenCode **v2.2.0**；mcbot **v1.0.6**（契约 v1）。
- **范围**：统一寻路层（pathfinder → 确定性 A* → 受控执行 → AI 路点 → 安全兜底）；1–5 级逐级台阶、1 格矮墙、2 格墙绕行；5 格垂直墙明确兜底；`navigation` 状态/事件/app 显示；`PATH_*` 九键。
- **边界**：不挖掘/不放置/不跑酷/不跨维度；任务/目标/自主仍限安全区；`过来/跟随`允许安全区外路径但不传送；AI 不直接控制、不能传送。
- **状态**：app `/opt/antifieldcloud/releases/20261030T132040Z`、mcbot `/opt/mcbot/releases/20261030T143538Z`；1–5 级台阶/矮墙/2 格墙绕行/安全区外路径通过，5 格垂直墙明确兜底；已发布 Tag/Release `v1.0.6`。
- **测试基线**：`npm run check` 通过；app **603**（602 pass、1 skip）+ web **278**（50 文件）+ mcbot **139**；核心实机矩阵通过。

## v1.0.5 已部署状态（历史）

- **版本**：v1.0.5；schema v18/OpenCode v2.2.0；mcbot v1.0.5。
- **范围**：在线模式/自动生存/清怪/多步目标与旧寻路回退。
- **状态**：app `/opt/antifieldcloud/releases/20261030T110436Z`、mcbot `/opt/mcbot/releases/20261030T120449Z`；已发布 Tag/Release。

## v1.0.4 已部署状态（历史）

- **版本**：v1.0.4；schema v18/OpenCode v2.2.0；mcbot v1.0.4（仅版本对齐）。
- **范围**：Bot 出站可用性中心；QQ Bot access_token 端点修复；备份 ack 历史错误修复。
- **状态**：app `/opt/antifieldcloud/releases/20261030T021856Z`、mcbot `/opt/mcbot/releases/20261030T005014Z`；完整 Access smoke 36/0/1/2。

## v1.0.3 已部署状态（历史）

- **版本**：v1.0.3；schema v18/OpenCode v2.2.0；mcbot v1.0.3（环境感知/自主决策增强）。
- **状态**：app `/opt/antifieldcloud/releases/20261028T144416Z`、mcbot `/opt/mcbot/releases/20261028T144253Z`；完整 Access smoke 36/0/1/2。

## v1.0.1 范围

- 项目定位同步到运行时 UI/HTML/manifest/登录/设置/systemd 文案（“个人综合交互平台”）。
- npm workspaces 单仓库（`apps/workbench` + `apps/mcbot`），根包统一门禁与版本。
- chatbot 全量更名（模块/表/列/env/API/审计/meta）与 schema v18 迁移。
- 原 lofii-bot 全历史导入 `apps/mcbot` 并硬切换（服务/用户/路径/env/API）。
- mcbot 稳定性/AI 只读工具/守卫/护送/探索/深矿/分类存箱/自动补货与故障注入。
- 文档分区（app/mcbot/legacy）、迁移脚本、CI/命名/版本门禁。
- OpenCode 2.1.4→2.2.0 升级与兼容矩阵；版本/文档漂移修正。
- v1.0.2：mcbot AI 自主会话（OpenCode 原生 MCP 工具循环）、应用自主控制、mcbot 运维残余、Agentic 验收。

## v1.0.1 关键决策

| 项 | 决策 |
|---|---|
| 定位 | 个人综合交互平台；`workbench` 仅 Web 端技术名 |
| 架构 | npm workspaces 单仓库；双进程 workbench + mcbot，loopback HTTP 契约 v1 |
| 数据 | schema v18 一次性改名；历史迁移只追加；旧应用不可读，回滚用快照 |
| OpenCode | 2.2.0；应用使用原生 HTTP API + MCP，不使用 2.2.0 breaking 的 SDK/Action/TUI 插件面 |
| 命名 | chatbot/mcbot 硬切换，不做旧 API/env 别名 |
| 部署 | mcbot → 迁移 Apply → app → Verify/smoke；保留旧 release/env/DB 快照 |

## v0.8.1 历史范围（保留）

> 以下自“v0.8.1 历史内容”起均为 v0.8.1 及更早的计划与验收记录，不再代表当前版本。当前事实以 README/AGENTS/ROADMAP/CHANGELOG/DEPLOY/ACCEPTANCE 为准。
### v0.8.1 历史内容

- **修复 SEC6-01（P1）/say 分块命令注入**：`POST /api/mcbot/say` 现在**必须启用控制 Token**（只读模式 `503 lofii_control_disabled`）；拒绝**任意位置 ASCII `/`**（含填充 240 字符后放在切分第二行的命令）与 C0 控制字符/DEL；上游 mcbot v0.6.1 的 `splitOutgoing` 逐行把行首 `/` 中和为全角 `／`（防御纵深，新增 239/240/255/480 边界测试）。
- **修复 SEC6-02/03/04（P2/P3）**：`mapmcbotAlert` 与前端标签查表改为 own-property（避免 `__proto__`/`constructor` 命中原型链）；`sanitizeDetails` 跳过原型键；`/history` 校验 `kind`/数组/行形状并只透传对象行；`mcbotClient` 响应改为**流式** 2 MiB 上限（不再先 `arrayBuffer()` 后检查）；Token 脱敏大小写不敏感；事件缓存增加 512 KiB 总字节上限；上游轮询 `recent` 改为 200 条。
- **修复 ARCH/DBG 健壮性**：前端 `safemcbotStatus` 归一化缺失嵌套段；`/status` 可达但 `events`/游标失败时显示可见警告；`eventsSupported` 对 `undefined` 正确回退；`mcbotPanel.load` 请求序号 + Abort 防旧响应覆盖；`mapmcbotAlert` 5 种已知类型/未知类型均安全；上游 5xx 的明确业务码 `task_disabled`/`control_disabled`/`history_disabled` 保留为 `lofii_*`；告警写入失败时游标停在上一条已处理事件并在下一轮重试；`taskId` 拒绝纯空白/控制字符/内部空白；`MCBOT_URL` 拒绝 userinfo/路径/查询/片段；`sync-mcbot-tokens.sh` 改为同目录临时文件 + `mv` 原子替换。
- **版本/文档**：AntifieldComplexx 0.8.1（`package.json`/lock/`deploy/env.example`）；README/AGENTS/CHANGELOG/PLAN/ROADMAP/API/UI-SPEC/ARCHITECTURE/SECURITY/DEPLOY/ACCEPTANCE/AUDIT 同步；schema/OpenCode 工具版本不变。
- **明确残余（本轮不修）**：告警事件无幂等键（schema v18 下一 minor）；告警风暴并发 webhook/Bot 上限；mcbot 进程未纳入 `service_down` 监控/metrics；`/status`/`history` 的 `lastError` 原样透传（admin-only）；`MCBOT_URL` 允许任意 loopback 端口；`stop()` 不取消在途轮询；真实 mcbot 告警未触发；**v0.8.1 已发布 Tag+Release**。详见 `docs/app/AUDIT.md` v0.8.0 Minor 补审计节。

### v0.8.1 关键决策

| 项 | 当前决策 |
|---|---|
| 对接方式 | 服务端低频轮询 `/status` + `/events/recent?limit=200`，不消费 SSE、不让浏览器直连 mcbot；默认 `MCBOT_POLL_MS=5000`（2000–60000） |
| 上游契约 | mcbot **v0.6.1**（最低 v0.6.0）、`contractVersion=1`；`/events/recent` 404（旧版）只置 `eventsSupported=false`，`/status` 继续可用 |
| Token | 读 Token 用于 `/status`、`/events/recent`、`/history`；控制 Token 用于 `/task/*`、`/move`、`/say`；控制 Token 为空 = 只读，控制接口与 `/say` 均 503 `lofii_control_disabled` |
| 聊天安全 | `/say` 只聊天、不执行命令：任意 ASCII `/` 拒绝、C0 控制字符/DEL 拒绝、720 字符上限；上游逐行中和 `/` 为防御纵深；审计只记字符数 |
| 网络边界 | `MCBOT_URL` 启用时必须 loopback + http(s) 且仅根地址（拒绝 userinfo/路径/查询/片段）；客户端 `redirect:'error'`、流式 2 MiB 上限、超时统一 `lofii_unavailable`，错误文本大小写不敏感脱敏 |
| 告警语义 | 外部事件 `status='event'`，不写 `alert_state`、不产生 firing/resolved；已知 5 类映射固定 severity，未知类型 `error→critical` 否则 warning；event 名 `lofii_<type>`（未知 `lofii_alert`） |
| 告警游标 | `meta.lofii.event_cursor={bootId,lastEventId,lastTs}`；首次/无游标/`bootId` 变化只建基线不重放；告警写入失败停游标并在下一轮重试；`MCBOT_ALERTS_ENABLED=false` 仍推进游标 |
| 数据/隐私 | 聊天与事件只进内存缓存（最多 100 条且 ≤512 KiB），不落库、不写日志；`/say` 审计只记字符数；历史校验形状后透传只读对象行 |
| Web | `/minecraft` 合并双标签；mcbot 未启用不显示标签；禁用/不可达/过期/部分失败/控制未启用分别有降级文案；状态归一化、轮询防竞态；不展示 Token/地址/内部路径 |
| schema | 保持 **v17**，无迁移；仅 `meta` 键 `lofii.event_cursor` |
| 默认状态 | `MCBOT_ENABLED=false`、读/控制 Token 为空；升级/回滚不影响既有功能 |
| 部署顺序 | 先升级 mcbot 到 v0.6.1（仅 loopback）→ root 同步 Token、核对 `--check` → 部署 AntifieldComplexx 0.8.1 → `MCBOT_ENABLED=true` 重启 → `/api/mcbot/status`、`/say` 只读 503、任意 `/` 400 与 smoke（`-ExpectedMcbotVersion 0.6.1`）验证 |
| 回滚 | `MCBOT_ENABLED=false` + 重启即停用 mcbot；版本回退上一 release；schema 不变、无 DB 回滚 |

### v0.8.1 架构与数据流

```text
浏览器 /minecraft?tab=lofii
  └─ GET /api/mcbot/status（5s 轮询） / history / POST tasks|move|say
       └─ 应用（127.0.0.1:3000，登录 + CSRF + 限流 + 控制 Token）
            ├─ mcbotService：单飞轮询 /status + /events/recent?limit=200 → 内存快照/事件缓存（≤100 条/≤512 KiB）
            ├─ 告警游标 meta.lofii.event_cursor → AlertService.recordExternal(status='event')；失败停游标重试
            └─ mcbotClient（读/控制 Token、redirect:error、2.5s 超时、流式 2 MiB 上限、大小写不敏感脱敏）
                 └─ HTTP → mcbot（127.0.0.1:3010，Minecraft 附属服务，仅 loopback）
```

- 轮询成功：更新 `statusSnapshot`、`version`、`contractVersion`、事件缓存；失败：只更新 `reachable/stale/error`，保留旧数据；`reachable=true` 且 `error≠null` 时前端显示部分失败警告。
- 事件合并：按 `id` 去重、newest-first、最多 100 条且序列化总字节 ≤512 KiB；`/events/recent` 404 时 `eventsSupported=false`。
- 告警：`advanceCursor` 过滤 `type='alert'` → `mapmcbotAlert`（own-property 查表，清洗 details 深度/键数/数组/字符串长度并跳过原型键）→ `recordExternal`（异步 webhook + Bot 通知）；写入失败停在上一条已处理事件并在下一轮重试。
- 控制：成功即 `refresh()` 拉一次最新状态；`/say` 使用控制 Token，只读模式 503。

### v0.8.1 阶段

1. **安全审计与修复**（完成）：三轨审计（架构对抗/安全/Debug）发现 P0=0；P1=1（`/say` 分块命令注入）已修复；P2=2（原型链/形状 + 面板崩溃）已修复；P3 多数加固已修复，残余见 AUDIT。
2. **服务端加固**（完成）：`client.ts`（流式 2 MiB、5xx 稳定码、大小写不敏感脱敏、history 形状）、`service.ts`（512 KiB 缓存、poll 200、游标失败重试、原型键清洗）、`routes/lofii.ts`（`/say` 控制 Token + 任意 `/` + C0、taskId 校验）、`config.ts`（`MCBOT_URL` 根地址限制）、`sync-mcbot-tokens.sh`（同目录临时文件 + `mv`）。
3. **Web 加固**（完成）：`safemcbotStatus`、`eventsSupported` 回退、部分失败警告、请求序号 + Abort、own-property 标签查表、`/say` 任意 `/` 拒绝、历史形状错误可见。
4. **上游 mcbot v0.6.1**（完成，另行提交）：`splitOutgoing` 逐行中和行首 `/`，新增 239/240/255/480 边界测试。
5. **测试/门禁**（完成）：`npm run check`、`test:coverage`、`test:web:coverage`、`build`、`check-version`（0.8.1）通过；新增/扩展 mcbot 回归测试。
6. **文档与验收**（完成）：本文件、README/AGENTS/CHANGELOG/ROADMAP/API/UI-SPEC/ARCHITECTURE/SECURITY/DEPLOY/ACCEPTANCE/AUDIT；生产部署、smoke、已认证 API 与安全回归已由 Lead 在 0.8.1 上执行并回填。

### v0.8.1 验收

- **本地（v0.8.1 已完成）**：`npm run check` 通过；`npm test` 572（571 pass、1 skip）、`npm run test:web` 256（48 文件）；服务端覆盖率 93.04/78.77/88.67、前端 55.83/51.29/48.66（门禁通过）；`npm run build` 通过；`check-version` 严格模式通过；`/say` 回归覆盖只读 503、任意 `/`、C0、240 字符切分边界（见 `docs/app/ACCEPTANCE.md` v0.8.1 节）。
- **生产（v0.8.1 已实测，2026-10-27）**：
  1. 应用部署 release `/opt/antifieldcloud/releases/20261027T113055Z`/commit `5405a8d`，`/healthz` v0.8.1/schema17（uptime/DB ok）；迁移前快照 `db-predeploy-20261027T113130633Z.sqlite`（sha256 `d16e15c3…1bd991a`）；上一生产 v0.8.0 保留为回滚点。
  2. 部署内只读 smoke **26/0/0/2**；完整 Access smoke **36/0/0/2**（**含本地任务标记检查，无 `-SkipLocalTaskCheck`**；期望 0.8.1/schema17/OpenCode 2.1.4/mcbot 0.6.1；此前两次失败为 Cloudflare 隧道瞬断，恢复后全绿）。
  3. mcbot v0.6.1（release `20261027T111640Z`/commit `a0a28da`）仅 loopback，Token `--check` read/control 均 match；`meta.lofii.event_cursor` 已更新。
  4. 已认证 API：`/api/version` 200（v0.8.1、lofii 两开关 true）；`/api/mcbot/status` 200（enabled/reachable/control/eventsSupported=true，version 0.6.1/contract 1）；`/say` 240 填充+`/op` 400、C0 400；临时会话已删（0）；审计无 `lofii.say`、`alert_events` `lofii_*` 仍 0；journal 无 error/0 条 64hex、env 0640、`systemctl --failed` 空。
  5. **UI 未在 v0.8.1 重新截图**（v0.8.0 视觉确认仍有效）；只读 `/say` 503 仅单测/集成覆盖（生产控制 Token 已配置，未改配置实测）。
- **生产边界（不得写成已完成）**：真实 mcbot 告警未触发（单元/集成覆盖，`alert_events` 暂无 `lofii_*`）；**v0.8.0 已发布 Tag+Release**（Tag `v0.8.0`→commit `c5ec851`，publishedAt `2026-10-27T12:02:45Z`）；**v0.8.1 已发布 Tag+Release**（Tag `v0.8.1`，GitHub Release 2026-10-27）。

### v0.8.1 非目标

- 不消费 mcbot SSE `/events`，不做浏览器直连/长连接面板。
- 不通过 `/say` 执行任何命令（任意 ASCII `/` 一律拒绝）。
- 不把 mcbot 告警接入 firing/resolved 状态机，不实现恢复通知/冷却（上游负责）；不新增告警幂等键（schema v18 下一 minor）。
- 不持久化聊天/事件正文，不提供事件搜索/导出/长期历史。
- 不管理 mcbot 生命周期、不读取其 RCON/OpenCode 密钥、不修改其配置；不把 mcbot 进程纳入 `service_down`（列残余）。
- 不支持多 mcbot 实例、多 Minecraft 服务器或多用户权限分离。
- 不把 mcbot 暴露到公网或 Cloudflare；不修改 nftables 对 3010 的 loopback 约束。

### v0.8.1 回滚

- **功能级**：`MCBOT_ENABLED=false`（可选清空读/控制 Token）+ 重启；应用回到仅 v0.8.1 其它行为，`meta.lofii.event_cursor` 可保留（再次启用时按现存游标续接，或删除该 meta 键重建基线）；无 schema/DB 变更。
- **控制面回滚**：清空 `MCBOT_CONTROL_TOKEN` + 重启即变只读（`/say` 也随之为 503）；如需完全停止对 mcbot 的调用，设 `MCBOT_ENABLED=false`。
- **版本级**：`deploy.ps1` 回退上一 release（v0.8.0）；schema 仍 v17；旧版本忽略新增 `MCBOT_*` env 与 `meta.lofii.event_cursor`。
- **数据**：本版不新增业务表/列；告警事件行（`status='event'`）按既有 90 天保留策略清理，不需要单独回滚。
