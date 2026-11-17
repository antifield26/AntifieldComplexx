# 架构

项目是个人综合交互平台。`apps/workbench` 是 Web 端技术名。`apps/client` 是 Windows 与 Android 共用的 Tauri 界面，产物写入 `apps/workbench/web/dist`。`apps/mcbot` 保持独立进程。

## 1. 总览

```text
Internet
 ├─ app.<domain> ─┐
 ├─ ai.<domain>  ─┼─ Cloudflare Edge ── cloudflared ── 127.0.0.1:3000
 └─ mc.<domain> ──── SakuraFRP（现状保留，不走应用）

Raspberry Pi 5
 ├─ antifieldcloud.service（127.0.0.1:3000；schema v22）
 │   ├─ app 主机：React 与 /api
 │   ├─ ai 主机：会话校验后反代 DSH Web（127.0.0.1:3080），HTML 原样转发
 │   └─ mcbot 对接：127.0.0.1:3010，契约只接受 v2。只轮询只读接口，并代理对话、在线模式和急停
 ├─ antifield-dsh-web / qq / mcbot-agent（0.2.2-rc.3，QQ 插件 0.5.5）
 ├─ mcbot.service（仅 loopback）
 ├─ minecraft.service / cloudflared.service
 ├─ antifieldcloud-world.timer（周日 12:00）
 ├─ antifieldcloud-health.timer（60 秒）
 └─ nftables：默认拒绝；22 与 25565 限网段；25575 仅 loopback
```

SQLite 在 `/var/lib/antifieldcloud/db.sqlite`。文件在 `files/<id 前两位>/<id>`。mcbot 的聊天和事件只留在内存。
## 2. 进程与请求路径

- 单 Node 进程；Fastify 监听 `127.0.0.1:3000`。`main.ts` 在 listen 后启动告警评估与指标采样器，并依次 `context.alerts.start()` → `startMetrics()` → `startmcbot()`；mcbot 未启用时为空操作、无定时器/网络请求。关闭时 mcbot 客户端先于 `app.close()` 停止，`onClose` 也会再次调用（幂等）。
- `onRequest` 先按 `Host` 分流：
  - `ai.<域名>`：校验应用会话与 `Origin`，经 Workbench 单点登录进入 loopback 上的 DSH Web。未登录 HTML 302 到登录页，API 与 WebSocket 返回 401，非法 Origin 返回 403 并审计。
  - `app.<域名>` 或 loopback：进入应用路由；附加上下文（不强制登录）。
  - 其它 Host：404。
- 应用路由：`/healthz` 公开（返回 `version`，生产由 `APP_VERSION` 注入）；`/api/*` 需要会话（登录/健康检查除外）；写操作额外校验 CSRF。
- 静态资源：Vite 产物 `web/dist`，由 `@fastify/static` 提供；未匹配的 HTML 路径回退 `index.html`。
- WebSocket upgrade：`server.on('upgrade')` 只接受 ai 主机 + 有效会话 + 合法 Origin，再转交 `http-proxy`。
- 指标采样：`metrics/sampler.ts` 每 `METRICS_SAMPLE_SECONDS`（默认 60）读取 HostMonitor 与配额用量写入 `metrics_samples`；维护任务按 `METRICS_RETENTION_DAYS`（默认 30）清理。
- 公开分享：`/api/public/shares/:token/*` 不挂会话，但 POST 校验 Origin、按 IP/用户限流；内容支持 Range/HEAD/ETag，多文件走 `items/:itemId/content`。

### 2.1 QQ

生产 QQ 由 DSH 管理。Workbench 不再接收 Webhook，也不再保存 QQ 凭据、队列或 OpenCode Chat。schema 22 删除旧 QQ 表。告警只走 webhook。

### 2.2 mcbot 请求与轮询路径（v0.8.0 引入，v0.8.1 安全加固；默认关闭）

- 组件：`server/src/mcbot/client.ts`（HTTP 客户端）、`server/src/mcbot/service.ts`（轮询/缓存/游标/告警映射/控制代理）、`server/src/http/routes/mcbot.ts`（HTTP 路由）；`app.ts` 构造 `McbotService` 并挂到 `AppContext.mcbot`，`main.ts` 在 listen 后启动轮询、退出时 `stop()`（`onClose` 同样 stop，幂等）。
- 上游：独立附属服务 mcbot，本版 **v1.2.4**（生产进程 `/opt/mcbot/releases/20261116T135658Z`），仅 `127.0.0.1:3010`，契约只接受 `contractVersion=2`；v0.6.1 起 `splitOutgoing` 逐行把行首 `/` 中和为全角 `／`（防御纵深）；应用是纯 HTTP 客户端，不消费 SSE、不访问其 RCON/DSH 凭据/记忆数据。同一 `bootId` 的事件序号空洞写入 meta `mcbot.event_gap`，快照字段为 `eventGap`。生产自主工具由 DSH 插件经私有 Unix socket 调用。管理员对话另挂 DSH goal 与 todo，不增加 mcbot 工具名。
- 轮询：`setInterval(MCBOT_POLL_MS 默认 5000)` + 启动立即一轮；单飞 `inFlight` Promise，上一轮未结束复用同一 Promise（不并发/不堆积）；每轮 `Promise.allSettled([GET /status, GET /events/recent?limit=200])`（覆盖一次突发）。成功后更新 `statusSnapshot/version/contractVersion/lastPollAt/lastSuccessAt/failedPolls`；失败只更新 `reachable/stale/error` 并保留旧快照。`stale`：未连通且（从未成功时连续 3 轮失败，或距上次成功 > 3×轮询间隔）。`reachable=true` 但 `/events/recent` 或游标失败时 `error≠null`，前端必须展示可见警告。
- 客户端安全/边界：读 Token 用于 `/status`、`/events/recent`、`/admin/chat`；控制 Token 用于在线模式、停止、急停和管理员对话；`MCBOT_URL` 启动校验 loopback + http(s) 且仅根地址（拒绝 userinfo/路径/查询/片段）；`redirect:'error'`、`AbortSignal.timeout(MCBOT_TIMEOUT_MS 默认 2500)`、响应体**流式** ≤2 MiB（`readCappedBody` 边读边计数，Content-Length 超限直接拒绝）；错误统一 `mcbotError(code/statusCode/upstreamCode)`，message 大小写不敏感地移除上游 URL 与两枚 Token；上游 4xx 稳定码归一化为 `mcbot_<code>`，401/403 → `mcbot_auth_failed`，5xx 的 `task_disabled`/`control_disabled` 保留稳定码，其它 5xx/非 JSON → `mcbot_upstream_error`，网络/超时/重定向 → `mcbot_unavailable`。契约不是 v2 时读取拒绝。
- 事件缓存：合并 `/events/recent` 与现有缓存，按 `id` 去重、按时间 newest-first、最多 `MCBOT_EVENT_CACHE_LIMIT=100` 条且序列化总字节 ≤`MCBOT_EVENT_CACHE_MAX_BYTES=512 KiB`；只存内存，不落库/不写日志（聊天事件正文也只存在这里）。
- 告警游标：`meta.mcbot.event_cursor={bootId,lastEventId,lastTs}`（v1.0.0 迁移把旧键 `lofii.event_cursor` 改名）；每轮 `advanceCursor`：`eventsSupported=false` 直接返回；首次/无游标/`bootId` 变化 → 只写基线、返回 0（不重放 ring 旧告警）；否则 `eventsAfterCursor`（优先按 ring 位置，窗口外按 `<bootId>-<seq>` 序号或时间比较，无法判断宁可不重复）过滤 `type='alert'` 的事件 → `mapLofiiAlert`（own-property 已知 5 类映射 event/severity/title，未知 → `mcbot_alert`，`severity==='error'` → critical，details 为 `source:"mcbot"` / `mcbotEventId` / `mcbotType`）→ `AlertService.recordExternal`；`MCBOT_ALERTS_ENABLED=false` 仍推进游标不写告警；**告警写入失败时游标停在上一条已完整处理事件并返回，下一轮重试失败事件**（v0.8.1，避免静默丢告警）；游标写库失败只 warn 并置本轮 `error=mcbot_cursor_failed`，不回滚缓存。
- 告警落库：`AlertService.recordExternal(status='event')` 写 `alert_events`（event 截断 64、title 200、message 1000、details 清洗），不写 `alert_state`，并在同一事务写入 webhook 投递任务。主机条件的 firing、resolved、unknown 同样只写 webhook。`ALERTS_ENABLED=false` 时不写库、不投递。
- 控制代理：对话、急停、在线模式、停止任务和停止自主会话使用控制 Token，成功后 `refresh()`。应用不再提供任务开始、目标读写、自主开始、移动、游戏发言或历史代理。控制 Token 为空时，仍开放的控制方法抛 `mcbot_control_disabled`。
- HTTP 路由：全部 `requireAuth`；写操作加 `csrfGuard`。控制 limiter 20/min/IP，管理员对话用 say limiter 10/min/IP。对话允许 ASCII `/`，拒绝 C0。审计 `mcbot.chat` 只记字符数，不记正文或步骤。`GET /api/mcbot/status` 返回聚合快照（禁用时 `enabled:false` 空壳）。`GET /api/mcbot/chat` 返回内存中的消息、回合和步骤。
- 前端：`/minecraft` 由 `meta.mcbotEnabled` 决定是否显示「Minecraft Bot」标签（深链 `?tab=mcbot` 或 `#mcbot`）；`McbotPanel` 每 5s 轮询 `/api/mcbot/status`（页面隐藏时暂停，请求序号 + AbortController 防旧响应覆盖），状态经 `safemcbotStatus` 归一化、缺失段显示“—”。对话在进行中每 1 秒轮询。浏览器不接触 Token/上游地址。

## 3. 模块

| 模块 | 职责 |
|---|---|
| `server/src/config.ts` | 读取 env 文件/环境变量、数值与安全组合校验 |
| `server/src/db.ts` | SQLite 打开、PRAGMA、版本化迁移（schema **v22**）、事务。v22 删除旧 QQ 表，外部告警通道只保留 webhook。v21 增加 `devices`、`device_nonces` 与会话 `device_id`。迁移只追加 |
| `auth/` | scrypt、TOTP、恢复码、挑战、会话、设备登记与 Ed25519 请求签名、CSRF、限流、审计（字段截断 + 失败诊断 `getAuditDiagnostics`） |
| `files/` | 目录树、上传落库、配额、搜索、回收站、文本预览、MIME 安全分类、`origin` 可见性、物理孤儿回收 |
| `uploads/` | 分片上传会话/块索引、配额预留、断点状态、原子拼接、过期/终态清理 |
| `mc/` | SLP 查询、RCON 客户端、状态/metrics、白名单增删与复核 |
| `opencode/` | ai 主机认证反代；HTTP/WS Origin 校验（loopback 例外要求 Host 也是 loopback）；AI 主机未认证限流与审计去重；HTML 原样转发 |
| `backups/` | 归档导入/校验、full+inc 链解析、文件级恢复计划与执行、`skippedMissing`、加密归档 Web 409 边界、陈旧恢复锁清理、世界/拉取/演练/异地状态只读 |
| `dashboard/` | 主机指标、服务状态、opencode 健康、备份/加密/世界/演练/异地状态、活动聚合、`/api/storage` 轻量用量 |
| `metrics/` | 采样器（60s）、范围聚合查询（1h/6h/24h/7d/30d，最多 240 点）、保留期清理 |
| `notes/` | 笔记/书签、标签、置顶、FTS5 搜索；附件（`origin=note`）与版本历史 |
| `shares/` | 单文件/多文件分享 token/密码/过期/原子次数/吊销、公开元数据与逐项内容 |
| `alerts/` | 阈值评估、状态去重/恢复、webhook；世界备份/拉取/演练超期与异地副本超期；`recordExternal`（mcbot 等外部事件 `status='event'`，不写 `alert_state`，只投 webhook） |
| `mcbot/` | v0.8.0 引入、v0.8.1 加固的 mcbot Minecraft Bot 对接（仅 loopback）：`client.ts`（读/控制 Token、redirect:error、超时、流式 2 MiB 上限、稳定错误映射、大小写不敏感 URL/Token 脱敏）、`service.ts`（单飞轮询 status/recent?limit=200、快照与 100 条且 ≤512 KiB 事件内存缓存、stale、告警游标 `meta.mcbot.event_cursor`、alert→`status='event'` 映射、告警写失败停游标重试、控制代理成功后刷新）；不持久化聊天/事件，不改 schema |
| `http/` | 路由、守卫、错误处理、安全头、Host 分流、静态资源、`requestMeta` 统一信任模型；`mcbot.ts` 只读/控制路由 |
| `cli/` | provisioning、两阶段备份 CLI（prepare/pending/ack/snapshot-db）、backup-encryption.ts（age 加密/公钥校验/sidecar/孤儿正则） |
| `util/` | 时间/路径/响应/错误；`status.ts` 只读状态文件解析 |
| `web/` | React SPA（登录、Dashboard、文件、回收站、知识库、分享、MC + mcbot 三块面板、活动、设置、公开分享页）。不提供 PWA 安装或离线壳 |

脚本与部署侧：`scripts/backup-world.mjs`（root 世界一致性备份）、`scripts/world-pull.ps1`（Windows 周度拉取/ack）、
`scripts/drill.ps1` + `scripts/drill-verify.mjs`（恢复演练）、`scripts/check-version.mjs`（版本一致性）；
`deploy/` 提供应用/健康探针/世界备份 systemd unit、nftables 与 env 模板。

## 4. 数据模型

SQLite（WAL）核心表（schema v22）：

- `users`：单管理员；scrypt 哈希 + salt；TOTP secret；`totp_last_step` 防重放；恢复码哈希 JSON。
- `auth_challenges`：密码通过后的 5 分钟一次性挑战（只存 token 哈希）。
- `sessions`：会话 token 哈希、CSRF 哈希、7 天过期、IP/UA、last_seen。浏览器会话的 `device_id` 为空；客户端会话指向 `devices.id`。
- `devices`：同一账号的 Windows / Android 客户端。保存显示名、平台、Ed25519 公钥、应用版本、最近心跳与吊销时间。公钥唯一。吊销后保留行，阻止同一密钥再次登记。同一账号最多 10 台未吊销设备。
- `device_nonces`：设备 id 与 nonce 联合主键，保存过期时间。签名校验通过后写入；重复写入视为重放。过期行在下一次写入前清理。
- `files`：`id / parent_id / name / kind(file|dir) / size / mime / sha256 / storage_key / created_at / updated_at / deleted_at / deleted_parent_id / origin`；`origin ∈ user|note|system`，唯一索引为 `(COALESCE(parent_id,''), name COLLATE NOCASE, origin) WHERE deleted_at IS NULL`；`files(id)` 自引用。
- `audit_log`：动作、目标、IP；保留 90 天；写入时 actor≤64、target≤256、detail≤4 KiB。
- `login_attempts`：登录成功/失败记录。
- `backup_state`：最近一次 PC 已确认的备份时间/归档/哈希/大小。
- `backup_archives`：pending/acked/imported 归档；`origin` 区分 `pi`/`import`，含 `verified_at/manifest_json/last_error`；`meta.backup_missing_files` 记录待补入的缺失文件 id。
- `restore_plans`：文件级恢复计划（归档链、选择、目标名、状态、操作者、过期）。
- `upload_sessions` / `upload_chunks`：分片会话（大小/块数/已收/状态/过期/操作者）与块索引；临时块只在 `tmp/chunks/<uploadId>/`。
- `notes`、`bookmarks`、`tags`、`note_tags`、`bookmark_tags`、`notes_fts`、`bookmarks_fts`。
- `note_attachments`：笔记 ↔ 附件文件（`file_id` 指向 `files` 且 `origin='note'`）；删除笔记/附件硬删文件并释放配额。
- `note_versions`：标题/正文/标签快照 + 操作者 + 时间；每笔记保留最近 `NOTE_VERSIONS_KEEP`（20）。
- `shares`、`share_items`、`share_sessions`：分享 token 哈希、密码、过期/次数；`share_items` 保存多文件条目（旧行为回退到 `shares.file_id`）；解锁会话。
- `alert_events`、`alert_state`：告警历史/去重冷却；`alert_events` 保留 90 天。`external_alert_deliveries` 主键是 `event_id`+`channel`，通道只允许 webhook，状态 pending/done/dead/skipped。重启后补投未完成的 webhook；历史事件不补发。
- `metrics_samples`：60s 主机指标样本（`ts/ts_epoch/cpu/mem/temp/disk/load`），按 `ts_epoch` 索引，30 天保留。
- `audit_write_failures` 保存审计失败诊断。`alert_events.dedupe_key` 可空并有部分唯一索引。
- schema 22 删除旧 QQ 表：`chatbot_chat_roles`、`chatbot_group_roles`、`chatbot_memory_items`、`chatbot_memory_state`、`chatbot_inbound_targets`、`chatbot_ai_memories`、`chatbot_ai_sessions`、`chatbot_events`、`chatbot_publish_jobs`、`chatbot_deliveries`、`chatbot_targets`、`chatbots`。生产 QQ 由 DSH 保管凭据和会话。
- mcbot 对接不新增表/列：告警游标写入既有 `meta` 表的 `mcbot.event_cursor` 键（JSON `{bootId,lastEventId,lastTs}`；v1.0.0 迁移自 `lofii.event_cursor`）；mcbot 事件、聊天和 DSH 步骤只在内存，不落库；mcbot 告警事件复用 `alert_events`（`status='event'`），不写 `alert_state`。schema v19 起这些事件带可空 `dedupe_key`。外部告警投递只写 webhook。

世界备份/拉取/演练状态不在 SQLite：由 root/PC 脚本写 `/var/lib/antifieldcloud/{world-backup,world-pull,drill}-status.json`（0644，应用只读解析）。

关键约束：
- 文件内容是**不可变**的：上传后不再改写；重命名/移动只更新元数据。增量备份因此只需新增文件。
- 配额 = 所有 `kind='file'` 的 `size` 之和（含回收站与笔记附件），上限 10 GiB；上传先在 `tmp/` 写完并校验，再原子 rename。
- 同一父目录下同一 `origin` 名称唯一（大小写不敏感），冲突自动追加 ` (n)`；笔记附件与普通文件可同名。
- 删除目录递归软删除；恢复时若原父目录不在则回到根目录；`origin='note'` 行不进入回收站/用户目录树。

## 5. 认证流程

1. `POST /api/auth/password`：限流 → scrypt 校验 → 生成 5 分钟挑战（DB 存哈希）→ 返回 challenge；用户名超过 64 字符直接 400。
2. `POST /api/auth/totp`：校验 TOTP（±1 步，且 step > 上次使用）或恢复码 → 创建会话与 CSRF token → 在 app 主机设 Cookie。请求带合法 `device` 时，在同一事务里登记或复用设备，并把 `device_id` 写入会话；响应额外返回会话原文。浏览器登录不返回会话原文。
3. 会话 Cookie：app 主机 host-only `af_session`（HttpOnly）+ `af_csrf`（可读），HTTPS 下 `Secure; SameSite=Lax`，不设 `Domain`；loopback HTTP 例外。AI 主机通过 app 签发的 60s 一次性 ticket（`GET /api/auth/ai-ticket` → `GET /__af/sso/<ticket>`）获得自己的 host-only `af_session`，不共享父域 Cookie；登录/退出响应会清理旧父域 Cookie。
4. 写操作：`X-CSRF-Token` 与 DB 内 CSRF 哈希比对；若带 Origin，还必须在 app/loopback 白名单（ai 源不再作为 app 写请求受信 Origin）。`Authorization: Bearer` 必须同时通过设备签名；通过后不再要求 CSRF。认证头形状不合法时不回退 Cookie。
5. 改密/重置 TOTP 使其它会话失效；恢复码一次性；再认证要求“当前密码 + TOTP”。
6. 限流：每 IP 5 次失败/15 分钟、全局 60 次/小时（loopback 不占全局桶）、TOTP 全局 120 次/小时；再认证独立限流并恒定延迟。
7. 信任模型：`trustProxy:false`；仅 socket 为 loopback 时采信 `CF-Connecting-IP`/`X-Forwarded-Proto`，
   Host 只取原始 Host；`X-Forwarded-Host` 不参与安全判断。
8. 审计：所有登录/关键操作写 `audit_log`，字段截断；不记录密码/TOTP/Cookie/Authorization。

## 6. 云盘数据流

- 上传：小于 100 MiB 走浏览器 XHR（进度）→ multipart → 逐文件流式写入 `tmp/`，同时计算 SHA-256、累计大小、检查配额 → 物理文件先原子落盘 → 事务内再次校验配额并插入行；DB 失败回滚物理文件（避免不可见占用）。
- 大文件：浏览器按 8 MiB `PUT /api/uploads/:id/chunks/:idx`（可乱序/重试）→ 服务端写 `tmp/chunks` 并记录块哈希 → `complete` 顺序拼接、校验 SHA 后调用同一 `FileService.registerUpload` 原子落库；24h 会话过期/取消清理临时块并释放预留。
- 列表/搜索/面包屑/回收站：只查询 `origin='user'`；搜索 `LIKE ... ESCAPE` 限 100 条。
- 预览：图片/PDF/白名单音视频通过 `/content?inline=1`（支持 Range、ETag；不转码）；文本/Markdown 通过 `/text` 返回 JSON（≤1 MiB）；SVG/HTML/XML 强制附件；mkv/avi 等回退下载。
- 笔记附件：`registerUpload(origin='note', parentId=null)` 计入配额但父目录为空；仅笔记接口列出/删除，内容经同一鉴权内容路由访问；维护任务清理无关联孤儿附件。
- 回收站：递归软删除；列表只显示顶层项；恢复递归；彻底删除删除物理文件并释放配额。

## 7. Minecraft

- 状态：SLP（协议 775）拿版本/MOTD/在线数/样例玩家；RCON `list`/`tps`/`whitelist list` 补齐在线名/TPS/白名单数。
- 白名单：校验 `^[A-Za-z0-9_]{3,16}$` → 执行 `whitelist add|remove` → 重新查询确认 → 审计；不提供任意命令/启停。
- 降级：SLP 失败显示离线；RCON 失败时 TPS/白名单为 null，并在 `error` 字段说明；不影响文件功能。
- 世界备份：`scripts/backup-world.mjs` 以 root 由 `antifieldcloud-world.timer` 调用，只通过 RCON 执行固定
  `save-off` / `save-all flush` / `save-on`（`save-on` 在 finally 重试），应用 API 不提供该能力。
- 反向代理：只允许固定上游 `http://127.0.0.1:4096`；注入 Basic，移除客户端 Cookie/Authorization；校验 Origin。

## 8. 备份与灾备

- **应用归档**：CLI 用 `node:sqlite` 的 `backup()` 生成一致性 DB 快照；从快照读 `backup_state` 与文件列表。
  全量=所有文件；增量=`created_at > 上次成功备份` 的文件 + DB 快照 + manifest；manifest 增 `skippedMissing/warnings`。
  归档先写 `.part`，tar 成功后原子改名；SHA-256 旁文件；pending 未确认不删除，`--ack` 事务推进游标。
- **PC 拉取**：Windows 计划任务每日 `--pending` → 无 pending 才 `--prepare` → `.part` 下载 → SHA-256 校验 →
  原子改名 → 写旁文件 → `--ack` → 删除 Pi 归档；失败保留 pending 重试同一归档；状态 JSON 在重试循环外一次写入。
  保留：Pi pending 直到确认、已确认 2 个；PC daily 30 天、weekly 56 天、secrets 90 天。
- **整包加密**：`cli/backup-encryption.ts` 只读独立 age 公钥（root、组/其他不可写、格式/大小校验），
  `--prepare` 流程 tar → `*.plain.tmp` → 计算 plain sha/size → `age -r` 加密到 `*.part.age` → rename `.age` → 写外部 sidecar
  `<name>.meta.json`（schema 2）→ 写 DB `manifest_json`（含 `encrypted/plainSha256/plainSize/cipherSha256/cipherSize/recipient`）→ 删除明文。
  归档内 manifest `schema:2` 不含明文哈希（避免自引用）；失败关闭（age/公钥/加密/空间失败即 prepare 失败，不降级明文）；
  空间按 2× 明文预算；崩溃只允许可清理 `*.plain.tmp`/`.part` 或“有密文无 DB 行”孤儿（只报告不自动删）。
  应用不持私钥：`backups/service.ts` 对 `.age` 的 verify/import/entries/restore-plan/execute 返回 409 `archive_encrypted`，
  恢复目标自动跳过加密归档；状态/UI 只展示加密开关、公钥是否就绪与密文计数。
- **异地副本**：PC 端 `backup-offsite.mjs` 规划“最新 full + 其后全部 inc + 最近 N 天”链，
  只上传 `.age`（明文拒绝并计 `plaintextSkipped`），`rclone copyto --checksum` + 远端大小校验，链感知删除且绝不删最新 full；
  `backup-offsite.ps1` 硬超时调用并把状态 JSON 写回 Pi `/var/lib/antifieldcloud/backup-offsite-status.json`；
  应用 `util/status.ts` 只读解析（64 KiB 上限），Dashboard 展示、`AlertService.offsiteCondition` 在状态缺失/未配置时返回 null（不误报）。
- **密钥包**：age 加密 env/cloudflared/Minecraft/opencode 配置与 opencode DB 一致性快照；明文只在 tmpfs 0700 临时目录；
  opencode 快照失败硬失败（不生成半成品）；`--include-host-config` 可选打包主机配置；Pi `KEEP=2`，PC 拉取后不立即删除远端。
- **世界备份**：root 脚本读取 env/server.properties 的 RCON 与路径；预检世界目录/备份目录/磁盘余量（1.5× 世界体积）；
  `save-off → save-all flush（超时重试）→ tar -czf .part → gzip 完整性校验 → SHA-256 → 原子改名`；`save-on` 必执行；
  保留最新 4 份且只删匹配命名的文件；写 `world-backup-status.json`（0644）。
- **世界拉取**：`world-pull.ps1` 查询远端归档与状态 → scp 到 `.part` → 与远端 `.sha256` 比对 → 原子改名 → 删远端归档/旁文件（ack）
  → 本地保留 4 份；失败不 ack；所有 ssh/scp 有硬超时并杀进程树；写 `world-pull-status.json`。
- **恢复演练**：`drill.ps1` 定位最新 full 与其后全部 inc，校验旁文件 SHA、tar 条目类型/路径、manifest 与最新 DB
  （`PRAGMA integrity_check`/`foreign_key_check`/`meta.schema_version`），输出 `report.json/report.md`（保留 180 天）；
  可选 `-IncludeWorld`（先查临时盘 ≥3× 归档空间再解包验证 `world/level.dat`）并回写 `drill-status.json`。
- **Web 恢复**：只做归档导入/校验/文件级恢复到新目录（TOTP + typed confirmation）；恢复链按来源隔离；
  归档内 `origin!='user'` 的文件不进入用户目录；`skippedMissing` 文件从选择中剔除并报告；解包/落盘按选择字节 ×2 预检空间，
  staging 上限 2 GiB 且不超过可用空间 20%；归档内容浏览按 IP 限流（30 次/分钟）；整库恢复走离线 root 手工流程（停服 + pre-restore 快照 + 回滚，见 `docs/DEPLOY.md` 的「15.8.1 应用数据（整库离线恢复）」）。
- **旧世界 cron**：验收后已从 `crontab` 移除 `minecraft-backups` 行；旧归档不自动删除，按 `docs/DEPLOY.md` 的「15.6.4 旧 cron 迁移与旧归档手动清理」手动清理。

## 9. 部署与运行

- `/opt/antifieldcloud/releases/<UTC>` + `current` 符号链接；systemd `antifieldcloud`（只读系统、仅数据目录可写、MemoryMax 512M、空 capability、设备/时钟/主机名/内核日志收紧）。
- 前端在 PC 构建；Pi 只安装生产依赖（`npm ci --omit=dev --ignore-scripts`）。
- 部署脚本：构建 → 打包 → 上传并校验 tar SHA-256 → 解包/npm ci → 迁移前 DB 快照 → 注入 `APP_VERSION` → 切换 current/重启
  → `/healthz` 断言版本；失败先停服、还原迁移前 DB 快照、切回 previous、启动、复检（无快照则拒绝自动回滚）。
- nftables 默认拒绝入站；22 仅直连/校园网段（新建连接限速 20/min），25565 仅同网段，25575 仅 loopback，DHCP 仅 eth0/wlan0；
  出站不限制。改动前确认当前 SSH 来源在允许网段内。SSH 为仅公钥（`00-` drop-in），旧回滚备份归档在 `/var/backups/antifieldcloud/`。
- QQ 由 DSH 管理。Workbench 不读取 `CHATBOT_*`。Cloudflare Access 仍需对 `/healthz` 与公开分享 bypass；`smoke.ps1` 可选用 Access service token。
- mcbot 本版 v1.2.4（最低 v0.6.0，契约只接受 v2），仅监听 `127.0.0.1:3010`。生产进程是 `/opt/mcbot/releases/20261116T135658Z`。应用 env 由 `bootstrap-env.sh` 纳管 `MCBOT_*`，Token 由 root 执行 `scripts/sync-mcbot-tokens.sh` 同步。启用顺序为 mcbot 就绪 → 同步 Token → `MCBOT_ENABLED=true` → 重启应用。关闭对接设 `MCBOT_ENABLED=false` 并重启。现行 schema 为 22，恢复 v1.2.3 必须先换回迁移前快照 `db-predeploy-20261116T135240676Z.sqlite`。冒烟期望见 `docs/DEPLOY.md`。
- fail2ban：dbfile 持久化封禁；`deploy/systemd/nftables.service.d/10-fail2ban-restore.conf` 在 nftables 启动后以 `systemd-run --collect --on-active=3` 异步重启 fail2ban，从数据库恢复 set；手工 `systemctl reload nftables` 不触发 `ExecStartPost`，仍需 `systemctl restart fail2ban`。
- 世界备份/健康探针 timer 由 root 运行；世界备份 unit 只读整机、仅 `/var/lib/antifieldcloud` 可写、flock 串行、4h 超时。

## 10. 信任边界与失败隔离

- Cloudflare 终止 TLS，Cloudflare 可见明文；TOTP 是应用层第二道门。
- opencode 自身 Basic 密码由服务端注入，不下发前端；opencode 端口不对外；HTTP/WS Origin 校验防跨站借用 Cookie。
- Minecraft RCON 已轮换强密码但仍监听所有接口，仅 nftables 限制为 loopback；世界备份脚本是唯一可发固定保存命令的组件，以 root 运行且沙箱化。
- 文件预览按类型白名单；HTML/SVG 不内联；音视频只播放白名单容器；文本预览由 React 转义。
- 笔记附件与普通文件用 `origin` 隔离；分享只接受活动普通文件，跨分享 itemId 一律 404。
- 生产 QQ 由 DSH 管理。Workbench 不接收 Webhook，不保存 QQ 凭据、队列或 OpenCode Chat。告警只走 webhook。
- 管理员对话和 DSH 步骤只留在内存。审计不记录对话正文、步骤、提示词或工具参数。急停清空步骤，不经过模型。
- DSH Web 反代只允许固定 loopback 上游。HTML 原样转发。HTTP 与 WebSocket 校验 Origin。
- 备份归档导入是受 TOTP 门禁的管理员输入，但仍按不可信 tar 校验；不提供归档下载；Web 永不执行整库替换。
- 状态文件由 root/PC 脚本写、应用只读；文件缺失/损坏时面板与告警降级为 unknown，不影响主服务。
- 指标与审计只含元数据/主机数值；应用故障不影响 Minecraft/opencode/桌面；cloudflared 故障只影响公网入口。
- **备份加密边界**：Pi 侧只有备份 age 公钥，应用/CLI 永不读取私钥；Web 对 `.age` 的校验/导入/浏览/恢复/执行一律 409
  （在归档名校验之前），恢复目标自动跳过；PC 端解密/校验/恢复在离线私钥环境完成，临时明文用后即删。失败关闭优先级高于可用性。
- **异地副本边界**：只上传 `.age`；状态文件由 PC 写入、应用只读且只展示别名/计数/时间；状态缺失视为未配置、不告警；
  远端删除按链感知规划且绝不删最新 full，避免“远端只剩不可恢复链”。
- **审计策略**：非安全审计事务外 best-effort（失败计数/最近错误经 `/api/version.audit`），安全关键审计逐条记录、
  失败不阻断已完成的业务状态；公开下载计数仍在事务内，避免审计故障改变业务结果。

## 11. 明确残余与长期限制

以下为明确保留、不强行改造的架构性/已接受项（逐条理由见 `docs/AUDIT.md` 与 `docs/SECURITY.md` §4）：

1. **单进程单点**：限流与诊断计数在单进程内存态；进程重启会清零限流计数，无多实例/高可用。审计失败计数已持久化，限流仍为内存态。
2. **同步维护与 SQLite 模式**：小时维护任务同步执行可能短暂阻塞请求；`synchronous=NORMAL` 不抗突然断电最后若干毫秒写入。
3. **平台/模型路径 mock-only**：DSH 与 Cloudflare 边缘的负路径以进程内夹具为主。真实平台限流和故障仍需部署后联调。
4. **物理孤儿/导入异常路径**：孤儿文件回收仅限“超期 + DB 无行 + id 形状”；导入归档按 90 天保留并清理无 DB 记录导入文件，恢复锁/临时目录的极端残留仍需人工核对。
5. **备份加密残余**：SIGKILL/断电/ENOSPC 的 `*.plain.tmp` 窗口（>24h 清理）、2× 空间峰值、孤儿密文只报告；私钥丢失不可恢复；
   预部署 DB 快照继续明文 0600（自动回滚需要）。
6. **异地副本残余**：模板默认关闭。生产使用一个 Google Drive 远端，依赖 PC、rclone 和凭据。状态文件的可信度取决于管理员 PC。
7. **旧 QQ 管线**：schema 22 已删除 Workbench 的收发、发布和 OpenCode Chat。不要把这些表或 `CHATBOT_*` 加回来。
8. **既有环境限制**：单管理员、无限免密 sudo 已撤销、RCON 监听 0.0.0.0、单 SD、无 LUKS、Cloudflare 明文、
   内存态限流、`Intl` 开销、迁移无校验和、健康检查为轻量就绪（非全量依赖探测）等按 `docs/SECURITY.md` §4 管理。
9. **已收口项**：审计失败计数持久化、Bot 镜像孤儿清理、导入归档保留、告警 24h 重通知、备份锁心跳、DR-1 `clockSkew` 状态。
10. **mcbot 事件告警语义（v0.8.0，v0.8.1 仍保持）**：外部 `alert` 仅以 `status='event'` 记录，不进入 firing/resolved 状态机，无恢复通知/冷却/去重（由上游负责）；告警只在轮询时发现，最多滞后一个 `MCBOT_POLL_MS` 周期；告警写入失败停游标重试。v1.0.7 的 schema v19 为这些事件增加可空 `dedupe_key`，同一键不重复写入。
11. **mcbot 聊天/事件不持久化（v0.8.0）**：事件、聊天和 DSH 步骤只存在内存。事件缓存最多 100 条且 ≤512 KiB，步骤最多 80 条。应用或 mcbot 重启即丢失。不提供历史查询、导出或搜索。
12. **mcbot 单实例与轮询延迟（v0.8.0）**：单进程内存缓存、单 mcbot 上游；控制结果最终一致，状态/事件最多滞后一个轮询周期；mcbot 不可达时仅展示缓存并降级；`stop()` 仍不取消在途轮询。v1.0.7 起 mcbot 进程不在或轮询快照过期走 `service_down`。
