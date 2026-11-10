# AGENTS.md — AntifieldComplexx 工程约定（后续所有 Agent 会话必读）

## 0. 项目一句话

**项目定位：个人综合交互平台**——面向个人使用，以统一账号与单一入口整合个人数据/分享、Minecraft 与 mcbot、QQ chatbot、DeepSeek Harness AI 工作区，以及主机监控与备份灾备；`apps/workbench` 是 Web 端技术名。

**当前版本 v1.1.1（2026-11-09 已部署）**。schema 20、mcbot 契约 v2，Web、QQ 与 mcbot Agent 继续使用 DeepSeek Harness。生产同 schema 回滚基线为 v1.1.0。OpenCode **v2.2.5** 仅用于恢复历史版本 v1.0.13（`1743323`）。

生产 Workbench release 为 `20261109T143755Z`，mcbot 为 `20261109T142913Z`，DSH 为 `20261108T143448Z`。部署前快照 `db-predeploy-20261109T143804671Z.sqlite` 已校验 schema 20。应用与世界恢复演练 `20261109T144022Z` 通过。Workbench 同 schema 回滚保留现行库及 WAL。

**v1.0.7 基线（2026-11-04 已部署，commit `b17102b`）**：schema v19 为 `alert_events.dedupe_key`；mcbot 快照下发 `lastSuccessAt`；mcbot 进程不在或轮询过期走 `service_down`；寻路兜底进入自主重决策（不新增 MCP 工具，不挖掘/不放置/不跑酷）。OpenCode **v2.2.5** 已在树莓派运行，回滚备份 timestamp `20261104T062115Z`。v1.0.7 app `/opt/antifieldcloud/releases/20261104T093100Z`（schema 19）、mcbot `/opt/mcbot/releases/20261104T092858Z`。npm workspaces 单仓库（`apps/workbench` + `apps/mcbot`）；文档入口 [docs/INDEX.md](docs/INDEX.md)。

权威文档：
- `docs/app/PLAN.md`：范围、决策、阶段与验收
- `docs/app/API.md`：HTTP 契约（服务端/前端共同遵守）
- `docs/app/UI-SPEC.md`：界面与交互
- `docs/app/ARCHITECTURE.md`、`docs/app/SECURITY.md`、`docs/app/DEPLOY.md`、`docs/app/BACKUP.md`、`docs/app/CHATBOT.md`
- `docs/app/ROADMAP.md`：路线图与当前版本边界
- `docs/app/AUDIT.md`：审计发现与明确残余
- `docs/app/ACCEPTANCE.md`：验收记录
- `docs/INDEX.md`：文档分区总索引（app/mcbot/legacy）
- `deploy/tool-versions.json`：schema / OpenCode / mcbot 期望版本单一来源（PC 脚本与 check-version 共用）

## 0.1 命名与兼容标识符

- 项目/产品显示名：**AntifieldComplexx**（2026-10-27 由 AntifieldCloud 更名；GitHub 仓库 `antifield26/AntifieldCloud` 已改名为 `antifield26/AntifieldComplexx`，旧地址自动重定向；npm 包名 `antifieldcomplexx`）。此前发布的 Tag 与 GitHub Release 标题属于外部历史记录，保留旧名。
- **生产运行时标识符保持 `antifieldcloud` 不变**（与既有 Pi/PC 部署兼容；如需改名必须另做部署迁移，不能只改仓库）：文件系统路径（`/opt/antifieldcloud`、`/etc/antifieldcloud`、`/var/lib/antifieldcloud*`、`/run/antifieldcloud*`、`/var/backups/antifieldcloud`）、服务用户/组 `antifieldcloud`、systemd 单元 `antifieldcloud.service`/`antifieldcloud-world.*`/`antifieldcloud-health.*`、fail2ban jail `antifieldcloud.local`、Windows 计划任务 `AntifieldCloud-Backup-Pull`/`AntifieldCloud-World-Pull`/`AntifieldCloud-Backup-Offsite`、`%LOCALAPPDATA%\AntifieldCloud`、默认备份根目录 `%USERPROFILE%\AntifieldCloudBackups`。
- **兼容协议/数据标识符保持旧名**：告警 webhook 的 `source: 'antifieldcloud'` 与 HMAC 头 `x-antifieldcloud-signature`；恢复码哈希域盐 `antifieldcloud:recovery:`；OpenCode 旧默认会话标题 `AntifieldCloud Chat`/`AntifieldCloud Memory`（历史兼容清理目标）；PWA 缓存前缀 `antifieldcloud-static-`。
- 更名同步只改显示名（文档/UI 文案、标题、描述、注释、日志、告警 User-Agent、TOTP issuer）；不要改上述运行时或协议标识符。

## 1. 语言与注释

- 代码注释、文档、提交信息、UI 文案一律中文（技术标识符除外）。
- 注释解释「当前行为/约束」，禁止写历史叙事（“之前……”“修复了……”）或轮次标记。
- 每个模块顶部用一段中文说明职责与安全边界。

## 2. 运行模型

- Node >= 26；服务端为原生 TypeScript，`node server/src/main.ts` 直接运行，**不要引入编译/打包服务端步骤**。
- 相对导入必须带 `.ts` 后缀；禁止 enum/namespace/参数属性等非可擦除语法（`erasableSyntaxOnly` 已开启）。
- 前端由 Vite 构建，产物 `web/dist`；服务端只托管静态产物，不参与前端编译。
- 依赖：服务端运行时依赖放 `dependencies`；React/Vite/ESLint 等仅构建期依赖放 `devDependencies`（Pi 上 `npm ci --omit=dev` 不安装）。
- 类型工具链（TS7 并排）：`npx tsc` 来自 `@typescript/native`（TypeScript 7.0.2）；`typescript` 包是 `@typescript/typescript6@6.0.2` 别名，仅供 typescript-eslint（8.x 尚不支持 TS7 API）。结论为暂不升级、保留双 alias；不要删除/合并这两个 alias，直到 typescript-eslint 支持 TS7.1 API。
- 不使用 Docker；Pi 上用 systemd 原生命令运行。

## 3. 命令

```bash
npm ci
npm run dev            # 本地服务端，默认 127.0.0.1:3000
npm run dev:web        # Vite :5173，/api 代理到 :3000
npm run build          # 前端构建
npm run typecheck      # server + web 两个 tsc 项目
npm run lint           # ESLint，--max-warnings=0
npm test               # node --test（server/test/**/*.test.ts 与 scripts/test/**/*.test.mjs）
npm run test:coverage  # 服务端 + 运维脚本测试 + 覆盖率门禁（CI coverage job）
npm run test:web       # Vitest + jsdom（web/src/**/*.test.ts(x)）
npm run test:web:coverage # 前端测试 + 覆盖率门禁
npm run check          # app + mcbot + 命名门禁，提交前必须全绿
npm run check:mcbot    # mcbot typecheck + unit tests
npm run check:naming   # 旧标识符扫描（历史归档/迁移数据豁免）
npm run check:docs     # mcbot 文档声明/代码实现一致性检查
node scripts/check-version.mjs # 校验 package.json 与 README/CHANGELOG/ACCEPTANCE/AGENTS/env.example/DEPLOY、lock 根版本，并交叉校验 deploy/tool-versions.json ↔ db.ts ↔ 文档当前事实
```

本地门禁（v1.1.0）：`npm run check` 通过；服务端 **633**（632 pass、1 skip）+ web **283** + mcbot **174**；`check-naming`、`check:docs` 通过。上一版本基线（v1.0.13，2026-11-07）：app **625**（624 pass、1 skip）+ web **283** + mcbot **173**。v1.0.12：app **625**（624 pass、1 skip）+ web **283** + mcbot **168**。v1.0.10：app **625**（624 pass、1 skip）+ web **283** + mcbot **154**。演练为 `20261108T143038Z`（schema 20）。上一版本演练为 `20261106T135130Z`。

测试边界：禁止依赖真实 Minecraft、真实 OpenCode、真实 network；Bot 适配器（QQ 官方 Bot、Chat、图片下载、分段/格式化/自检/诊断）、备份 tar/age、告警投递等只使用进程内假平台/夹具（不访问真实平台或模型）。Windows 上无法测试的 systemd 相关用例用 `t.skip` 并在 Linux 上跑；`scripts/test/` 覆盖世界备份、恢复演练与异地副本规划等纯函数/夹具，不触碰真实 Pi。真实 QQ/Cloudflare/模型负路径需部署后联调，不把 mock 全绿等同于线上通过。

## 4. 目录与模块边界

```text
apps/workbench/server/src/
  main.ts            进程入口：配置、DB、Fastify、信号退出、启动指标采样
  config.ts          环境变量解析与校验（非法值/不安全组合失败即退出）
  logger.ts          Fastify/pino 日志与脱敏
  db.ts              SQLite 打开、迁移（工作区 schema v20）、事务辅助
  auth/              scrypt、TOTP、会话、CSRF、限流、恢复码、审计（字段截断 + 失败诊断）、Bot 发布 TOTP 再认证
  files/             存储、上传、配额、搜索、预览、回收站、files.origin 可见性、物理孤儿回收
  uploads/           分片上传会话/块索引、配额预留、拼接、过期与终态清理
  mc/                SLP、RCON、白名单
  opencode/          ai.* Host 的认证反代 + HTML 模式 + Origin 校验 + AI 主机限流/审计去重
  chatbot/           QQ 官方 chatbot 适配器、Chat AI、结构化长期记忆、私聊/群聊角色卡、上下文文档（context.ts）、连通性、
                     凭据 AES-256-GCM、Webhook 验签/去重、命令、回复管线、图片下载、自检、告警/发布队列；
                     群聊共享唯一 OpenCode Chat 会话（合成键 __group__，按目标串行），私聊每用户独立会话；
                     外发文本按 Bot/AppID 以 1000ms 最小间隔串行（分段/发送工具/兜底/队列统一）；
                     原始 DSML 工具调用文本只提取正文或固定兜底，不回显协议标记。
                     行为保持拆分：inbound.ts（入站验签/限流/命令与 Chat 分发）、chat.ts（Chat 回合/工具缓冲/记忆触发）、
                     diagnostics.ts（事件/入站目标/指标/最近错误）、queue.ts（投递/发布状态机），
                     ChatbotService 保留 facade/依赖装配；targets.ts（目标 CRUD）、
                     roles-admin.ts（用户/群角色卡管理）、memory-admin.ts（记忆管理），service.ts 只做 facade
  mcbot/              Minecraft bot（apps/mcbot）对接（v0.8.0 引入，v0.8.1 安全加固；默认关闭；仅 loopback）：
                     client.ts（读/控制 Token 分离、redirect:error、超时、流式 2 MiB 上限、5xx 稳定业务码、
                     大小写不敏感 URL/Token 脱敏、history 形状校验）、service.ts（单飞轮询 status/recent?limit=200、
                     100 条且 ≤512 KiB 事件内存缓存、stale、告警游标 meta.mcbot.event_cursor、alert→status='event'、
                     告警写失败停游标重试、控制成功后刷新、dedupe_key）；不持久化聊天/事件。告警幂等列在 schema v19
  backups/           归档导入/校验、文件级恢复（skippedMissing）、Web 对加密归档的 409 边界、状态只读
  dashboard/         主机指标、服务状态、备份状态（含加密/异地）、Bot 开关、轻量存储用量
  metrics/           60s 主机指标采样、按范围分桶聚合、30 天保留清理
  notes/             笔记/书签、标签、FTS5、附件（origin=note）、版本历史
  shares/            单文件/多文件分享、密码/过期/次数/原子计数、公开逐项下载、吊销
  alerts/            告警条件/状态机/webhook（含世界备份/拉取/演练/异地超期）与 Bot 通知入队；
                     recordExternal（外部事件 status='event'，不写 alert_state；同一 dedupe_key 不重复通知）；
                     schema v20 的 external_alert_deliveries 按通道记录 Webhook 与 QQ 入队，重启后续投
  cli/               backup.mjs 对应 CLI（backup.ts）与 backup-encryption.ts（age 加密/公钥/sidecar）
  http/              路由注册、错误处理、静态资源、安全头、requestMeta 信任模型、Cloudflare Access 说明；
                     chatbots.ts 管理 API、bot-webhook.ts 公开入口、mcbot.ts 只读/控制路由
  util/              通用工具（时间、路径、响应、只读状态文件解析 + 64 KiB 上限）
web/src/             React 页面与组件（只依赖 docs/app/API.md 的契约；/chatbots 管理页；/minecraft 双标签与 mcbot 面板；加密/异地状态卡）
scripts/             provision/backup CLI、世界备份 backup-world.mjs、恢复演练 drill.ps1/drill-verify.mjs、
                     world-pull.ps1、backup-pull.ps1、backup-offsite.mjs/.ps1、部署/冒烟 PowerShell、
                     bootstrap-env.sh、backup-secrets.sh、sync-mcbot-tokens.sh（root 同步 mcbot Token）、
                     check-version.mjs、check-prod-deps.mjs
scripts/test/        运维脚本单元测试（node --test .test.mjs）
deploy/              systemd（应用/健康探针/世界备份 timer）、nftables 模板（TEST-NET 占位）、
                     cloudflared ingress、env 模板、host/ 主机配置模板、tool-versions.json
```

`apps/mcbot/src/autonomy/`：v1.1.0 起生产由 DSH 插件经私有 Unix socket 调用 13 个工具；配置该 socket 后 `/autonomy/mcp` 返回 404。v1.0.2 至 v1.0.13 的 OpenCode 原生 MCP 循环、环境快照、只读容器、进食/装备、事件驱动重决策、策略/预算/急停与审计仍在代码中，供回滚路径使用。世界记忆与聊天记忆分开，分类固定，提示词只带索引。

写作用域约定：服务端改动在 `server/`，前端在 `web/`，脚本/部署在 `scripts/`、`deploy/`，文档在 `docs/` 与根 README/AGENTS/CHANGELOG；跨域改动先在本文件或任务中说明。

## 5. 安全红线（不可违反）

1. 应用 API 不提供任意 Minecraft RCON 命令、启停、封禁、OP；仅白名单增删 + 只读状态。
   `scripts/backup-world.mjs` 是唯一例外：以 root 由 `antifieldcloud-world.timer` 调用，只执行固定的
   `save-off` / `save-all flush` / `save-on`（`save-on` 放在 finally），应用 API 不可触达该能力。
2. 文件访问只经 DB id，不接受客户端路径；文件内容不可变；禁止覆盖上传。
3. 所有非 GET `/api` 校验 CSRF；Cookie `HttpOnly + Secure + SameSite=Lax`（仅 loopback HTTP 例外）。
4. 密码/TOTP/OpenCode 密码与任何平台/Bot 凭据、age 私钥不得进仓库、日志、错误响应、前端 bundle。
5. 预览仅白名单类型内联；SVG/HTML/XML 强制下载；文本预览上限 1 MiB。
6. 代理只允许固定 loopback 上游（`OPENCODE_URL` 启动校验，非 loopback 拒绝启动），客户端 `Authorization` 必须被覆盖；HTTP/WS 均校验 `Origin`。
7. 不修改现有 Minecraft/OpenCode/frpc/SSH 配置；不重启 Minecraft（除非用户明确授权并已备份）；nginx/certbot 不作为监控项。
8. 部署、备份脚本必须幂等、可重试；失败要留下可诊断日志，不得静默吞错。
9. 世界备份/拉取/演练/异地状态文件由 root/PC 脚本写入，应用只读；状态文件不得包含密钥、远端真实路径或凭据；应用读取有 64 KiB 上限并降级 null。
10. Bot 凭据（QQ AppSecret）只写不读，数据库只存 AES-256-GCM 密文；
    Webhook 只以 QQ Ed25519 签名/时间戳（含 op=13 回调校验）鉴权；群聊/频道不执行任何斜杠命令；C2C 命令除自助命令（`/help`、`/memory`、`/role` 仅私聊、`/reset`、`/forget confirm`）外，需目标 `allow_commands` + 显式 user 白名单；
    发布必须 TOTP 再认证；通知/命令输出不得包含内部路径、URL 或密钥；`CHATBOT_ENABLED=false` 时 Webhook 返回 404。
11. 备份整包加密：Pi 只读取独立 backup age 公钥（root 属主、组/其他不可写、`age1` 格式）；私钥离线 ≥2 份，应用/CLI 永不读取；**失败关闭**——age 缺失/公钥非法/加密失败/空间不足时 prepare 失败，不产生 pending、不降级明文；明文 tar 只允许短暂使用 `*.plain.tmp` 并在密文+sidecar 落盘后立即删除；空间按 2× 明文预算；明文 SHA-256/大小必须放归档外 sidecar 与 DB `manifest_json`（归档内 manifest 不得自引用）。
12. Web 不持备份私钥：`verify/import/entries/restore-plan/executeRestore` 在归档名合法化后、读取/解包前对 `.age` 返回 `409 archive_encrypted`，恢复目标自动跳过加密归档；加密归档只能由 PC/离线私钥解密、校验与恢复。
13. 异地副本只上传 `.age`（拒绝明文），链感知保留且绝不删除最新 full；状态只写别名/计数/时间，不写远端路径/URL/凭据；未配置（状态文件缺失）不得产生超期告警。
14. Bot AI 工具隔离 fail-closed（OpenCode 回滚路径；生产 QQ 由 DSH 管理）：OpenCode 拒绝 `permissions` 时不得以默认权限继续对话；启用发送工具或文档/read 模式且隔离不可用时新 Chat 返回 `503 chatbot_ai_tool_isolation_unavailable` 并回固定提示、写审计/状态；10 分钟重试窗口到点放行重试，上游恢复后自动恢复。
    文档模式只允许 `read` 当前作用域 `role.md`/`memory.md`（deny-all + 精确 read 规则）；不得放行 shell/edit/glob/grep；上下文目录不得包含密钥，文件 0640、目录 0750，不进入备份。
15. 审计写入不得静默失败也不得回滚已完成的业务状态：非安全审计事务外 best-effort，失败计数 + 最近错误暴露到 `/api/version.audit`；安全关键审计逐条记录；公开下载计数保持在事务内。
16. **AI 自主会话（v1.0.2 引入，v1.0.3 增强；代码默认关闭）**：仅主人显式启动；模型通过 DSH 插件经私有 Unix socket 调用 `start_task`/`stop_task`/`go_home`/`deposit`/`task_status`/`observe`/`inspect_chest`/`eat`/`equip`/`finish`/`memory_read`/`memory_write`/`memory_forget`，任务名受 `AUTONOMY_TASKS` 白名单约束；`observe` 只读环境（基础状态+半径内 allowlist 方块/容器），`inspect_chest` 仅扫描半径内、无 active/queue/pending 时短距寻路只读容器且不取物、不传送、不破块，`eat`/`equip` 仅空闲时对背包内食物/护甲/工具生效；任务生命周期与安全阈值事件驱动重决策（30s 去重、最多 6 次），无周期空转；会话使用随机 run_id + 短期 Bearer，配置 `DSH_AGENT_SOCKET` 后 `/autonomy/mcp` 返回 404。OpenCode 回滚路径的 session 必须 deny-all + `mcbot_autonomy_*` allow；预算/时间/连续失败/断线/手动指令/急停均需 fail-closed，结束必须停止任务并清理 session/MCP；不得把 `/autonomy/mcp` 暴露给应用/浏览器/公网，不得在日志/审计记录 prompt/Token/完整容器内容/世界记忆正文。世界记忆分类只有 place、resource、food、danger、route、note，文件为 dataDir 下的 world-memory.json（0600），与聊天记忆分开；提示词只带分类计数和最近 8 个键；记忆工具计入既有工具预算，不启动任务。
17. mcbot 对接（v0.8.0 引入，v0.8.1 安全加固）读/控制 Token 必须分离且只走 loopback：`MCBOT_URL` 非 loopback/非 http(s)/含 userinfo/路径/查询/片段拒绝启动，客户端禁止跟随重定向；Token 不得进入浏览器/bundle/API 响应/日志/审计正文；控制/任务/移动/聊天必须登录 + CSRF + 控制 Token + IP 限流并二次确认（`/say` 自 v0.8.1 起也需控制 Token，只读模式 503）；`/say` 只聊天（**任意 ASCII `/` 与 C0 控制字符一律拒绝**，防切行后的命令注入）且审计只记字符数；`taskId` 拒绝空白/控制字符；事件缓存 ≤100 条且 ≤512 KiB、响应体流式 ≤2 MiB；聊天/事件只存内存不落库；上游告警只能以 `status='event'` 记录，不得写入 `alert_state` 或伪装 firing/resolved。

## 6. 数据库与数据

- schema 迁移集中在 `server/src/db.ts` 的 `MIGRATIONS`，启动时按 `meta.schema_version` 顺序执行；迁移只追加，工作区 schema **v20**（v19 增加 `alert_events.dedupe_key`；v20 增加 `external_alert_deliveries`，记录独立 Webhook 和 QQ 入队状态）。
  备份加密/异地副本通过归档名后缀、sidecar 与 `manifest_json` 识别，不修改列/表；群共享记忆归属迁移复用现有 `chatbot_memory_items` 行（一次性 meta 标记 `chatbot_group_memory_owner_migrated_v1`）。
  数据库 schema 高于程序支持版本时拒绝启动。
- 时间统一存 ISO 8601 UTC 字符串；展示用 `Asia/Shanghai`。
- 文件物理路径 `DATA_DIR/files/<id 前两位>/<id>`；上传先写 `DATA_DIR/tmp/` 再原子 rename；物理孤儿回收只删除超期且 DB 无行的 id 形状文件。
- 配额 = 所有 `kind='file'` 的 `size` 之和（含回收站与笔记附件），上限 10 GiB；`fileCount` 只统计 `origin='user'`。
- `files.origin`：`user`（普通云盘）/`note`（笔记附件，不出现在列表/搜索/回收站）/`system`（保留）。
- `chatbots`：平台（仅 `qq`）/名称/启用/公开配置 + `secret_ciphertext/secret_iv/secret_tag/key_version`；`chatbot_targets` 唯一 `(chatbot_id, external_id)`，
  `allow_commands`/`allow_notifications` 默认关闭/开启、`allow_chat` 默认关闭（与命令权限独立），静默时段 `quiet_start_minute`/`quiet_end_minute`（0–1439，成对设置）；
  `chat_trigger` 复用为群消息模式（mention/all，默认 mention）；`chatbot_deliveries` 队列（`dedupe_key` 唯一）、`chatbot_publish_jobs` 仅文本发布（`media_file_ids_json` 写空）、
  `chatbot_events` 按 `(chatbot_id, platform_event_id)` 去重，记录 event_kind/outcome/detail/target_external_id/user_id/updated_at 供诊断（不存正文；outcome ∈ received/ok/denied/rate_limited/ignored/error）、`chatbot_ai_sessions` 按 `(chatbot_id,target_external_id,user_id,mode)` 复用 AI 会话（mode 只写 chat，列保留）、
  `chatbot_ai_memories` 为 legacy 滚动摘要（`summary_session_id` 保留列；仅作迁移来源/未迁移 fallback，镜像 `DATA_DIR/bot-memory/memory-<uuid>.md`）；
  `chatbot_memory_items` 按 `(chatbot_id,user_id,kind,mem_key)` 唯一保存结构化记忆（群 scope 为 `group:<targetExternalId>`，群 key 前缀为稳定 `<member_openid>:`，显示名只存 value；无法映射的旧键加 `legacy:`）、`chatbot_memory_state` 按 `(chatbot_id,user_id)` 保存 `memory_enabled` 与 `legacy_migrated_at`；
  `chatbot_group_roles` 按 `target_id` 保存群聊目标共享角色卡（名字 1–32、正文 1–1000，可停用；FK 级联删除）；
  `chatbot_inbound_targets` 按 `(chatbot_id,target_external_id,user_id)` 记录最近入站目标/用户名/类型/时间（不存正文）。QQ AppSecret 不落在日志/API 响应。
- v0.8.0/v0.8.1 mcbot 不新增表/列（当时 schema v18）：告警游标只写 `meta.mcbot.event_cursor`（`{bootId,lastEventId,lastTs}`）；mcbot 事件/聊天只在服务端内存（≤100 条且 ≤512 KiB，不落库）；mcbot 告警事件复用 `alert_events`（`status='event'`），不写 `alert_state`；告警写入失败时游标停在上一条已处理事件并在下一轮重试。v1.0.7 的 schema v19 为这些事件补上 `dedupe_key`。
- 审计只记录元数据，不记录文件内容、密码、TOTP、Cookie、Authorization；单条 actor≤64、target≤256、detail≤4 KiB。

## 7. 完成定义（DoD）

- `npm run check` 全绿；新逻辑有对应测试（成功 + 失败路径）。
- CI 的 coverage、audit、secret-scan、依赖边界检查全绿；`npm run build` 通过。
- API 变更同步更新 `docs/app/API.md`；界面变更同步 `docs/app/UI-SPEC.md`。
- 无密钥/个人数据进入仓库；`.env` 与 `data/` 被忽略；公开文档不得写入真实域名/网段（用 `app.<domain>`/`ai.<domain>`/`mc.<domain>` 与 TEST-NET 占位）。
- 部署相关改动同步 `docs/app/DEPLOY.md` 并说明回滚；备份/灾备改动同步 `docs/app/BACKUP.md`。
- 提交信息使用 Conventional Commits（`feat:`/`fix:`/`docs:`/`test:`/`chore:`/`deploy:`）。
- 每个阶段结束给出「产出摘要 + 未决问题 + 验证证据」。

## 8. 已知环境事实（不要重复踩坑）

- **v1.1.0（2026-11-08 已部署）**：Web、QQ 与 mcbot Agent 使用 DeepSeek Harness 0.2.2-rc.1，QQ 插件 0.5.5。schema 20，契约 v2。Workbench 与 mcbot release `20261108T080545Z`，DSH `/opt/antifield-dsh/releases/20261108T143448Z`。迁移前快照 `db-predeploy-20261108T080730455Z.sqlite`（sha256 `361d078c42a370d50fc92556a0a2ca1c142dd517d64c1acb2e947107a833d7ac`）。演练 `20261108T143038Z` 通过。OpenCode 于 22:40:40（UTC+8）退役。退役后 smoke **30/0/0/2**。整包加密与异地副本仍关闭。回滚使用 PC 上验证过的加密档和 v1.0.13 release，保留现行 schema 20 库。Minecraft 运行标识在切换时未变，最近一次插件重启仍是 2026-11-07 22:14:58 CST。
- **v1.0.13（2026-11-07，提交 `1743323`）**：挖矿和天然林先读 `resource` 记忆坐标。schema 20，契约 v2，OpenCode 2.2.5。不新增工具或环境变量。app `/opt/antifieldcloud/releases/20261107T121119Z`，mcbot `/opt/mcbot/releases/20261107T121646Z`。迁移前快照 `db-predeploy-20261107T121225041Z.sqlite`（sha256 `9a0e60b1…77fe9`）。部署内 smoke **26/0/0/2**，随后带 mcbot 契约和本地归档旁文件的 smoke **28/0/0/2**。OpenCode 启动时间未变。Minecraft 于 2026-11-07 22:14:58 CST 因插件更新重启。实机没有重跑挖矿或天然林。部署当时 Windows 计划任务标记仍是 1.0.12。发布后于 `2026-11-07T13:13:54.6451312Z` 重装为 1.0.13。回滚到 v1.0.12 的 app `/opt/antifieldcloud/releases/20261107T105450Z` 与 mcbot `/opt/mcbot/releases/20261107T111407Z`。应用保留 3 份后，v1.0.9 应用 `/opt/antifieldcloud/releases/20261106T134109Z` 已不在磁盘上。mcbot 按 5 份保留，含预发布 `20261107T084917Z` 与 v1.0.9 `20261106T134625Z`。
- **v1.0.12（2026-11-07，记忆提交 `b349b80`，版本提交 `e248830`）**：schema 20，契约 v2，OpenCode 2.2.5。v1.0.11 代码边界 `c7dd74b`，与 v1.0.12 分开发布，生产部署一次。app `/opt/antifieldcloud/releases/20261107T105450Z`，mcbot `/opt/mcbot/releases/20261107T111407Z`。迁移前快照 `db-predeploy-20261107T105556057Z.sqlite`（sha256 `07a3ec3b…63b4`）。部署内 smoke **26/0/0/2**，随后带 mcbot 契约和本地归档旁文件的 smoke **28/0/0/2**。Minecraft 与 OpenCode 未重启。实机没有重跑空手战斗、找食、梯子木门和世界记忆。Windows 计划任务于 `2026-11-07T11:43:26.7121209Z` 重装为 1.0.12。
- **v1.0.10（2026-11-07，功能提交 `2f19440`）**：行走不再受 `SAFE_*` 限制；`SCAN_RADIUS` 默认 32、最大 64；`CRITICAL_HEALTH` 默认 6。寻路失败不传送到任意目标。没有铁剑时仍撤退。schema 20，契约 v2，OpenCode 2.2.5。app `/opt/antifieldcloud/releases/20261107T094000Z`，mcbot `/opt/mcbot/releases/20261107T094221Z`。回退 mcbot 到 `/opt/mcbot/releases/20261106T134625Z`，回退 Workbench 到 `/opt/antifieldcloud/releases/20261106T134109Z` 并保留现行库。预发布实机曾用 `/opt/mcbot/releases/20261107T084917Z`，当时 `/healthz` 仍报 1.0.9。Minecraft 与 OpenCode 未重启。
- **v1.0.9 已部署并验收（2026-11-06，运行 commit `7cfbf2d`）**：schema v20；app `/opt/antifieldcloud/releases/20261106T134109Z`，迁移前 DB 快照 `db-predeploy-20261106T134205714Z.sqlite`（schema 20，sha256 `fb57be80…030a5`）；mcbot `/opt/mcbot/releases/20261106T134625Z`（契约 v2），回滚 release `/opt/mcbot/releases/20261105T021915Z`。演练 `20261106T135130Z` 通过（新全量 + 1 个增量，隔离恢复目录与世界解包）。Windows 每日与周度任务于 `2026-11-06T13:49:03Z` 重装为 1.0.9。完整 Access smoke **36/0/0/2**。Tag `v1.0.9` 指向 `4381a7d`。Minecraft 与 OpenCode 进程启动时间未变。
- **v1.0.8 已部署并验收（2026-11-05，运行 commit `2440758`）**：schema v20；app `/opt/antifieldcloud/releases/20261105T021739Z`，迁移前 DB 快照 `db-predeploy-20261105T021746014Z.sqlite`（schema 19）；mcbot `/opt/mcbot/releases/20261105T021915Z`（契约 v2），回滚 release `/opt/mcbot/releases/20261104T092858Z`。演练 `20261105T022152Z` 通过（schema 20，文件哈希与世界隔离解包）。Windows 每日与周度任务于 `2026-11-05T07:16:49Z` 重装为 1.0.8，脚本 SHA 与仓库一致。完整 Access smoke **36/0/0/2**。Tag `v1.0.8` 指向 `6ad9449`。
- **v1.0.7 已部署并验收（2026-11-04，commit `b17102b`）**：schema v19；app `/opt/antifieldcloud/releases/20261104T093100Z`，迁移前 DB 快照 `db-predeploy-20261104T093146763Z.sqlite`（sha256 `1b09c9…fa03`）；mcbot `/opt/mcbot/releases/20261104T092858Z`（契约 v1）。OpenCode 运行中 2.2.5，回滚备份 `20261104T062115Z`。完整 Access smoke **36/0/1/2**（当时 WARN=演练仍为 schema 18；SKIP=加密/异地关闭；随后演练已到 schema 19，未重跑 smoke）。停止 mcbot 后 `service_down` firing「未运行：mcbot」，启动后 resolved；Minecraft 未重启。管理员在线时，安全区内临时 5 格密封圆石箱（x134–136, y64–68, z424–426）让 `go_home` 走 `no_path`/`exhausted`，安全传送到 `174.5,64,410.5`（区内），`decisionCycles=1`、`lastEvent=寻路兜底：已安全传送`。围墙已拆，bot 回到 `183.5,64,435.5`，随后只重启 mcbot，清掉 `movement.stop()` 留下的 `cancelled`。`FORCE_ONLINE` 未改。同日演练 `20261104T103202Z` 通过：full `snapshot-20261102T014632977Z-full.tar.gz` + 7 inc，最新 DB `db-20261104T103144405Z.sqlite` schema 19，世界归档 `world-20261101T040001Z.tar.gz` 只做 SHA/`level.dat` 名校验。Windows 每日与周度任务已重装到 1.0.7，世界拉取 `-File` 为 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，下次周日 12:00。已发布 annotated Tag `v1.0.7` 与 GitHub Release。mcbot 已按保留 3 份删除 `/opt/mcbot/releases/20261030T120449Z` 与 `20261030T142942Z`（各 538 MiB）。当时保留 `20261104T092858Z`、`20261030T143538Z` 与 `20261030T143306Z`。v1.0.8 部署后 current 已切到 `20261105T021915Z`。
- **v1.0.6 已部署并验收（2026-10-30）**：统一寻路层（pathfinder → 确定性 A* → 受控执行 → AI 路点 → 安全兜底）；1–5 级台阶、1 格矮墙、2 格墙绕行、安全区外路径通过，5 格垂直墙明确兜底；`navigation` 状态/事件/app 面板；app `/opt/antifieldcloud/releases/20261030T132040Z`、mcbot `/opt/mcbot/releases/20261030T143538Z`；smoke 26/0/1/2；已创建 Tag `v1.0.6` + GitHub Release。Windows 每日备份任务已重装为 1.0.6，备份根迁移到 `D:\Backups`，恢复演练 `20261030T145445Z` 通过（schema 18），本机 smoke 29/0/0/2。
- **树莓派磁盘清理（2026-10-31）**：根分区曾 58 G 用 51 G、可用 5.5 G（9.5%）；根因是 mcbot 每次部署保留约 538 MiB 的 release 但没有清理（40 个），加 legacy 旧版 bot 27 个旧 release。已保留 mcbot current + previous 及 2 个 v1.0.6 开发 release，删除 36 个 mcbot + 26 个 legacy；可用恢复到 36 G（37% 已用）。`apps/mcbot/scripts/deploy.ps1` 新增 `-KeepReleases`（默认 3，保护 current/previous）。详见 `docs/app/AUDIT.md`。
- **v1.0.5 已部署生产（2026-10-30）**：在线模式 `auto/always/off`、自动生存/补货默认开启、安全区清怪 `clearing`、多步目标/长期记忆、高低差路径看门狗/起跳重试/安全传送；app `/opt/antifieldcloud/releases/20261030T110436Z`、mcbot `/opt/mcbot/releases/20261030T120449Z`；已发布 Tag/Release v1.0.5。高差路径复杂场景仍可能安全传送，见 `docs/app/AUDIT.md`。
- **v1.0.4 生产历史（2026-10-30，最终构建）**：主更新 Bot 出站可用性中心（`ChatbotStatus.outbound` 健康快照、`chatbot_outbound_down` firing/resolved 告警、批量重试 failed/dead 排除 `partial_text_sent`、管理页状态）；QQ Bot access_token 端点由不可解析/证书不匹配的 `chatbots.qq.com` 修正为 `bots.qq.com`，连通性探针同步；备份 `ack` 清除历史 `last_error`，Dashboard/列表忽略已 ack/已删除归档错误；无 schema 迁移/破坏性 API。app release `/opt/antifieldcloud/releases/20261030T021856Z`（1.0.4/schema18/OpenCode2.2.0/commit `c5a69bd`）、mcbot release `/opt/mcbot/releases/20261030T005014Z`（1.0.4/contract1）；部署前 DB 快照 `db-predeploy-20261030T021908886Z.sqlite`（sha256 `7c8c47…1872`），手工备份 `/var/backups/antifieldcomplexx/v1.0.4-final-predeploy-20261030T020959Z`；完整 Access smoke **36/0/1/2**；部署后 QqAdapter access_token 获取成功，outbound `degraded=false`、51 条历史死信不触发告警、`chatbot_outbound_down` 无 firing；Windows 备份任务标记 1.0.4；已发布 Tag v1.0.4 + GitHub Release。
- **v1.0.3 生产已部署（2026-10-28）**：mcbot 环境感知/自主决策（observe/inspect_chest/eat/equip、方块/容器扫描、事件驱动重决策）+ 文档-实现一致性审计；app release `/opt/antifieldcloud/releases/20261028T144416Z`（1.0.3/schema18/OpenCode2.2.0/commit `b385d02`）、mcbot release `/opt/mcbot/releases/20261028T144253Z`（1.0.3/contract1）；部署前快照 `/var/lib/antifieldcloud/backups/db-predeploy-20261028T144601033Z.sqlite`（sha256 `540457…b00a`），手工备份 `/var/backups/antifieldcomplexx/v1.0.3-predeploy-20261028T144245Z`；完整 Access smoke **36/0/1/2**（WARN=drill schema17；2 SKIP=加密/异地默认关闭）；实机 Agentic 调用 `observe`+`task_status`+`finish`（toolCalls=3，低血告警触发重决策，session/MCP 清理）；Windows 备份任务标记 1.0.3；`FORCE_ONLINE=false` 已恢复；已补发 Tag `v1.0.3` + GitHub Release。
- **v1.0.2 生产已部署（2026-10-28）**：mcbot 原生 MCP 自主会话 + 应用面板自主控制 + Agentic 验收 + mcbot 运维残余；本地门禁 app 591/web 273/mcbot 108；部署内 smoke 26/0/1/2、完整 Access smoke 36/0/1/2（含 Windows 任务标记 1.0.2；WARN=drill schema17）；实机 Agentic `task_status`+`finish` 2 次工具调用通过；2026-10-28 按用户要求启用 `AUTONOMY_ENABLED=true`（`FORCE_ONLINE=false`），Windows 备份任务重装到 1.0.2；已补发 Tag `v1.0.2` + GitHub Release（未影响 v1.0.3 生产）。
- **v1.0.1 生产已部署（2026-10-28）**：app `1.0.1`/schema `18`/OpenCode `2.2.0`（release `/opt/antifieldcloud/releases/20261028T021311Z`，部署快照 `db-predeploy-20261028T021322569Z.sqlite`）；mcbot `1.0.1`（release `/opt/mcbot/releases/20261028T021116Z`，服务 `mcbot.service` active）；旧 `lofii-bot` 已停止/禁用但旧 release `/opt/lofii-bot/releases/20261027T111640Z` 与数据保留用于回滚。生产 env 已迁移为 `CHATBOT_*`/`MCBOT_*`（旧键 0 个），上下文目录 `/var/lib/antifieldcloud-chatbot-context`，`WEB_DIST_DIR=/opt/antifieldcloud/current/apps/workbench/web/dist`；botmsg MCP 已更新为 `/opt/botmsg-mcp/chatbot-tool-mcp.mjs`。备份：`/var/backups/antifieldcomplexx/v1.0.0-predeploy-20261028T000149Z`（DB+env+bot data）、`v1.0.0-20261028T000645Z`（Apply 备份）、`v1.0.0-webdist-20261028T001809Z`、`v1.0.0-unit-sync-20261028T001113Z`。Cloudflare Access `/api/chatbot/webhook` bypass 已更新（2026-10-28）、Windows 备份任务已重装 appVersion=1.0.1；OpenCode 2.1.4→2.2.0 升级备份在 `/var/backups/opencode`（`20261028T020723Z`），兼容矩阵 V1–V9/V14 通过、MCP 进程各 1 个。待人工：QQ 平台回调重新校验、下一次备份后按 schema 18 重跑 recovery drill。
- Pi：`antifield@192.0.2.10` 直连（TEST-NET 占位；实际值见 `.local/DEPLOYMENT.md`）；WiFi 示例 `198.51.100.10` 与 PC 不通（AP 隔离）；直连 SSH 偶发超时，脚本需重试。
- 校园网有 Portal 认证（占位 `https://portal.<domain>`；实际端点见 `.local`）；树莓派重启后认证可能失效，表现为 Cloudflare 7844 出站阻断、tunnel 1033/公网 530；需从 Pi 出口重新完成认证，再 `systemctl reset-failed cloudflared && systemctl restart cloudflared`。
- Pi 上 Node 为 `/usr/local/bin/node`（v26.13.0，2026-11-07，世界可执行；旧回滚二进制已删除，保留 `/usr/local/lib/nodejs/node-v26.13.0-linux-arm64`）；npm 指向 `/home/antifield/.nvm`（12.2.0），部署时以 root 使用。cloudflared 为 2026.10.7，旧回滚二进制已删除。
- OpenCode 2.2.5 已于 2026-11-08 22:40:40（UTC+8）从 Pi 退役，活动单元、二进制与环境配置已移除，4096 不再监听。回滚运行时仍是 2.2.5，使用 PC 上验证过的加密档。更早的 v2.2.0 备份 timestamp `20261104T062115Z` 只作历史回滚点，不是 2026-10-28 的 v2.1.4 备份。升级矩阵见 `docs/app/DEPLOY.md` §3.2。退役前 `opencode.json` 没有 `integration.use` 拆分，也未改 `compaction.buffer`；全局 `permission.bash/edit/webfetch/write` 为 `ask`。退役前监听 `127.0.0.1:4096`，Basic 用户名 `opencode`，密码来自 `/etc/opencode/opencode.env` 的 `OPENCODE_PASSWORD`。**版本以运行中 `/api/info` 为准，不以 CLI `--version` 为准**：`opencode upgrade` 只替换磁盘二进制，不重启服务；2.2.0 升级曾出现 CLI 已新、Web/API 仍旧（`/proc/<pid>/exe` 标记 deleted），`systemctl restart opencode` 后修正；`smoke.ps1` 校验 `/api/info` 版本与进程 exe 非 deleted。2.2.5 把名为 `bash` 的工具调用映射为 `shell`。本次矩阵未观察到 `deny *` 被绕过，未加显式 bash/shell deny。
- Minecraft：Paper 26.1.2，RCON `127.0.0.1:25575`，密码在 `server.properties`（32 位随机），服务器语言中文，输出含 `§` 颜色码需剥离；RCON 仍监听所有接口，nftables 仅放行 loopback。插件为 Chunky 1.5.66、CoreProtect CE 24.1、EssentialsX 2.22.0、LuckPerms 5.5.91、PlaceholderAPI 2.12.3、VaultUnlocked 2.20.3、ViaVersion 5.12.2、Vote2Sleep 1.3.0。最近一次插件重启的进程启动时间为 2026-11-07 22:14:58 CST。v1.1.0 切换未改变该运行标识。
- Pi 已启用 memory cgroup；`antifieldcloud-health.timer` 每 60s 写 `/run/antifieldcloud/pi-health.json`；`age` 与（启用异地副本时）`rclone` 已安装；`unattended-upgrades` 已安装。
- 备份：应用归档为两阶段 pending/ack（未确认不删）；PC 任务参数为实际 `-PiHost/-BackupRoot`，ACL 收紧；密钥包 Pi 端 `KEEP=2` 滚动保留，PC 不再立即删除远端密钥包。
- 备份整包加密（默认关闭）：`BACKUP_ARCHIVE_ENCRYPTION=false`、`BACKUP_AGE_RECIPIENT_FILE=/etc/antifieldcloud/backup-age.pub`（root 属主 0644、组/其他不可写、单行 `age1…`）、`BACKUP_OFFSITE_STATUS_FILE=/var/lib/antifieldcloud/backup-offsite-status.json`、`ALERT_OFFSITE_MAX_AGE_HOURS=48`；该密钥对独立于 `secrets-age`，私钥离线 ≥2 份，禁止放 Pi。
- 加密归档命名 `snapshot-<stamp>[-n]-(full|inc).tar.gz.age`，外部 sidecar `<name>.meta.json`（schema 2：plainSha256/plainSize/cipherSha256/cipherSize/recipient/…），`.sha256` 始终表示密文 SHA-256；临时明文 `*.plain.tmp` 崩溃后由下次 prepare 清理 >24h 残留。
- 异地副本（默认关闭，PC 端）：`scripts/backup-offsite.mjs` + `.ps1` 由 `install-backup-task.ps1 -InstallOffsiteTask` 安装为 `AntifieldCloud-Backup-Offsite`（默认每日 13:00、6h 超时、IgnoreNew）；需用户先配置 rclone remote/凭据；只上传 `.age`，链感知保留（最新 full + 其后全部 inc + 最近 N 天）。
- 世界备份：`antifieldcloud-world.timer` 每周日 12:00（显式 Asia/Shanghai，`Persistent=true`）以 root 执行 `scripts/backup-world.mjs`，归档到 `/var/lib/antifieldcloud/world-backups`、保留 4 份；Minecraft 世界约 4.1 GiB，周备份耗时与磁盘余量按 1.5× 世界体积预留。
- 定时策略：仅项目世界备份 timer 统一到周日 12:00；健康探针保持 60s；系统维护 timer（apt/logrotate/fstrim 等）保持发行版默认。
- 备份/灾备状态文件由脚本写入、应用只读：`/var/lib/antifieldcloud/world-backup-status.json`、`world-pull-status.json`、`drill-status.json`、`backup-offsite-status.json`（0644）；Dashboard/Settings 与告警读取。
- Bot 上下文文档目录（v0.7.3；服务已退役的 OpenCode 文档模式）：`/var/lib/antifieldcloud-chatbot-context`（文件 0640，不跟随符号链接，不进入备份）。生产 QQ 由 DSH 管理。应用 unit 的 `ReadWritePaths` 已包含该目录。
- systemd 加固：`antifieldcloud.service` 已加 `CapabilityBoundingSet=`（空）、`RestrictAddressFamilies`、`PrivateDevices`、`ProtectClock/Hostname/KernelLogs`、`RestrictSUIDSGID/Realtime` 等；`antifieldcloud-world.service` 同样加固并有 `flock`、4h 超时。
- nftables：默认拒绝入站；22 仅 `192.0.2.0/24` + `198.51.100.0/24`（TEST-NET 占位，安装前替换为实际直连/校园网段）且新建连接限速 20/min；25565 仅同网段；25575 仅 loopback；DHCP 仅 `eth0`/`wlan0`。**改 22 网段前先确认当前 SSH 来源在允许集合内**。
- SSH 仅公钥：`/etc/ssh/sshd_config.d/00-` drop-in 先于其它配置生效（禁用密码/键盘交互，保留公钥）；旧回滚备份归档在 `/var/backups/antifieldcloud/`（0600 root），`/root` 无残留，活动配置未改；`fail2ban` 已安装并启用 `sshd` jail（nftables 后端，24h ban），dbfile 持久化；`deploy/systemd/nftables.service.d/10-fail2ban-restore.conf` 在 nftables 启动后异步重启 fail2ban 恢复封禁 set。**手工 `systemctl reload nftables` 不触发该 drop-in，仍需 `systemctl restart fail2ban`**。主机级配置模板见 `deploy/host/`（sshd/fail2ban/cloudflared/journald/log2ram），`backup-secrets.sh --include-host-config` 可纳入密钥包。
- Bot 环境变量：`CHATBOT_ENABLED`（默认 **false**）、`CHATBOT_SECRET_KEY`（32 字节 base64，`bootstrap-env.sh` 仅在缺失时生成，`--force` 复用旧值）；`CHATBOT_WEBHOOK_MAX_BODY_BYTES=262144`、`CHATBOT_DELIVERY_INTERVAL_SECONDS=30`、`CHATBOT_DELIVERY_MAX_ATTEMPTS=5`、`CHATBOT_OUTBOUND_ALERT_ENABLED=true`、`CHATBOT_OUTBOUND_FAILURE_WINDOW_MINUTES=60`、`CHATBOT_OUTBOUND_FAILURE_THRESHOLD=1`、`CHATBOT_EVENT_RETENTION_DAYS=7`、`CHATBOT_COMMAND_RATE_PER_MINUTE=120`、`CHATBOT_PUBLISH_MAX_SCHEDULED_DAYS=30`、`CHATBOT_MAX_BOTS=10`。
  AI：`CHATBOT_AI_ENABLED=false`、`CHATBOT_AI_PROVIDER=`、`CHATBOT_AI_MODEL=`、`CHATBOT_AI_TIMEOUT_SECONDS=60`、`CHATBOT_AI_MAX_PROMPT_CHARS=2000`、`CHATBOT_AI_RATE_PER_HOUR=120`、`CHATBOT_AI_SESSION_RETENTION_DAYS=7`、`CHATBOT_AI_MAX_REPLY_CHARS=4000`、`CHATBOT_AI_VISION_ENABLED=true`、`CHATBOT_AI_IMAGE_MAX_BYTES=10485760`、`CHATBOT_AI_MEMORY_MAX_CHARS=4096`、`CHATBOT_AI_MEMORY_RETENTION_DAYS=365`、`CHATBOT_AI_MEMORY_BATCH_MESSAGES=3`、`CHATBOT_AI_MEMORY_IDLE_FLUSH_SECONDS=120`；
  Chat/记忆：`CHATBOT_CHAT_RATE_PER_MINUTE=30`、`CHATBOT_MEMORY_MAX_ITEMS=200`、`CHATBOT_MEMORY_PROMPT_MAX_CHARS=3000`、`CHATBOT_MEMORY_PROMPT_MAX_ITEMS=12`、`CHATBOT_MEMORY_TTL_EPISODE_DAYS=90`、`CHATBOT_MEMORY_TTL_TASK_DAYS=30`；
  连通性：`CHATBOT_CONNECTIVITY_ENABLED=true`、`CHATBOT_CONNECTIVITY_INTERVAL_SECONDS=60`、`CHATBOT_CONNECTIVITY_TIMEOUT_SECONDS=8`；
  群聊：`CHATBOT_CHAT_BURST_GROUP_ALL_WINDOW_MS=8000`、`CHATBOT_CHAT_BURST_GROUP_ALL_MAX_WAIT_MS=20000`、`CHATBOT_AI_SEND_TOOL_ENABLED=false`（启用前安装 `botmsg` MCP）；
  上下文文档：`CHATBOT_AI_CONTEXT_READ_ENABLED=false`（默认；OpenCode 时期生产曾显式 true，读范围矩阵 7/7 通过）。该开关服务已退役的 OpenCode 文档模式，生产 QQ 由 DSH 管理。`CHATBOT_CONTEXT_DIR=/var/lib/antifieldcloud-chatbot-context`（不得位于 DATA_DIR 内）；
  **连续外发：生产固定 1000ms 最小间隔（按 Bot/AppID 串行，代码内 `DEFAULT_SEND_INTERVAL_MS`；无 env 开关；测试注入 0）。**
  搜索：`CHATBOT_SEARCH_ENABLED/URL/AUTO/MODE/MAX_RESULTS/TIMEOUT_SECONDS/MAX_SNIPPET_CHARS/LANGUAGE/SAFESEARCH/ENGINES/RATE_PER_HOUR`（`CHATBOT_SEARCH_MODE` 仅 mcp/prefetch，非法值拒绝启动）。
  上述键均纳入 `bootstrap-env.sh` MANAGED_KEYS；生产 env 的废弃键清理用 `--force --prune-unknown`（先 `cp -a` 备份）。`CHATBOT_SECRET_KEY` 与 DB 必须一起备份；丢失后已存 QQ AppSecret 只能重新录入。
- mcbot 环境变量（v0.8.0 引入，v0.8.1 加固；默认关闭）：`MCBOT_ENABLED=false`、`MCBOT_URL=http://127.0.0.1:3010`（启用时必须 loopback + http(s) 且仅根地址，拒绝 userinfo/路径/查询/片段）、`MCBOT_READ_TOKEN=`、`MCBOT_CONTROL_TOKEN=`（root 执行 `scripts/sync-mcbot-tokens.sh` 从 `/etc/mcbot/env` 的 `HTTP_TOKEN`/`HTTP_CONTROL_TOKEN` 同步，`--check` 只比较；同目录临时文件 + `mv` 原子替换；控制为空 = 只读，`/say` 也 503）、`MCBOT_TIMEOUT_MS=2500`（500–10000）、`MCBOT_POLL_MS=5000`（2000–60000）、`MCBOT_ALERTS_ENABLED=true`；上述键均纳入 `bootstrap-env.sh` MANAGED_KEYS。mcbot **v1.1.0**（最低 v0.6.0，契约 v2，发言使用控制 Token；Workbench 兼容契约 v1 的读取与既有控制。独立 systemd 服务，仅 `127.0.0.1:3010`，不经 Cloudflare/nftables 对外；v0.6.1 逐行中和行首 `/`）；`smoke.ps1 -ExpectedMcbotVersion 1.1.0 -ExpectedMcbotContractVersion 2`（最低兼容 0.6.0）校验服务 active + `/healthz.version` 与契约版本，未启用用 `-SkipMcbot`。生产进程为 v1.1.0（`/opt/mcbot/releases/20261108T080545Z`）。回滚到 v1.0.13 使用 `/opt/mcbot/releases/20261107T121646Z`。再退到 v1.0.12 使用 `/opt/mcbot/releases/20261107T111407Z`。v1.0.13 部署时按 5 份保留，其中包含预发布 `/opt/mcbot/releases/20261107T084917Z`（健康检查报 1.0.9）与 v1.0.9 `/opt/mcbot/releases/20261106T134625Z`。v1.0.6 新增 `PATH_*` 九键：`PATH_PLANNER_ENABLED`、`PATH_PLANNER_MAX_NODES`、`PATH_PLANNER_TIMEOUT_MS`、`PATH_MAX_REPLANS`、`PATH_TELEPORT_FALLBACK`、`PATH_OUTSIDE_SAFE_RADIUS`、`PATH_AI_ENABLED`、`PATH_AI_TIMEOUT_MS`、`PATH_AI_COOLDOWN_MS`。
- v1.0.2/v1.0.3 AI 自主环境变量（默认关闭）：`AUTONOMY_ENABLED=false`、`AUTONOMY_MAX_MINUTES=20`、`AUTONOMY_MAX_TOOL_CALLS=12`、`AUTONOMY_MAX_FAILURES=2`、`AUTONOMY_GOAL_MAX_CHARS=200`、`AUTONOMY_DECISION_TIMEOUT_MS=180000`、`AUTONOMY_MCP_WARMUP_MS=3000`、`AUTONOMY_SCAN_RADIUS=16`、`AUTONOMY_SCAN_MAX_BLOCKS=48`、`AUTONOMY_SCAN_BLOCKS=chest,trapped_chest,barrel,ender_chest,*_bed,water,crafting_table,furnace,blast_furnace,smoker,wheat,carrots,potatoes,beetroots,*_log,*_ore`、`AUTONOMY_CHEST_READ_ENABLED=true`、`AUTONOMY_CHEST_PATH_TIMEOUT_MS=12000`、`AUTONOMY_EAT_BELOW=18`、`AUTONOMY_ACTION_COOLDOWN_MS=5000`、`AUTONOMY_EVENT_DEBOUNCE_MS=30000`、`AUTONOMY_MAX_REPROMPTS=6`、`AUTONOMY_TASKS=fishing,farming,woodcutting,mining,forest,sleep,patrol,guard,escort,explore,clearing`；生产进程为 v1.1.0，自主工具由 DSH 插件经私有 Unix socket 调用，仍仅主人显式启动（代码默认仍为 false）。v1.0.7 把寻路兜底送进既有重决策（30 秒去重、每会话最多 6 次），不新增工具。`PATH_AI_ENABLED=false` 可单独关闭寻路 AI。OpenCode 寻路建议只属于已退役的回滚路径。
- 备份/灾备 env：`BACKUP_IMPORT_RETENTION_DAYS=90`（0=永久）、`ALERT_REPEAT_HOURS=24`（0=关闭；兼容键 `ALERT_COOLDOWN_MINUTES` 仍可解析）。
- Bot 公开入口：`POST /api/chatbot/webhook/:botId`（无 session/CSRF，按平台签名鉴权）；Cloudflare Access 必须对 `/api/chatbot/webhook/*`、`/healthz`、`/s/*`、`/api/public/shares/*` 做 bypass，否则平台回调/健康检查/公开分享会被边缘拦截。`CHATBOT_ENABLED=false` 时该路径返回 404。
- Bot 平台注册（QQ 开放平台）与 Cloudflare Access 策略均由用户在各自后台完成，Agent 不代替；仅 QQ 官方 Bot。
- 测试证据边界：平台适配/Chat/记忆/图片/自检/诊断/备份 tar/告警投递以进程内 mock/夹具为主，未做真实 QQ 平台限流/签名漂移/故障负路径；真实 QQ 消息验收记录见 `docs/app/ACCEPTANCE.md`。
- Windows 世界拉取（`scripts/world-pull.ps1`，周度）任务名 `AntifieldCloud-World-Pull`（周日 12:00）。`install-backup-task.ps1` 把脚本复制到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1` 再注册，`-File` 指向该副本。`-BackupRoot` 与每日任务相同（本机 `D:\Backups`，世界归档在 `world\`）。任务名与 `%LOCALAPPDATA%\AntifieldCloud` 不改。恢复演练（`scripts/drill.ps1`）保持手动/季度；异地副本按用户决定保持关闭、未配置 remote。2026-11-08 验收记录写每日备份与周度世界拉取已更新至 1.1.0，未另记 installedAt。异地副本任务未安装。上一轮为 v1.0.13，installedAt `2026-11-07T13:13:54.6451312Z`。再上一轮为 v1.0.12，installedAt `2026-11-07T11:43:26.7121209Z`。
- Cloudflare：zone 使用占位 `example.com`；tunnel 名称 `pi`；`mc.<domain>` CNAME 到 SakuraFRP，**不要改**；`app/ai` 的 DNS 由用户手动添加；Access 主应用 + 4 个 bypass + service token 已在生产配置（见 `docs/app/DEPLOY.md` §5.2），`ai` 主机另有 Access 应用（Owner allow + Smoke service token；Free 套餐无自定义 WAF），service token 只保存在 gitignored `.local/cf-access.env`；严格 CSP 会拦截 Web Analytics/Challenge 注入，需后台关闭自动注入或接受报错。
- 旧项目 PiForge 的残留（sudoers 注释、禁用的计划任务）保持原样，不继承、不清理。
- 公开仓库中的域名/IP/网段/备份路径均为示例/占位值；本机实际部署信息见 `.local/DEPLOYMENT.md`（gitignored，不提交）。

## 9. 用户手动步骤（Agent 不得代替）

1. Cloudflare 后台添加 `app`/`ai` CNAME（已由用户完成）。
2. 交互式运行 provisioning，设置密码、扫描 TOTP、保存恢复码。
3. 安装/重装 Windows 每日应用归档计划任务（`install-backup-task.ps1`，需管理员 PowerShell）；仓库更新后必须重装一次，刷新复制的 `backup-pull.ps1`、脚本 SHA 与安装标记。**当前现状（已完成，2026-11-08 v1.1.0）**：验收记录写每日备份与周度世界拉取已更新至 1.1.0，未另记 installedAt。异地副本任务未安装。主机与 backupRoot 未改。上一轮（2026-11-07 v1.0.13）appVersion=1.0.13、installedAt `2026-11-07T13:13:54.6451312Z`。再上一轮（2026-11-07 v1.0.12）appVersion=1.0.12、installedAt `2026-11-07T11:43:26.7121209Z`。更早一轮（2026-11-06 v1.0.9）appVersion=1.0.9、installedAt `2026-11-06T13:49:03Z`，演练 `20261106T135130Z` 为 schema 20。再上一轮（2026-11-05 v1.0.8）appVersion=1.0.8、installedAt `2026-11-05T07:16:49Z`，演练 `20261105T022152Z` 为 schema 20。
4. 离线保存 age 私钥（密钥包与备份整包加密各一套，互不复用）；把 `ALERT_WEBHOOK_URL` 写入 env 后重启应用。
5. Windows 周度世界拉取与每日任务一起由 `install-backup-task.ps1` 安装（需管理员 PowerShell）。任务名 `AntifieldCloud-World-Pull`（周日 12:00），`-File` 为 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，`BackupRoot` 与每日任务相同（本机 `D:\Backups`）。恢复演练仍按 `scripts/drill.ps1` 手动/季度执行（schema 期望值默认来自 `deploy/tool-versions.json`）；异地副本按用户决定保持关闭。
6. 应用新 nftables 规则前，确认当前 SSH 来源在允许网段内（模板为 TEST-NET 占位，先替换为实际网段，否则会锁死）；保留物理键鼠/已建立 SSH 作为回滚通道。
7. 备份整包加密启用（默认关闭）：离线生成独立 age 密钥 → Pi 写公钥（root、组/其他不可写）→ 用私钥完成一次 `age -d` 解密与 `drill.ps1 -AgeIdentityPath` 演练 → 设 `BACKUP_ARCHIVE_ENCRYPTION=true` 并重启 → 下一次 prepare 生成 `.age` → PC 拉取/ack → 再演练。回滚：关开关恢复明文，已生成 `.age` 保留（仅 PC 可解密）。
8. 异地副本启用（默认关闭）：PC 安装配置 rclone remote/凭据 → `install-backup-task.ps1 -InstallOffsiteTask -OffsiteRemote …` → 手跑一次确认状态 JSON 回写与 `plaintextSkipped=0` → 确认告警阈值 `ALERT_OFFSITE_MAX_AGE_HOURS`。
9. Cloudflare Access：已通过 API 配置主应用（One-time PIN + Owner allow + Service Auth）与 4 个 bypass；`ai` 主机另有 Access 应用（Owner allow + Smoke service token；Free 无自定义 WAF）。service token 存放在 PC `.local/cf-access.env`（gitignored）。Bot webhook bypass 已更新为 `/api/chatbot/webhook`（2026-10-28，旧路径不再使用）。轮换 service token 后同步该文件，并用 `smoke.ps1 -AccessClientId/-AccessClientSecret` 重跑；配置用高权限 API Token 完成后应 Revoke。
10. Bot 平台后台注册（QQ 官方 Bot，用户在 q.qq.com 完成，Agent 不代替）：创建机器人取得 AppID/AppSecret → 在 `/chatbots` 新建 QQ Bot 录入 → 回调地址填 `https://app.<domain>/api/chatbot/webhook/<botId>` 并处理 `op=13` 校验 → 订阅 `C2C_MESSAGE_CREATE`/`GROUP_AT_MESSAGE_CREATE`/`AT_MESSAGE_CREATE` → 登记目标 → 开启 `CHATBOT_ENABLED=true` 并重启。图片理解需 `CHATBOT_AI_ENABLED=true` 且模型支持 image。
11. 最终公网/手机/PWA 验收；完成正式恢复演练并记录到 `docs/app/BACKUP.md` §7 与 `docs/app/ACCEPTANCE.md`。
12. SSH 仅公钥的回滚窗口当前已关闭：旧备份归档到 `/var/backups/antifieldcloud/`（0600 root），活动配置未改；后续如再次变更仍按 `docs/app/DEPLOY.md` §9.7 保留 24h 回滚窗口。
13. v0.7.3 Bot 文档模式启用（默认关闭，生产已于 2026-10-27 启用）：读范围矩阵 7/7 通过（作用域内正向；作用域外/env/DB/其他作用域/shell/注入全部拒绝），真实 QQ 私聊首轮/后续与群聊首轮通过；生产 `CHATBOT_AI_CONTEXT_READ_ENABLED=true`。回滚设 `false` 重启，无需恢复 schema/DB。
14. OpenCode 2.2.0（2026-10-28 已升级并验收）：升级前备份 `/var/backups/opencode`（timestamp `20261028T020723Z`，binary/data/env/unit/MCP）；v2.2.0 的 breaking changes 仅涉及 `@opencode/ai` Promise API、GitHub Action 移除、TUI 插件 OpenTUI 0.7，应用使用原生 HTTP API + MCP，无需业务改动；兼容矩阵与回滚见 `docs/app/DEPLOY.md` §3.2。
15. mcbot 对接启用（v0.8.0 上线，v0.8.1 安全补丁；**已由 Lead 于 2026-10-27 完成升级、验收与发布**）：v0.8.0 生产上线 mcbot **v0.6.0**；v0.8.1 部署前升级到 **v0.6.1**（release `/opt/mcbot/releases/20261027T111640Z`/commit `a0a28da`，仅 loopback）→ root 执行 `scripts/sync-mcbot-tokens.sh`（`--check` read/control 均 match）→ 应用 0.8.1 部署并重启 → 生产 `/api/version`（v0.8.1、lofii 两开关 true）、`/api/mcbot/status`（enabled/reachable/control/eventsSupported=true，version 0.6.1/contract 1）、`/say` 240 填充 + `/op` 400 `message_must_not_start_with_slash`、`/say` C0 400 `invalid_request`、`meta.mcbot.event_cursor` 已更新均已验证；只读 `/say` 503 由单元/集成测试覆盖（生产控制 Token 已配置，未改配置实测）；UI 沿用 v0.8.0 视觉确认，v0.8.1 未重新截图。回滚设 `MCBOT_ENABLED=false` 重启；**v0.8.1 已发布：annotated Tag `v0.8.1` + GitHub Release [AntifieldComplexx v0.8.1：mcbot 安全补丁与稳定性修复](https://github.com/antifield26/AntifieldComplexx/releases/tag/v0.8.1)；v0.8.0 已发布 Tag+Release（Tag `v0.8.0`→commit `c5ec851`，publishedAt 2026-10-27T12:02:45Z）**；真实 mcbot 告警联动未触发（单元/集成覆盖）。
