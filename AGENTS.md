# AGENTS.md — AntifieldComplexx 工程约定（后续所有 Agent 会话必读）

## 0. 项目一句话

**项目定位：个人综合交互平台**——面向个人使用，以统一账号与单一入口整合个人数据/分享、Minecraft 与 mcbot、QQ chatbot、DeepSeek Harness AI 工作区，以及主机监控与备份灾备；`apps/workbench` 是 Web 端技术名。

**当前版本 v1.2.3**。schema 21，mcbot 契约 v2。Web、QQ 与 mcbot Agent 使用 DeepSeek Harness 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode **v2.2.5** 只作离线回滚运行时。运行中的 Workbench 是 `20261114T082631Z`。同 schema 回滚、跨 schema 快照和演练标识见 `docs/DEPLOY.md`。版本沿革见 `CHANGELOG.md` 与 `docs/ROADMAP.md`。

权威文档：
- `docs/PLAN.md`：当前范围与回滚
- `docs/API.md`：HTTP 契约，含 mcbot 本机契约
- `docs/UI-SPEC.md`：界面与交互
- `docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/DEPLOY.md`、`docs/BACKUP.md`、`docs/CHATBOT.md`、`docs/MCBOT.md`
- `docs/ROADMAP.md`：按日期排列的版本边界
- `docs/AUDIT.md`：当前残余与声明矩阵
- `docs/ACCEPTANCE.md`：当前验收状态
- `docs/BACKLOG.md`：未完成事项
- `docs/INDEX.md`：文档索引
- `deploy/tool-versions.json`：schema、OpenCode、mcbot 与 DSH 的期望版本

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
- 前端源码在 `apps/client`，由 Vite 构建；产物仍是 `apps/workbench/web/dist`。服务端只托管该产物，不参与前端编译。
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
npm run test:web       # Vitest + jsdom（apps/client/src/**/*.test.ts(x)）
npm run test:web:coverage # 前端测试 + 覆盖率门禁
npm run check          # app + mcbot + 命名门禁，提交前必须全绿
npm run check:mcbot    # mcbot typecheck + unit tests
npm run check:naming   # 旧标识符扫描（历史归档/迁移数据豁免）
npm run check:docs     # mcbot 文档声明/代码实现一致性检查
node scripts/check-version.mjs # 校验 package.json 与 README/CHANGELOG/ACCEPTANCE/AGENTS/env.example/DEPLOY、lock 根版本，并交叉校验 deploy/tool-versions.json ↔ db.ts ↔ 文档当前事实
```

测试边界：禁止依赖真实 Minecraft、真实 OpenCode、真实 network；Bot 适配器（QQ 官方 Bot、Chat、图片下载、分段/格式化/自检/诊断）、备份 tar/age、告警投递等只使用进程内假平台/夹具（不访问真实平台或模型）。Windows 上无法测试的 systemd 相关用例用 `t.skip` 并在 Linux 上跑；`scripts/test/` 覆盖世界备份、恢复演练与异地副本规划等纯函数/夹具，不触碰真实 Pi。真实 QQ/Cloudflare/模型负路径需部署后联调，不把 mock 全绿等同于线上通过。


## 4. 目录与模块边界

```text
apps/workbench/server/src/
  main.ts            进程入口：配置、DB、Fastify、信号退出、启动指标采样
  config.ts          环境变量解析与校验（非法值/不安全组合失败即退出）
  logger.ts          Fastify/pino 日志与脱敏
  db.ts              SQLite 打开、迁移（工作区 schema v21）、事务辅助
  auth/              scrypt、TOTP、会话、设备登记与请求签名、CSRF、限流、恢复码、审计（字段截断 + 失败诊断）、Bot 发布 TOTP 再认证
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
apps/client/         React 界面与 Tauri 壳（源码只依赖 docs/API.md；产物写到 apps/workbench/web/dist）
scripts/             provision/backup CLI、世界备份 backup-world.mjs、恢复演练 drill.ps1/drill-verify.mjs、
                     world-pull.ps1、backup-pull.ps1、backup-offsite.mjs/.ps1、部署/冒烟 PowerShell、
                     bootstrap-env.sh、backup-secrets.sh、sync-mcbot-tokens.sh（root 同步 mcbot Token）、
                     check-version.mjs、check-prod-deps.mjs
scripts/test/        运维脚本单元测试（node --test .test.mjs）
deploy/              systemd（应用/健康探针/世界备份 timer）、nftables 模板（TEST-NET 占位）、
                     cloudflared ingress、env 模板、host/ 主机配置模板、tool-versions.json
```

`apps/mcbot/src/autonomy/`：v1.1.0 起生产由 DSH 插件经私有 Unix socket 调用 13 个工具；配置该 socket 后 `/autonomy/mcp` 返回 404。v1.0.2 至 v1.0.13 的 OpenCode 原生 MCP 循环、环境快照、只读容器、进食/装备、事件驱动重决策、策略/预算/急停与审计仍在代码中，供回滚路径使用。世界记忆与聊天记忆分开，分类固定，提示词只带索引。

写作用域约定：服务端改动在 `apps/workbench/server/`，前端在 `apps/client/`，脚本/部署在 `scripts/`、`deploy/`，文档在 `docs/` 与根 README/AGENTS/CHANGELOG；跨域改动先在本文件或任务中说明。

## 5. 安全红线（不可违反）

1. 应用 API 不提供任意 Minecraft RCON 命令、启停、封禁、OP；仅白名单增删 + 只读状态。
   `scripts/backup-world.mjs` 是唯一例外：以 root 由 `antifieldcloud-world.timer` 调用，只执行固定的
   `save-off` / `save-all flush` / `save-on`（`save-on` 放在 finally），应用 API 不可触达该能力。
2. 文件访问只经 DB id，不接受客户端路径；文件内容不可变；禁止覆盖上传。
3. 所有非 GET `/api` 校验 CSRF；Cookie `HttpOnly + Secure + SameSite=Lax`（仅 loopback HTTP 例外）。已通过设备签名的 Bearer 请求不再要求 CSRF。`Authorization` 存在但不是合法 Bearer 时不回退 Cookie。
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
16. **AI 自主会话（v1.0.2 引入，v1.0.3 增强；代码默认关闭）**：仅主人显式启动；模型通过 DSH 插件经私有 Unix socket 调用 `start_task`/`stop_task`/`go_home`/`deposit`/`task_status`/`observe`/`inspect_chest`/`eat`/`equip`/`finish`/`memory_read`/`memory_write`/`memory_forget`，任务名受 `AUTONOMY_TASKS` 白名单约束；`observe` 只读环境（基础状态+半径内 allowlist 方块/容器），`inspect_chest` 仅扫描半径内、无 active/queue/pending 时短距寻路只读容器且不取物、不传送、不破块，`eat`/`equip` 仅空闲时对背包内食物/护甲/工具生效；任务生命周期与安全阈值事件驱动重决策（30s 去重、最多 6 次），无周期空转；会话使用随机 run_id + 短期 Bearer，配置 `DSH_AGENT_SOCKET` 后 `/autonomy/mcp` 返回 404。OpenCode 回滚路径的 session 必须 deny-all + `mcbot_autonomy_*` allow；预算/时间/连续失败/断线/手动指令/急停均需 fail-closed，结束必须停止任务并清理 session/MCP；不得把 `/autonomy/mcp` 暴露给应用/浏览器/公网，不得在日志/审计记录 prompt/Token/完整容器内容/世界记忆正文。v1.2.3 起，应用面板不再直接启动任务或自主会话；主人在 Minecraft Bot 页对话，模型按这句话决定是否调用上述 13 个工具，并可按需使用 DSH 的 goal 与 todo。游戏内口令仍可启动。急停不经过模型。不新增第 14 个 mcbot 工具名，不挂 goal-round-driver，不向模型开放 plugin-manager。世界记忆分类只有 place、resource、food、danger、route、note，文件为 dataDir 下的 world-memory.json（0600），与聊天记忆分开；提示词只带分类计数和最近 8 个键；记忆工具计入既有工具预算，不启动任务。
17. mcbot 对接（v0.8.0 引入，v0.8.1 安全加固）读/控制 Token 必须分离且只走 loopback：`MCBOT_URL` 非 loopback/非 http(s)/含 userinfo/路径/查询/片段拒绝启动，客户端禁止跟随重定向；Token 不得进入浏览器/bundle/API 响应/日志/审计正文。应用上的任务开始、目标写、自主开始、移动和游戏发言在会话与 CSRF 之后返回 409 `mcbot_control_via_chat`，不调用上游。管理员对话需要登录、CSRF 或已签名设备、控制 Token 和发言限流；允许 ASCII `/`，拒绝 C0；审计只记字符数，正文不进 SQLite。急停停止任务、自主会话和管理员会话，不调用模型。mcbot 本机 `/say` 仍拒绝任意 ASCII `/` 与 C0。在线模式切换保留。事件缓存 ≤100 条且 ≤512 KiB、响应体流式 ≤2 MiB；聊天/事件只存内存不落库；上游告警只能以 `status='event'` 记录，不得写入 `alert_state` 或伪装 firing/resolved。

## 6. 数据库与数据

- schema 迁移集中在 `server/src/db.ts` 的 `MIGRATIONS`，启动时按 `meta.schema_version` 顺序执行；迁移只追加，工作区 schema **v21**（v19 增加 `alert_events.dedupe_key`；v20 增加 `external_alert_deliveries`，记录独立 Webhook 和 QQ 入队状态；v21 增加 `devices`、`device_nonces` 与会话 `device_id`）。
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
- API 变更同步更新 `docs/API.md`；界面变更同步 `docs/UI-SPEC.md`。
- 无密钥/个人数据进入仓库；`.env` 与 `data/` 被忽略；公开文档不得写入真实域名/网段（用 `app.<domain>`/`ai.<domain>`/`mc.<domain>` 与 TEST-NET 占位）。
- 部署相关改动同步 `docs/DEPLOY.md` 并说明回滚；备份/灾备改动同步 `docs/BACKUP.md`。
- 提交信息使用 Conventional Commits（`feat:`/`fix:`/`docs:`/`test:`/`chore:`/`deploy:`）。
- 每个阶段结束给出「产出摘要 + 未决问题 + 验证证据」。

## 8. 已知环境事实（不要重复踩坑）

- **当前生产**：Workbench `/opt/antifieldcloud/releases/20261114T082631Z`，mcbot `/opt/mcbot/releases/20261114T043045Z`，DSH `/opt/antifield-dsh/releases/20261114T051442Z`（0.2.2-rc.3，QQ 插件 0.5.5）。插件列表代理已在该 Workbench 中放行 `/api/pluginManager/` 与 `/api/pluginInventory/`。切换后尚未观察到 `listBundles` 或 `listPlugins`。同 schema 回滚先把 Workbench 指回 `20261114T051811Z` 并只重启应用。再退与跨 schema 快照见 `docs/DEPLOY.md`。沿革见 CHANGELOG。
- mcbot 部署默认保留最新 3 个 release，并保护 current 与 previous。
- Pi：`antifield@192.0.2.10` 直连（TEST-NET 占位；实际值见 `.local/DEPLOYMENT.md`）；WiFi 示例 `198.51.100.10` 与 PC 不通（AP 隔离）；直连 SSH 偶发超时，脚本需重试。
- 校园网有 Portal 认证（占位 `https://portal.<domain>`；实际端点见 `.local`）；树莓派重启后认证可能失效，表现为 Cloudflare 7844 出站阻断、tunnel 1033/公网 530；需从 Pi 出口重新完成认证，再 `systemctl reset-failed cloudflared && systemctl restart cloudflared`。
- Pi 上 Node 为 `/usr/local/bin/node`（v26.13.0，2026-11-07，世界可执行；旧回滚二进制已删除，保留 `/usr/local/lib/nodejs/node-v26.13.0-linux-arm64`）；npm 指向 `/home/antifield/.nvm`（12.2.0），部署时以 root 使用。cloudflared 为 2026.10.7，旧回滚二进制已删除。
- OpenCode 2.2.5 已于 2026-11-08 22:40:40（UTC+8）从 Pi 退役，活动单元、二进制与环境配置已移除，4096 不再监听。回滚运行时仍是 2.2.5，使用 PC 上验证过的加密档。更早的 v2.2.0 备份 timestamp `20261104T062115Z` 只作历史回滚点，不是 2026-10-28 的 v2.1.4 备份。升级与回滚见 `docs/DEPLOY.md` §3.2。版本以运行中的 `/api/info` 为准。`opencode upgrade` 只替换磁盘二进制，必须再重启服务。
- Minecraft：Paper 26.1.2，RCON `127.0.0.1:25575`，密码在 `server.properties`（32 位随机），服务器语言中文，输出含 `§` 颜色码需剥离；RCON 仍监听所有接口，nftables 仅放行 loopback。插件为 Chunky 1.5.66、CoreProtect CE 24.1、EssentialsX 2.22.0、LuckPerms 5.5.91、PlaceholderAPI 2.12.3、VaultUnlocked 2.20.3、ViaVersion 5.12.2、Vote2Sleep 1.3.0。运行中的 Minecraft 单元于 2026-11-14 00:00:17 CST 进入 active。v1.2.3、v1.2.2、v1.2.1 与 v1.2.0 部署都没有重启 Minecraft。v1.1.1 验收当时记录的插件重启是 2026-11-07 22:14:58 CST。
- Pi 已启用 memory cgroup；`antifieldcloud-health.timer` 每 60s 写 `/run/antifieldcloud/pi-health.json`；`age` 与（启用异地副本时）`rclone` 已安装；`unattended-upgrades` 已安装。
- 备份：应用归档为两阶段 pending/ack（未确认不删）；PC 任务参数为实际 `-PiHost/-BackupRoot`，ACL 收紧；密钥包 Pi 端 `KEEP=2` 滚动保留，PC 不再立即删除远端密钥包。
- 备份整包加密（模板默认关闭；生产 v1.2.2 已开启）：`BACKUP_ARCHIVE_ENCRYPTION=false`、`BACKUP_AGE_RECIPIENT_FILE=/etc/antifieldcloud/backup-age.pub`（root 属主 0644、组/其他不可写、单行 `age1…`）、`BACKUP_OFFSITE_STATUS_FILE=/var/lib/antifieldcloud/backup-offsite-status.json`、`ALERT_OFFSITE_MAX_AGE_HOURS=48`；该密钥对独立于 `secrets-age`，私钥离线 ≥2 份，禁止放 Pi。
- 加密归档命名 `snapshot-<stamp>[-n]-(full|inc).tar.gz.age`，外部 sidecar `<name>.meta.json`（schema 2：plainSha256/plainSize/cipherSha256/cipherSize/recipient/…），`.sha256` 始终表示密文 SHA-256；临时明文 `*.plain.tmp` 崩溃后由下次 prepare 清理 >24h 残留。
- 异地副本（模板默认关闭；生产已启用 Google Drive，每日 13:00）：`scripts/backup-offsite.mjs` + `.ps1` 由 `install-backup-task.ps1 -InstallOffsiteTask` 安装为 `AntifieldCloud-Backup-Offsite`（默认每日 13:00、6h 超时、IgnoreNew）；新环境需先配置 rclone remote/凭据；只上传 `.age`，链感知保留（最新 full + 其后全部 inc + 最近 N 天）。
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
- mcbot 环境变量（v0.8.0 引入，v0.8.1 加固；默认关闭）：`MCBOT_ENABLED=false`、`MCBOT_URL=http://127.0.0.1:3010`（启用时必须 loopback + http(s) 且仅根地址，拒绝 userinfo/路径/查询/片段）、`MCBOT_READ_TOKEN=`、`MCBOT_CONTROL_TOKEN=`（root 执行 `scripts/sync-mcbot-tokens.sh` 从 `/etc/mcbot/env` 的 `HTTP_TOKEN`/`HTTP_CONTROL_TOKEN` 同步，`--check` 只比较；同目录临时文件 + `mv` 原子替换；控制为空 = 只读，`/say` 也 503）、`MCBOT_TIMEOUT_MS=2500`（500–10000）、`MCBOT_POLL_MS=5000`（2000–60000）、`MCBOT_ALERTS_ENABLED=true`；上述键均纳入 `bootstrap-env.sh` MANAGED_KEYS。mcbot **v1.2.3**（最低 v0.6.0，契约 v2，发言使用控制 Token；Workbench 兼容契约 v1 的读取与既有控制。独立 systemd 服务，仅 `127.0.0.1:3010`，不经 Cloudflare/nftables 对外；v0.6.1 逐行中和行首 `/`）；`smoke.ps1 -ExpectedMcbotVersion 1.2.3 -ExpectedMcbotContractVersion 2`（最低兼容 0.6.0）校验服务 active + `/healthz.version` 与契约版本，未启用用 `-SkipMcbot`。生产进程为 v1.2.3（`/opt/mcbot/releases/20261114T043045Z`）。回滚指针见 `docs/DEPLOY.md`。`PATH_*` 九键是 `PATH_PLANNER_ENABLED`、`PATH_PLANNER_MAX_NODES`、`PATH_PLANNER_TIMEOUT_MS`、`PATH_MAX_REPLANS`、`PATH_TELEPORT_FALLBACK`、`PATH_OUTSIDE_SAFE_RADIUS`、`PATH_AI_ENABLED`、`PATH_AI_TIMEOUT_MS`、`PATH_AI_COOLDOWN_MS`。
- v1.0.2/v1.0.3 AI 自主环境变量（默认关闭）：`AUTONOMY_ENABLED=false`、`AUTONOMY_MAX_MINUTES=20`、`AUTONOMY_MAX_TOOL_CALLS=12`、`AUTONOMY_MAX_FAILURES=2`、`AUTONOMY_GOAL_MAX_CHARS=200`、`AUTONOMY_DECISION_TIMEOUT_MS=180000`、`AUTONOMY_MCP_WARMUP_MS=3000`、`AUTONOMY_SCAN_RADIUS=16`、`AUTONOMY_SCAN_MAX_BLOCKS=48`、`AUTONOMY_SCAN_BLOCKS=chest,trapped_chest,barrel,ender_chest,*_bed,water,crafting_table,furnace,blast_furnace,smoker,wheat,carrots,potatoes,beetroots,*_log,*_ore`、`AUTONOMY_CHEST_READ_ENABLED=true`、`AUTONOMY_CHEST_PATH_TIMEOUT_MS=12000`、`AUTONOMY_EAT_BELOW=18`、`AUTONOMY_ACTION_COOLDOWN_MS=5000`、`AUTONOMY_EVENT_DEBOUNCE_MS=30000`、`AUTONOMY_MAX_REPROMPTS=6`、`AUTONOMY_TASKS=fishing,farming,woodcutting,mining,forest,sleep,patrol,guard,escort,explore,clearing`；生产进程为 v1.2.3，自主工具由 DSH 插件经私有 Unix socket 调用，仍仅主人显式启动（代码默认仍为 false）。v1.0.7 把寻路兜底送进既有重决策（30 秒去重、每会话最多 6 次），不新增工具。`PATH_AI_ENABLED=false` 可单独关闭寻路 AI。OpenCode 寻路建议只属于已退役的回滚路径。
- 备份/灾备 env：`BACKUP_IMPORT_RETENTION_DAYS=90`（0=永久）、`ALERT_REPEAT_HOURS=24`（0=关闭；兼容键 `ALERT_COOLDOWN_MINUTES` 仍可解析）。
- Bot 公开入口：`POST /api/chatbot/webhook/:botId`（无 session/CSRF，按平台签名鉴权）；Cloudflare Access 必须对 `/api/chatbot/webhook/*`、`/healthz`、`/s/*`、`/api/public/shares/*` 做 bypass，否则平台回调/健康检查/公开分享会被边缘拦截。原生客户端还要求 `/api` 到达应用，页面保持 Access。`CHATBOT_ENABLED=false` 时该路径返回 404。
- Bot 平台注册（QQ 开放平台）与 Cloudflare Access 策略均由用户在各自后台完成，Agent 不代替；仅 QQ 官方 Bot。
- 测试证据边界：平台适配/Chat/记忆/图片/自检/诊断/备份 tar/告警投递以进程内 mock/夹具为主，未做真实 QQ 平台限流/签名漂移/故障负路径；真实 QQ 消息验收记录见 `docs/ACCEPTANCE.md`。
- Windows 世界拉取（`scripts/world-pull.ps1`，周度）任务名 `AntifieldCloud-World-Pull`（周日 12:00）。`install-backup-task.ps1` 把脚本复制到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1` 再注册，`-File` 指向该副本。`-BackupRoot` 与每日任务相同（本机 `备份根（见 .local）`，世界归档在 `world\`）。任务名与 `%LOCALAPPDATA%\AntifieldCloud` 不改。恢复演练（`scripts/drill.ps1`）保持手动/季度。当前标记为 1.2.3，installedAt `2026-11-14T05:26:19.1249844Z`。异地副本任务已安装，每日 13:00。更早的安装标记见 CHANGELOG。
- Cloudflare：zone 使用占位 `example.com`；tunnel 名称 `pi`；`mc.<domain>` CNAME 到 SakuraFRP，**不要改**；`app/ai` 的 DNS 由用户手动添加；Access 主应用保护页面，`/api` 到达应用，健康检查、分享与 Webhook bypass 以及 service token 已在生产配置（见 `docs/DEPLOY.md` §5.2），`ai` 主机另有 Access 应用（Owner allow + Smoke service token；Free 套餐无自定义 WAF），service token 只保存在 gitignored `.local/cf-access.env`；严格 CSP 会拦截 Web Analytics/Challenge 注入，需后台关闭自动注入或接受报错。
- 旧项目 PiForge 的残留（sudoers 注释、禁用的计划任务）保持原样，不继承、不清理。
- 公开仓库中的域名/IP/网段/备份路径均为示例/占位值；本机实际部署信息见 `.local/DEPLOYMENT.md`（gitignored，不提交）。

## 9. 用户手动步骤（Agent 不得代替）

1. Cloudflare 后台添加 `app`/`ai` CNAME（已由用户完成）。
2. 交互式运行 provisioning，设置密码、扫描 TOTP、保存恢复码。
3. 安装/重装 Windows 每日应用归档计划任务（`install-backup-task.ps1`，需管理员 PowerShell）；仓库更新后必须重装一次，刷新复制的 `backup-pull.ps1`、脚本 SHA 与安装标记。当前安装标记为 1.2.3，installedAt `2026-11-14T05:26:19.1249844Z`。异地副本任务已安装，每日 13:00。更早的安装标记见 CHANGELOG。
4. 离线保存 age 私钥（密钥包与备份整包加密各一套，互不复用）；把 `ALERT_WEBHOOK_URL` 写入 env 后重启应用。
5. Windows 周度世界拉取与每日任务一起由 `install-backup-task.ps1` 安装（需管理员 PowerShell）。任务名 `AntifieldCloud-World-Pull`（周日 12:00），`-File` 为 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，`BackupRoot` 与每日任务相同（本机 `备份根（见 .local）`）。恢复演练仍按 `scripts/drill.ps1` 手动/季度执行（schema 期望值默认来自 `deploy/tool-versions.json`）。异地副本已安装为每日 13:00，只上传 `.age`。
6. 应用新 nftables 规则前，确认当前 SSH 来源在允许网段内（模板为 TEST-NET 占位，先替换为实际网段，否则会锁死）；保留物理键鼠/已建立 SSH 作为回滚通道。
7. 备份整包加密（模板默认关闭；生产 v1.2.2 已开启）：离线生成独立 age 密钥 → Pi 写公钥（root、组/其他不可写）→ 用私钥完成一次 `age -d` 解密与 `drill.ps1 -AgeIdentityPath` 演练 → 设 `BACKUP_ARCHIVE_ENCRYPTION=true` 并重启 → 下一次 prepare 生成 `.age` → PC 拉取/ack → 再演练。回滚：关开关恢复明文，已生成 `.age` 保留（仅 PC 可解密）。
8. 异地副本（模板默认关闭；生产已启用 Google Drive，每日 13:00）：PC 安装配置 rclone remote/凭据 → `install-backup-task.ps1 -InstallOffsiteTask -OffsiteRemote …` → 手跑一次确认状态 JSON 回写与 `plaintextSkipped=0` → 确认告警阈值 `ALERT_OFFSITE_MAX_AGE_HOURS`。
9. Cloudflare Access：已通过 API 配置主应用（One-time PIN + Owner allow + Service Auth）与健康检查、分享、Webhook bypass；`ai` 主机另有 Access 应用（Owner allow + Smoke service token；Free 无自定义 WAF）。2026-11-11 用户在控制台放行应用 `/api`，页面仍经 Access。service token 存放在 PC `.local/cf-access.env`（gitignored），不进入安装包。Bot webhook bypass 已更新为 `/api/chatbot/webhook`（2026-10-28，旧路径不再使用）。轮换 service token 后同步该文件，并用 `smoke.ps1 -AccessClientId/-AccessClientSecret` 重跑；配置用高权限 API Token 完成后应 Revoke。退回 v1.1.1 时恢复当时的 Access 策略。
10. Bot 平台后台注册（QQ 官方 Bot，用户在 q.qq.com 完成，Agent 不代替）：创建机器人取得 AppID/AppSecret → 在 `/chatbots` 新建 QQ Bot 录入 → 回调地址填 `https://app.<domain>/api/chatbot/webhook/<botId>` 并处理 `op=13` 校验 → 订阅 `C2C_MESSAGE_CREATE`/`GROUP_AT_MESSAGE_CREATE`/`AT_MESSAGE_CREATE` → 登记目标 → 开启 `CHATBOT_ENABLED=true` 并重启。图片理解需 `CHATBOT_AI_ENABLED=true` 且模型支持 image。
11. 公网、手机与恢复演练按 `docs/BACKUP.md` 与 `docs/ACCEPTANCE.md` 核对现行状态。
12. SSH 只允许公钥。活动配置保持不变。再次变更时按 `docs/DEPLOY.md` 保留回滚窗口。
13. QQ 文档模式属于已退役的 OpenCode 回滚路径。生产 QQ 由 DSH 管理。
14. 需要恢复 OpenCode 时，使用 PC 上验证过的 2.2.5 离线档，并按 `docs/DEPLOY.md` §3.2 核对运行中的进程。
15. mcbot 只监听 loopback。Token 由 `scripts/sync-mcbot-tokens.sh` 同步。关闭对接时设 `MCBOT_ENABLED=false` 并重启应用。
