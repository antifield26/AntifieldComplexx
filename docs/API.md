# HTTP 契约

Workbench 与前端共同遵守本文前半部分。Minecraft Bot 的本机 HTTP 契约在后半部分。占位域名是 `app.example.com` 与 `ai.example.com`。

## 会话、附件与原生客户端

- 应用 Cookie 只接受未绑定设备的浏览器会话。把设备 sessionToken 放进 Cookie 返回 401，不能借此跳过签名。AI 主机的 SSO Cookie 仍是独立入口。
- 签名时钟偏差是 ±120 秒。nonce 保留到该秒结束。
- `POST /api/notes/:id/attachments/from-upload` 的 JSON 是 `{ "uploadId": string }`。它只接管当前用户已完成的上传，并在同一事务里改 origin、挂上附件。同笔记重试幂等。跨笔记、目录或分享引用会拒绝。multipart 仍然可用。
- 原生文件 IPC 只允许 main 的本地来源。内容端点限定 `/api/files/:id/content`。预览句柄限 loopback，可撤销，支持 Range，令牌不进入 URL。
- AI 顶层导航只允许固定的 AI 与 Access HTTPS 源。Access 登录后最多由主窗口再换票一次。

生产启用 DSH Web 后，`GET /api/dashboard` 给出 `dsh.webUrl` 与 `dsh.readiness`。就绪键是 `dsh_web`、`dsh_qq`、`dsh_mcbot`，只列出已配置的服务。Workbench 不再提供 QQ 管理或 Webhook。

## 0. 约定

- JSON 请求/响应：`Content-Type: application/json; charset=utf-8`。
- 时间：ISO 8601 UTC 字符串（如 `2026-10-19T09:00:00.000Z`）；前端按 `Asia/Shanghai` 展示。
- 文件 ID：不透明字符串（UUID），前端不得解析其含义。
- 分页：`page` 从 1 开始；文件默认 200、最大 500；笔记/书签默认 20、最大 100；响应含 `page/pageSize/total`。
- 统一错误体：

```json
{ "error": { "code": "invalid_credentials", "message": "用户名或密码错误", "details": { } } }
```

- 常见状态码：`400 invalid_request`、`401 unauthenticated/invalid_password`、`403 csrf_failed`、`404 not_found`、`410 share_expired/share_revoked/share_exhausted`、`409 conflict/quota_exceeded/archive_encrypted/chunk_conflict/backup_busy/restore_busy/plan_expired/archive_exists`、`413 file_too_large`、`415 unsupported_media_type`、`429 rate_limited`、`500 internal_error`、`502 mcbot_auth_failed/mcbot_upstream_error`、`503 chatbot_disabled/chatbot_key_missing/chatbot_ai_tool_isolation_unavailable/chatbot_ai_context_unavailable/mcbot_disabled/mcbot_control_disabled/mcbot_unavailable/mcbot_task_disabled/mcbot_history_disabled/mcbot_not_found`、`507 insufficient_storage`。`429` 同时带 `Retry-After` 响应头与 `error.details.retryAfterSec`。
- 认证：登录成功后服务端在 **app 主机**下发 host-only `af_session`（HttpOnly）与 `af_csrf`（可读）Cookie（均不设 `Domain`；`ai` 主机使用独立 host-only 会话 Cookie）。除 `GET/HEAD` 外的所有 `/api` 请求必须带 `X-CSRF-Token: <af_csrf>`，并满足 `Origin` 为 `https://app.example.com` / 本机；`ai` 源不再作为 app 写请求的受信 Origin。例外：既有公开分享 `POST /api/public/shares/:token/unlock` 也只校验 Origin 与限流。客户端设备会话使用 `Authorization: Bearer` 与设备签名，签名通过后不再要求 CSRF；`Authorization` 存在但不是合法 Bearer 时不回退 Cookie（见 §2）。
- AI 主机 SSO：app 登录/已登录后访问 `GET /api/auth/ai-ticket?next=<ai 完整 URL>`，服务端校验 `next` 必须属于配置的 `AI_ORIGIN`，签发 60 秒一次性 ticket 并 302 到 `https://ai.example.com/__af/sso/<ticket>?next=<ai 相对路径>`；代理校验/消费 ticket 后设置 ai 主机 host-only `af_session` 并 302 到目标路径。ticket 一次性、绑定 aiOrigin、不落库。请求头 `Accept` 包含 `application/json` 时改为 `200 { "url": "<同一地址>" }`，不跳转。
- mcbot 功能开关：`MCBOT_ENABLED=false` 时 `GET /api/mcbot/status` 仍返回 `enabled:false` 的空壳快照，其余端点返回 `503 mcbot_disabled`。任务开始、目标读写、自主开始、移动、游戏发言和历史代理不存在。控制 Token 为空时，对话、急停、在线模式、停止任务和停止自主会话返回 `503 mcbot_control_disabled`。`MCBOT_URL` 只允许 `http(s)://loopback[:port]` 根地址（拒绝 userinfo/路径/查询/片段）。上游未启用/网络不可达返回 `503 mcbot_unavailable`；鉴权失败/上游异常返回 `502 mcbot_auth_failed`/`mcbot_upstream_error`；上游 5xx 的稳定业务码 `task_disabled`/`control_disabled`/`admin_unavailable` 保留为 `mcbot_*`。响应与错误文本不包含 mcbot URL/Token。
- 安全响应头：`Cache-Control: no-store`（静态 hash 资源除外）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、CSP（见 docs/SECURITY.md）。
- 登录限制：每 IP 5 次失败/15 分钟；全局 60 次/小时（密码）、120 次/小时（TOTP），loopback 来源不占全局桶。`429` 响应包含 `retryAfterSec`。
- 单文件上限：普通 multipart **100 MiB**（`MAX_UPLOAD_BYTES=104857600`，匹配 Cloudflare 代理）；更大文件走分片上传。超过返回 `413 file_too_large`，磁盘不足返回 `507 insufficient_storage`。
- 未登录访问 `ai.example.com` 的 HTML 请求：`302` 到 `https://app.example.com/login?next=https%3A%2F%2Fai.example.com%2F`；app 登录页对 ai 外部 `next` 先走 `/api/auth/ai-ticket` → ai `/__af/sso/<ticket>`，再由代理设置 ai host-only 会话 Cookie；API/WebSocket 未认证返回 `401`。
- 未知 Host 返回 `404`（应用只接受 app/ai 与 loopback）。
- 再认证：`POST /api/account/password` 与 `/api/account/recovery-codes` 需要当前密码 + `totpCode`；每 IP 5 次/15 分钟 + 再认证全局 30/h + TOTP 全局 120/h（与登录共享），失败审计，恒定延迟。

## 1. 健康检查

`GET /healthz`（无需认证）

```json
{ "ok": true, "version": "1.2.3", "schemaVersion": 21, "uptimeSec": 1234, "db": "ok", "pendingBackups": 0 }
```

- `db`：轻量就绪标记（DB 可读为 `ok`）；`pendingBackups`：未 ack 且未删除的备份归档数（只读聚合，不含敏感信息）。
- 失败时返回 503/错误体；`/healthz` 仍为 Cloudflare Access bypass（见 `docs/DEPLOY.md` §5.2）。

## 2. 认证与账号

### POST /api/auth/password

```json
{ "username": "antifield", "password": "********" }
```

成功 `200`：

```json
{ "challenge": "opaque-token", "expiresIn": 300 }
```

失败：`401 invalid_credentials`（不区分用户不存在/密码错误）；`429 rate_limited`。

### POST /api/auth/totp

```json
{ "challenge": "opaque-token", "code": "123456" }
```

或恢复码：

```json
{ "challenge": "opaque-token", "recoveryCode": "ABCDE-12345" }
```

成功 `200`：设置会话 Cookie，返回：

```json
{ "user": { "username": "antifield" }, "csrfToken": "csrf-value" }
```

失败：`401 invalid_code`、`410 challenge_expired`、`429 rate_limited`。

客户端可在同一请求中登记设备。浏览器不传 `device`，响应也不含 `sessionToken`。

```json
{
  "challenge": "opaque-token",
  "code": "123456",
  "device": {
    "name": "书房电脑",
    "platform": "windows",
    "publicKey": "<43 字符 base64url 的 Ed25519 公钥>",
    "appVersion": "1.1.1"
  }
}
```

`platform` 只允许 `windows` 或 `android`。`name` 为 1–32 个字符，去掉首尾空白，拒绝控制字符。`appVersion` 为 `x.y.z`，可带最短 1、最长 16 的预发布后缀。公钥不合法、名称不合法或设备字段不是对象时返回 `400 invalid_device`，且不消耗挑战和 TOTP。

登记成功时仍设置 Cookie，并额外返回：

```json
{
  "user": { "username": "antifield" },
  "csrfToken": "csrf-value",
  "sessionToken": "opaque-session",
  "expiresAt": "2026-11-18T00:00:00.000Z",
  "device": { "id": "opaque-id", "name": "书房电脑", "platform": "windows" }
}
```

同一用户再次登记同一把未吊销公钥时复用设备 id，并作废该设备的旧会话。公钥属于其他用户时 `409 device_key_in_use`。已吊销公钥 `401 device_revoked`。未吊销设备达到 10 台时 `409 device_limit`。

### 设备请求签名

带 `Authorization: Bearer <sessionToken>` 的请求必须同时带：

- `X-Device-Id`：登记返回的设备 id
- `X-Device-Timestamp`：Unix 秒，允许偏差 ±120 秒
- `X-Device-Nonce`：16–64 位 `[A-Za-z0-9_-]`，在偏差窗口内不可重复
- `X-Device-Signature`：64 字节 Ed25519 签名的 base64url

待签名字符串为 UTF-8，各段以 `\n` 连接：`v1`、设备 id、时间戳原文、nonce、大写方法、含查询的路径、原始请求体的 SHA-256 十六进制。无请求体时对空字节串取哈希。签名通过后写操作不再要求 CSRF。

`/api` 的跨源预检只接受 `http://tauri.localhost`、`https://tauri.localhost` 与 `tauri://localhost`。其它 Origin 不返回跨源头。预检不要求登录或签名，响应不带凭据。

失败：`401 invalid_authorization`（认证头形状不合法）、`401 device_headers_required`、`401 device_clock_skew`、`401 device_signature_invalid`、`401 device_replay`、`401 device_revoked`、`401 device_mismatch`（会话缺失、用户不一致或会话不属于该设备）、`401 unauthenticated`（设备 id 不存在）。同一 IP 15 分钟内签名失败达到 30 次后返回 `429 rate_limited`。请求体超过 9 MiB 时返回 `413 device_body_too_large`，此时尚未校验签名。

### GET /api/devices

需要会话。返回当前用户未吊销的设备，不含公钥、IP 或 User-Agent：

```json
{
  "devices": [
    {
      "id": "opaque-id",
      "name": "书房电脑",
      "platform": "windows",
      "appVersion": "1.1.1",
      "online": true,
      "lastSeenAt": "2026-11-11T00:00:00.000Z",
      "current": true
    }
  ]
}
```

`online` 表示最近 90 秒内有过 `POST /api/devices/heartbeat`。`current` 表示该会话绑定的设备。

### POST /api/devices/heartbeat

需要已绑定设备的会话。浏览器会话返回 `403 device_required`。成功 `200 { "ok": true }`，只更新该设备的 `lastSeenAt`。

### POST /api/devices/:id

```json
{ "name": "客厅电脑" }
```

需要会话。成功 `200 { "ok": true }`。设备不存在、不属于当前用户或已吊销时 `404 device_not_found`。名称不合法时 `400 invalid_device`。

### DELETE /api/devices/:id

需要会话。成功 `200 { "ok": true }`：写入吊销时间并删除该设备的全部会话。重复吊销仍成功。不属于当前用户时 `404 device_not_found`。

### GET /api/auth/ai-ticket?next=\<ai 完整 URL\>

需要 app 主机会话。`next` 必须与配置的 `AI_ORIGIN` 完全同源（`https://ai.example.com/...`），否则 `400 invalid_request`。
成功返回 `302` 到 `https://ai.example.com/__af/sso/<ticket>?next=<ai 相对路径>`；ticket 一次性、60 秒有效、绑定 aiOrigin，用于给 ai 主机设置 host-only `af_session`。未登录 `401 unauthenticated`。请求头 `Accept` 包含 `application/json` 时改为 `200 { "url": "<同一地址>" }`，`cache-control` 仍为 `no-store`。浏览器导航保持 `302`。

### POST /api/auth/logout

需要会话 + CSRF。成功 `200 { "ok": true }`。

### GET /api/auth/me

需要会话。成功：

```json
{
  "user": { "username": "antifield" },
  "csrfToken": "csrf-value",
  "session": { "createdAt": "…", "expiresAt": "…", "ip": "…", "userAgent": "…" }
}
```

未登录 `401 unauthenticated`。

### POST /api/account/password

```json
{ "currentPassword": "old", "newPassword": "new" }
```

成功 `200 { "ok": true }`，除当前会话外的其它会话失效。

### POST /api/account/recovery-codes

```json
{ "password": "current" }
```

成功 `200 { "codes": ["…", "…"] }`（一次性展示，仅返回一次）。

### POST /api/account/logout-all

成功 `200 { "ok": true }`，注销全部会话（含当前）。

## 3. 仪表盘与审计

### GET /api/dashboard

```json
{
  "host": {
    "hostname": "RPI5",
    "uptimeSec": 1234,
    "load": [0.1, 0.2, 0.3],
    "cpuPercent": 12.3,
    "mem": { "totalBytes": 1, "usedBytes": 1, "availableBytes": 1 },
    "tempC": 48.2,
    "root": { "totalBytes": 1, "usedBytes": 1, "freeBytes": 1 }
  },
  "storage": {
    "quotaBytes": 10737418240,
    "usedBytes": 1234,
    "trashBytes": 0,
    "fileCount": 3,
    "freeBytes": 1
  },
  "minecraft": {
    "online": true,
    "version": "Paper 26.1.2",
    "motd": "Raspberry Pi 5 | Minecraft LAN",
    "players": { "online": 0, "max": 5, "names": [] },
    "tps": { "m1": 20.0, "m5": 20.0, "m15": 20.0 },
    "whitelistCount": 7,
    "serviceActive": "active",
    "publicAddress": "mc.example.com:11798",
    "checkedAt": "…",
    "error": null
  },
  "opencode": { "reachable": true, "url": "https://ai.example.com", "sessions": 3 },
  "services": { "minecraft": "active", "cloudflared": "active", "opencode": "active" },
  "backup": { "lastPullAt": "…", "ageHours": 12.3, "sizeBytes": 123456, "ok": true, "overdue": false, "encryptedPendingCount": 1, "encryptedAckedCount": 0, "encryption": { "enabled": true, "keyConfigured": true }, "offsite": { "lastRunAt": "…", "ok": true, "remoteLabel": "myremote", "uploaded": 1, "skipped": 0, "failed": 0, "bytes": 123456, "keptRemote": 12, "plaintextSkipped": 0, "error": null } },
  "activity": [
    { "id": 1, "ts": "…", "action": "login", "target": null, "detail": null, "ip": "…" }
  ],
  "generatedAt": "…"
}
```

`minecraft.error` 可为 `null`；`backup` 恒为对象，但 `lastPullAt/ageHours/sizeBytes` 等字段可为 `null`；`services.*` 取值 `active|inactive|unknown`。`opencode.sessions` 不可得时为 `null`。
`backup` 另含 `encryptedPendingCount/encryptedAckedCount/encryption{enabled,keyConfigured}/offsite`：
`encryption` 只表示开关与 Pi 端 age 公钥文件是否存在（不读取私钥）；`offsite` 为 PC 写入的只读状态对象（缺失为 `null`，视为未配置），
只含别名/计数/时间，不含远端真实路径/URL/凭据。

### GET /api/audit?limit=50&offset=0&action=login

`limit` 1–200，默认 50；`action` 可选，精确匹配动作名（如 `login`/`whitelist_add`）。响应：

```json
{ "items": [ { "id": 1, "ts": "…", "action": "whitelist_add", "target": "Steve", "detail": null, "ip": "…" } ], "total": 1 }
```

## 4. 文件与目录

### FileItem

```json
{
  "id": "uuid",
  "parentId": "uuid|null",
  "name": "报告.pdf",
  "kind": "file|dir",
  "size": 12345,
  "mime": "application/pdf",
  "sha256": "…|null",
  "createdAt": "…",
  "updatedAt": "…",
  "previewKind": "image|text|markdown|pdf|none",
  "inlineAllowed": true,
  "deletedAt": null,
  "originalParentId": null,
  "originalPath": null
}
```

`previewKind` 仅对文件有意义；`inlineAllowed` 表示是否允许 `?inline=1` 内联（仅栅格图片/PDF）；
`deletedAt/originalParentId/originalPath` 仅在回收站接口返回。

### GET /api/files

查询参数：`parentId`（省略=根）、`page`、`pageSize`、`sort=name|updated|size`、`dir=asc|desc`。

```json
{
  "items": [ FileItem ],
  "page": 1,
  "pageSize": 200,
  "total": 3,
  "breadcrumb": [ { "id": null, "name": "全部文件" }, { "id": "uuid", "name": "文档" } ]
}
```

### GET /api/files/search?q=xxx

文件名搜索（活动文件，最多 100 条）：

```json
{ "items": [ FileItem ], "total": 2 }
```

`q` 为空返回空列表。

### GET /api/files/:id

返回 `FileItem`，附加 `path`：

```json
{ "item": FileItem, "path": [ { "id": null, "name": "全部文件" }, { "id": "uuid", "name": "文档" } ] }
```

### POST /api/files/folder

```json
{ "parentId": "uuid|null", "name": "新文件夹" }
```

成功 `201 FileItem`。同名自动追加 ` (2)`。失败 `400 invalid_name`、`409 already_exists`（目录超过深度）、`507`。

### POST /api/files/upload

`multipart/form-data`：

- 字段 `parentId`（可选，空=根；也可用查询参数 `?parentId=`）
- 文件字段名 `files`（可多个；普通单请求单文件 ≤ 100 MiB；单请求 ≤ 20 个文件；更大文件走分片上传）

成功 `200`（允许部分失败）：

```json
{
  "items": [ FileItem ],
  "errors": [ { "name": "x.bin", "code": "quota_exceeded", "message": "空间不足" } ]
}
```

全部失败时返回对应错误状态（`409 quota_exceeded` / `413 file_too_large` / `507 insufficient_storage`）。文件名自动清洗/去重。

### PATCH /api/files/:id

```json
{ "name": "新名字", "parentId": "uuid|null" }
```

字段均可选，至少一个。成功 `200 FileItem`。失败 `404`、`409 already_exists/cycle_detected`、`400 invalid_name`。

### DELETE /api/files/:id

软删除（目录递归）。成功 `200 { "ok": true, "id": "uuid", "count": 1 }`（count 为递归删除的条目数）。

### GET /api/files/:id/content

查询参数：
- `inline=1`：栅格图片、PDF、白名单音视频（mp4/webm/mp3/m4a/ogg/flac/wav）返回 `Content-Disposition: inline`；其它类型忽略该参数。
- `download=1`：强制附件。

默认按 `previewKind` 决定 inline/attachment。支持 `Range: bytes=…`（单区间，206；不可满足 416）。响应头包含 `Content-Type`、`Content-Length`、`Content-Disposition`（RFC 5987）、`Accept-Ranges: bytes`、`ETag`。禁止内联 SVG/HTML/XML；音视频不转码。`GET` 路由自动提供 `HEAD`。

### GET /api/files/:id/text

仅文本类（`previewKind=text|markdown`）。成功：

```json
{ "name": "a.md", "mime": "text/markdown", "size": 123, "truncated": false, "content": "…" }
```

非文本 `415 unsupported_media_type`；超过 1 MiB 时 `truncated: true` 并只返回前 1 MiB。

### 分片上传

大文件（`/api/version` 的 `chunkedUploadEnabled=true` 且大于 `maxUploadBytes`）走分片；每块 `application/octet-stream`，默认 8 MiB，单文件上限 5 GiB。所有写操作要求登录 + `X-CSRF-Token`；会话仅创建者可见。

#### POST /api/uploads

```json
{ "name": "movie.mp4", "parentId": "uuid-or-null", "size": 5242880000, "sha256": "optional-hex" }
```

成功 `201`：

```json
{ "uploadId": "uuid", "chunkSize": 8388608, "totalChunks": 626, "expiresAt": "ISO", "received": [] }
```

`400 invalid_size/invalid_sha256`、`409 too_many_uploads/quota_exceeded`、`413 file_too_large`、`507 insufficient_storage`。

#### PUT /api/uploads/:id/chunks/:index

Header：`Content-Type: application/octet-stream`；body 必须是该块的精确字节数（尾块为剩余大小，其它块为 `chunkSize`）。可乱序、可重试；同索引同内容幂等，不同内容 `409 chunk_conflict`。成功 `200 { "index": 0, "received": 1 }`。越界 `400 invalid_chunk_index`，大小不符 `400 invalid_chunk_size`。

#### GET /api/uploads/:id

成功 `200`：

```json
{ "uploadId":"uuid","fileName":"movie.mp4","size":5242880000,"chunkSize":8388608,"totalChunks":626,"received":[0,1],"missing":[2],"status":"uploading","expiresAt":"ISO" }
```

`status='completed'` 时额外返回 `fileId`（已登记文件），前端可据此在响应丢失后直接结束而不重传。

#### POST /api/uploads/:id/complete

body 可带 `{ "sha256": "hex" }`。服务端拼接时逐片比对保存的 SHA-256，再检查整文件 SHA-256 并登记文件，返回 `200 { "ok": true, "file": FileItem }`。缺失或损坏的分片返回 `400 chunks_missing`，只使受影响的分片失效。客户端刷新会话并重传缺片。整文件 SHA-256 不匹配返回 `400 checksum_mismatch`，重复 complete 返回已登记文件。

#### DELETE /api/uploads/:id

取消会话并清理临时块；成功 `200 { "ok": true }`。已完成的会话不能取消（`409 upload_completed`）。

限制：24h 会话过期、每用户最多 3 个活跃会话；过期/取消释放配额预留；维护任务清理过期块目录。

## 5. 回收站

### GET /api/trash?page=1&pageSize=200

```json
{ "items": [ FileItem ], "page": 1, "pageSize": 200, "total": 1, "trashBytes": 1234 }
```

### POST /api/trash/:id/restore

成功 `200 FileItem`（`deletedAt=null`）。原父目录不存在时恢复到根目录。重名自动追加后缀。

### DELETE /api/trash/:id

彻底删除（目录递归），成功 `200 { "ok": true, "count": 2, "freedBytes": 1234 }`。

### DELETE /api/trash

清空回收站，成功 `200 { "ok": true, "count": 3, "freedBytes": 5678 }`。

## 6. Minecraft

### GET /api/mc/status

可选 `?force=1` 跳过 10 秒缓存。

```json
{
  "online": true,
  "version": "Paper 26.1.2",
  "motd": "Raspberry Pi 5 | Minecraft LAN",
  "players": { "online": 0, "max": 5, "names": [] },
  "tps": { "m1": 20.0, "m5": 20.0, "m15": 20.0 },
  "whitelistCount": 7,
  "serviceActive": "active",
  "publicAddress": "mc.example.com:11798",
  "checkedAt": "…",
  "error": null
}
```

SLP 失败时 `online:false`，`error` 为简短原因；RCON 不可用时 `tps=null`、`whitelistCount=null`，并在 `error` 中说明。

### GET /api/mc/whitelist

```json
{ "names": ["Antifield", "Steve"], "checkedAt": "…", "error": null }
```

RCON 不可用：`502 rcon_unavailable`。

### POST /api/mc/whitelist

```json
{ "name": "Steve" }
```

成功 `200 { "ok": true, "name": "Steve", "names": ["…"], "checkedAt": "…", "error": null }`。名字规则 `^[A-Za-z0-9_]{3,16}$`；已存在 `409 already_whitelisted`；RCON 失败 `502`。

### DELETE /api/mc/whitelist/:name

成功 `200 { "ok": true, "name": "Steve", "names": ["…"], "checkedAt": "…", "error": null }`；不存在 `404 not_whitelisted`；RCON 失败 `502`。

## 7. 其它

- `GET /api/version`（需要会话）：`{ "version": "1.2.1", "schemaVersion": 21, "appOrigin": "https://app.example.com", "aiOrigin": "https://ai.example.com", "trashRetentionDays": 30, "maxUploadBytes": 104857600, "sharesEnabled": true, "alertsEnabled": true, "backupRestoreEnabled": false, "backupImportMaxBytes": 104857600, "backupRestoreMaxEntries": 5000, "backupArchiveEncryption": false, "backupAgeRecipientConfigured": false, "backupOffsiteStatusConfigured": false, "chunkedUploadEnabled": true, "chunkSizeBytes": 8388608, "chunkMaxFileBytes": 5368709120, "noteAttachmentMaxBytes": 26214400, "noteMaxAttachments": 100, "noteVersionsKeep": 20, "shareMaxItems": 50, "metricsEnabled": true, "metricsSampleSeconds": 60, "metricsRetentionDays": 30, "botsEnabled": false, "botPlatforms": ["qq"], "mcbotEnabled": false, "mcbotControlEnabled": false, "audit": { "failureCount": 0, "lastError": null, "lastFailureAt": null, "persisted": true } }`。
  - `schemaVersion`（程序支持的 schema，前端用于演练一致性提示）、`backupArchiveEncryption`/`backupAgeRecipientConfigured`/`backupOffsiteStatusConfigured`（只读状态，不含密钥/路径）、`audit`（审计写入失败计数/最近错误/时间，不含明细）。旧服务端不下发时前端按关闭/未配置/null 降级。
  - `mcbotEnabled`/`mcbotControlEnabled`（v0.8.0）：mcbot 集成是否启用、控制接口是否可用（`MCBOT_ENABLED=true` 且 `MCBOT_CONTROL_TOKEN` 非空）；前端据此决定 `/minecraft` 是否显示 mcbot 标签与控制操作。两者都不含 mcbot 地址/Token。
  - schema **17**；`audit.persisted` 表示诊断是否来自 DB 持久化行（DB 不可用时 false，回退内存计数）。
  - `backupRestoreEnabled` 与 `deploy/env.example` 默认一致（默认 `false`；Web 文件级恢复需显式开启）。
- `GET /api/storage`（需要会话；轻量端点，供文件页取配额，避免触发 Dashboard 的 MC/opencode/systemctl 聚合）：`{ "quotaBytes": 10737418240, "usedBytes": 1234, "trashBytes": 0, "fileCount": 3, "freeBytes": 1 }`。字段与 `/api/dashboard.storage` 一致；`usedBytes` 含笔记附件与回收站，`fileCount` 只统计普通文件（`origin='user'`）。
- 静态资源：`PUBLIC_APP_SHELL` 默认 `true`。开关开启时，以及 Host 为 `127.0.0.1`、`localhost` 或 `::1` 时，`/`、`/files`、`/trash`、`/knowledge`、`/shares`、`/minecraft`、`/settings`、`/s/:token` 等 SPA 路径返回 `index.html`；`/assets/*` 长缓存；`/sw.js` 带 `Service-Worker-Allowed: /`；`/manifest.webmanifest` 为 `application/manifest+json`。
- `PUBLIC_APP_SHELL=false` 且 Host 等于 `APP_ORIGIN` 的主机名时，`GET/HEAD /` 以及 `Accept` 含 `text/html` 的页面返回说明页，标题为「请使用客户端」。响应为 `text/html; charset=utf-8`，`cache-control: no-store`，`x-robots-tag: noindex, nofollow`。`/assets/`、`/icons/`、`/sw.js`、`/manifest.webmanifest`、`/offline.html`、`/index.html`、`/favicon.svg` 返回 `404 not_found`。`/healthz`、`/api/*` 与 AI 主机保持原有行为。不带 `text/html` 的其它路径仍返回 JSON 404。
- 同一条件下，`GET /s/:token` 在 `Accept` 含 `text/html` 时由服务端渲染分享页。token 必须匹配 `^[A-Za-z0-9_-]{20,128}$`。无效链接返回 404 HTML，正文为「分享链接不存在」；过期、吊销或用尽返回 410 HTML。密码分享提交 `POST /s/:token/unlock`，正文为 `application/x-www-form-urlencoded` 的 `password`，并校验 Origin。成功返回 `303` 到 `/s/:token`，同时设置两枚 `af_share`：Path `/api/public/shares/<token>` 与 Path `/s/<token>`。不带 `text/html` 的 `GET /s/:token` 仍返回 JSON 404。开关开启时，HTML 请求继续返回 `index.html`，该解锁路由返回 JSON 404。
- `ai.example.com/*`：不是本应用 API，全部经会话校验后反代到 opencode；未登录 HTML 302，API 401。

## 8. 知识库（笔记/书签）

所有端点需要会话；写操作需 CSRF。Note 形状：

```json
{ "id": "uuid", "title": "标题", "bodyMd": "# Markdown", "tags": ["工作"], "pinned": true, "createdAt": "…", "updatedAt": "…" }
```

- `GET /api/notes?q=&tag=&pinned=true|false&page=1&pageSize=20` → `{items,page,pageSize,total}`。
- `POST /api/notes` body `{title,bodyMd,tags?,pinned?}` → 201 Note。
- `GET/PATCH/DELETE /api/notes/:id`；PATCH 字段可选；DELETE → `{ok:true}`。
- `GET /api/notes/tags` → `{items:[{name,count}]}`。
- Bookmark 形状：`{id,url,title,description,tags,pinned,createdAt,updatedAt}`；端点 `/api/bookmarks`、`/:id`、`/tags`，查询/分页同上。
- 限制：标题 ≤200、正文 ≤200KB、标签 ≤20 个且单个 ≤32；书签 URL 仅 http/https；FTS5 中文自动回退 LIKE。
- 笔记列表与详情均附带 `attachments`；列表项中的附件为增量字段，旧前端可忽略。

## 9. 文件分享

登录端点（会话 + CSRF）：

- `POST /api/files/:id/shares` body `{password?, expiresInHours?, maxDownloads?, note?}` → 201（单文件兼容入口，等价于 `fileIds:[id]`）：

```json
{ "share": { "id":"uuid","fileId":"uuid","fileName":"a.txt","fileSize":12,"fileMime":"text/plain","itemCount":1,"totalSizeBytes":12,"hasPassword":true,"expiresAt":"…","maxDownloads":3,"downloadCount":0,"createdAt":"…","revokedAt":null,"note":"…","status":"active" }, "url": "https://app.example.com/s/<token>" }
```

- `POST /api/shares`body `{fileIds:[], password?, expiresInHours?, maxDownloads?, note?}` → 201，结构同上；`fileIds` 1–50 个、去重，必须全部是活动普通文件（不得为目录/回收站/笔记附件）。`share.fileId/fileName` 为首个文件（兼容字段），`itemCount` 为实际条目数。`maxDownloads=0/null` 表示不限；URL 仅创建响应返回一次。新建密码分享最少 8 位；旧短密码分享仍可解锁。
- `GET /api/shares?page=1&pageSize=100` → `{items:[Share],total,page,pageSize}`（不含 token/URL；pageSize 最大 500；条目含 `itemCount`）。
- `DELETE /api/shares/:id` → `{ok:true,share}`（吊销）。
- `DELETE /api/files/:id`：先吊销包含该文件/子树的所有分享，再软删除；吊销失败返回 500 且文件不删除。

公开端点（无需会话；POST 校验 Origin；限流）：

- `GET /api/public/shares/:token` → 200 `{share:{fileName,size,mime,itemCount,totalSizeBytes,expiresAt,hasPassword,maxDownloads,downloadCount,items?}, state:"active", requiresPassword:boolean}`；未知 404；失效 410（`share_expired/share_revoked/share_exhausted`）；文件已删除 410 `share_gone`。公开信息不含 `note`。`items:[{id,name,size,mime}]` 仅在无需密码或已解锁时返回；`totalSizeBytes` 在未解锁时也返回。
- `POST /api/public/shares/:token/unlock` body `{password?}` → 200 `{ok:true,state,share,requiresPassword:false,expiresAt}`（`share` 含 `items`）并 Set-Cookie `af_share`（HttpOnly/SameSite=Lax/Secure，Path 限定该 token，5 分钟）；错误密码 401 `invalid_password`；限流 429。
- `GET /api/public/shares/:token/items/:itemId/content`（密码分享需 `af_share` Cookie）返回单文件流，`content-disposition: attachment`。支持 `Range`、`HEAD`、`ETag`。条目必须属于分享，否则返回 `404 share_item_not_found`。文件已删除返回 `410 share_gone`。
- `GET /api/public/shares/:token/content`：仅单文件分享可用；多文件分享返回 409 `share_bundle`，客户端改用 `items/:itemId/content`。
- 两个内容端点在校验后、发送正文前按会话预占一个下载名额。抢占失败返回 `410 share_exhausted`。同会话的多文件和 Range 共用名额。`HEAD`、`304` 和 `416` 跳过预占。全部在途响应中断时归还名额，服务异常退出时保留预占，原会话可继续下载。
- 公开页 `/s/:token` 带 `X-Robots-Tag: noindex, nofollow`。`PUBLIC_APP_SHELL=false` 且 Host 为应用公网主机时，浏览器打开的分享页由服务端渲染，见 §7。JSON 公开接口保持不变。

## 10. 告警

- `GET /api/alerts?limit=20`（会话）→：

```json
{ "items": [{ "id":1,"event":"disk_low","severity":"critical","status":"firing","title":"…","message":"…","createdAt":"…","deliveredAt":null,"deliveryError":null,"deliveries":{ "webhook":{ "status":"pending","attempts":0,"nextAttemptAt":"…","error":null },"qq":{ "status":"skipped","attempts":0,"nextAttemptAt":"…","error":"未启用或没有可通知的目标" } } }], "state": [{ "event":"disk_low","status":"firing","lastFiredAt":"…","lastOkAt":null }], "config": { "enabled":true,"webhookConfigured":false,"webhookType":"generic","diskFreePct":15,"tempC":80,"memoryUsedPct":90,"backupMaxAgeHours":48,"cooldownMinutes":360,"repeatHours":24,"checkIntervalSeconds":300,"lastEvaluatedAt":null } }
```

- 每条事件增加只读 `deliveries`。没有 `external_alert_deliveries` 行时为 `null`。有行时 `webhook` 与 `qq` 各自为 `{status,attempts,nextAttemptAt,error}`，缺该通道时为 `null`。`status` 取 `pending|done|dead|skipped`。`error` 已脱敏。本接口不提供重投。`deliveredAt` 与 `deliveryError` 保持原字段。
- 主机条件的 `firing`、`resolved`、`unknown` 及周期重通知，与两条通道任务在同一 SQLite 事务提交。Webhook 最多同时处理 2 条，失败退避 1 秒、2 秒，最多 3 次，重试沿用同一 `Idempotency-Key`。同一条件、同一通道按事件顺序投递，前序进入 `done`、`skipped` 或 `dead` 后再处理后序。`status='event'` 不参与该顺序。通道关闭或没有可通知目标时插入即为 `skipped`。进程关闭时先停止评估和领取，再等待在途请求。不回补本版之前的历史事件。
- `POST /api/alerts/test`（会话 + CSRF，10 次/小时）→ `{ok:true,delivered:boolean,message?}`；未配置 webhook 返回 200 `{ok:false,delivered:false,message:"未配置 webhook URL"}`。测试仍直接投递，不写投递箱。
- Webhook 请求体 `{source,version,event,severity,status,title,message,details,at}`；可选 HMAC 头 `x-antifieldcloud-signature: sha256=<hex>`；10s 超时、最多 3 次尝试。
- 告警条件：磁盘、温度、内存（默认 90%）、服务、备份超期、pending 备份、备份密钥包、MC、欠压（health probe JSON）、世界备份/世界拉取/恢复演练超期与异地副本超期（`offsite_overdue`）；同状态去重/冷却，恢复时发 resolved。`status` 可能为 `unknown`（连续 3 次数据源不可用后降级并产生一次事件）；`alert_events` 保留 90 天。
  `config` 含 `offsiteMaxAgeHours`（小时，0 表示关闭；状态文件缺失/未配置时该条件不进入列表，不误报）；`status` 字段另含世界备份/拉取/演练阈值。
- 外部事件告警（v0.8.0，mcbot）：上游 `alert` 事件由服务端映射为 `status='event'` 写入 `alert_events`，**不写 `alert_state`、不参与 firing/resolved 状态机、不产生恢复通知**；`severity`：已知类型（low_health/chest_full/defense_retreat → warning，task_failed/disconnected → critical），未知类型上游 `severity='error'` 为 critical，否则 warning；`event` 名为 `mcbot_low_health`/`mcbot_task_failed`/`mcbot_disconnected`/`mcbot_chest_full`/`mcbot_defense_retreat`/`mcbot_alert`（未知），`details` 含 `source:"mcbot"`、`mcbotEventId`、`mcbotType` 与清洗后的上游 details（深度≤2、键≤20、数组≤20、字符串≤300）。写入与两条通道任务在同一事务，随后由投递箱处理，不阻塞请求；`ALERTS_ENABLED=false` 时不写库/不投递。schema v19 起 mcbot 告警带 `dedupe_key=mcbot:<bootId>:<eventId>`（各段去空白、拒绝控制字符、截断后拼接）。同一键再次写入返回已有 id，不新增行、不重复 webhook、不重复入队。空键或纯空白键视为无键，各自插入且 `dedupe_key` 为 NULL。
- 服务条件在 `MCBOT_ENABLED=true` 时包含 mcbot。systemd 为 `inactive`/`failed`，或轮询快照 `enabled && stale`，都记为 inactive 并走既有 `service_down`。单次失败且 `stale=false` 不触发。恢复后写 `resolved`，`alert_state` 回到 `ok`。这不把上游 `alert` 升格为 firing。

## 11. 备份管理 / 文件级恢复

全部需要会话；写操作需 CSRF；危险操作另需 TOTP（body `totpCode` 或请求头 `X-TOTP-Code`）和 typed confirmation。整库恢复不通过 Web 执行。

- `GET /api/backups` → `{items:[Archive],inbox,orphans,state,world,worldPull,drill}`。Archive 含 `name/mode/createdAt/sizeBytes/sha256/status/origin/available/verifiedAt/pulledAt/ackedAt/lastError/manifest/encrypted`；`available=false` 表示服务端文件已被 PC ack 清理（acked 后正常），此状态不可用于恢复；`encrypted=true` 表示 age 加密归档（Web 不可校验/恢复）；不返回归档路径或下载 URL。`world`/`worldPull`/`drill` 为只读状态对象（见 §12），`state` 可含 `pendingBytes/ackedBytes/encryptedPendingCount/encryptedAckedCount` 统计（缺失时前端按 0 降级）。
- `POST /api/backups/prepare` body `{totpCode,full?,confirmText:"PREPARE"}`（3 次/小时）→ 只生成 Pi pending 归档，不 ack、不推进游标；输出可带 `warnings`/`skippedMissing`/`missingFiles`/`missingFileCount`/`partials`，加密开启时另带 `encrypted:true/archiveFormat:"tar.gz.age"/metaName/plainSha256/plainSize`（明文哈希只在 sidecar/DB，不在加密归档内）。超时由 `BACKUP_PREPARE_TIMEOUT_SEC`（默认 3300s）控制；加密开启时 age/公钥/空间任一不满足即失败关闭（不产生 pending、不降级明文）。TOTP 失败写审计 `backup_reauth_failed`。
- `POST /api/backups/import`（multipart 字段 `file`，TOTP 走 `X-TOTP-Code`；10 次/小时）→ 201 `{archive,verify,warnings?}`。归档名必须匹配 `^snapshot-[0-9TZ]+(?:-[0-9]+)?-(full|inc)\.tar\.gz$`（明文）或 `…\.tar\.gz\.age$`（加密，**导入返回 409 `archive_encrypted`**）；落盘 `DATA_DIR/backups/imports` 0700，拒绝覆盖；单请求 ≤ min(MAX_UPLOAD_BYTES, 100 MiB)。导入归档（origin=import）不计入 pending，也不影响 Pi 增量水位。
- `POST /api/backups/verify` body `{name}` → 流式 SHA-256 + tar 安全解析；**加密归档（`.age`）在名称校验之前返回 `409 archive_encrypted`**（Pi 无私钥）；明文归档错误：409 checksum_mismatch、422 invalid_archive/unsafe_archive、404 archive_not_found；校验失败会清除 `verified_at/manifest_json` 并记录 `last_error`。
- `GET /api/backups/archives/:name/entries?path=/` → `{path,items,truncated}`，用于恢复选择；仅已校验明文归档；`.age` 返回 `409 archive_encrypted`；30 次/分钟/IP，超出 429；只返回 `origin='user'` 的普通文件（笔记附件/系统文件不参与恢复）。
- `POST /api/backups/restore-plan` body `{archive?,paths?,targetName?,totpCode,confirmText:"RESTORE"}` → `{plan}`；校验 full+inc 链、空间/配额、文件数上限；计划 30 分钟过期。不指定归档时**自动恢复目标跳过 `.age`**；指定 `.age` 或链中含 `.age` 返回 `409 archive_encrypted`。计划会剔除链 manifest 中 `skippedMissing` 的文件并返回 `plan.skippedMissing: string[]`；选择全部缺失时 `400 invalid_selection`。
- `POST /api/restores/:planId/execute` body `{totpCode,confirmText:"RESTORE"}` → `{plan,result}`；只恢复文件内容到**新文件夹**（新 ID，不覆盖），单并发/锁；`410 plan_expired`、`409 restore_busy/plan_completed`；`result.filesRestored/bytesRestored/durationMs/skippedMissing`，其中 `result.skippedMissing` 列出执行时仍缺失、已跳过未恢复的文件 ID，非空时不能视为完整恢复。启动/维护会清理崩溃遗留的陈旧 `restore.lock`。
- `GET /api/restores/:planId` → `{plan}`（用于恢复向导刷新/断网后继续轮询）。
- 错误码：`archive_encrypted` 409（加密归档 Web 不可操作）、`restore_disabled` 403、`archive_not_verified`/`archive_chain_invalid` 409、`invalid_selection`/`confirmation_failed` 400、`invalid_totp` 401、`restore_too_many_files` 400。
- 归档导入的信任边界：归档来自管理员（TOTP 门禁），但 tar 仍按不可信输入校验路径穿越/链接/设备/超大条目；不提供归档下载。schema v16 启动时会拒绝高于支持版本的数据库（迁移 5–16 保留；本版无新迁移）。
- 整库恢复：不在 Web API 内，按 `docs/BACKUP.md` §8.1 的离线 root 手工流程执行（停服、解包校验、替换数据、pre-restore 备份与失败回滚）；加密归档必须先在 PC 用离线私钥解密，再按同流程恢复。

## 12. 可观测性与备份状态

### GET /api/metrics

需要会话。查询参数 `range`：`1h|6h|24h|7d|30d`（默认 `24h`）；非法值 `400 invalid_range`。

```json
{
  "range": "24h",
  "from": "2026-10-19T00:00:00.000Z",
  "to": "2026-10-20T00:00:00.000Z",
  "bucketSeconds": 360,
  "sampleCount": 240,
  "series": [
    {
      "ts": "2026-10-19T00:06:00.000Z",
      "cpuPercent": 12.3,
      "memUsedBytes": 123456,
      "memTotalBytes": 8000000000,
      "memUsedPct": 42.1,
      "tempC": 48.2,
      "diskFreeBytes": 30000000000,
      "diskTotalBytes": 62000000000,
      "diskFreePct": 48.4,
      "load1": 0.21
    }
  ]
}
```

- 服务端按桶聚合：CPU/内存/温度取平均、磁盘剩余取最小值、load1 取平均；最多 240 点；`bucketSeconds = ceil(范围秒 / 240)`（1h=15、24h=360、7d=2520、30d=10800）；`tempC` 不可得时为 `null`。
- 采样周期由 `METRICS_SAMPLE_SECONDS` 控制（默认 60），保留 `METRICS_RETENTION_DAYS` 天（默认 30）；关闭采样时历史查询仍可用。

### 告警与审计筛选

- `GET /api/alerts?limit=20&offset=0&event=&status=&severity=` → `{items,total,state,config}`；`status` 取值 `firing|resolved|unknown|event`（`event` 为 mcbot 等外部服务的事件记录），`event` 为条件名，全部参数可选。`items[].deliveries` 见 §10，分页与旧字段不变。
- `GET /api/audit?limit=50&offset=0&action=&q=&from=&to=` → `{items,total}`；`q` 对 action/target/ip 做转义 LIKE 搜索；`from/to` 为 ISO 时间；参数可选。

### 备份状态对象

`GET /api/dashboard` 的 `backup` 与 `GET /api/backups` 的 `world`/`drill` 使用只读状态文件，文件缺失时字段为 `null`：

```json
{
  "world": {
    "lastRunAt": "2026-10-20T20:00:00.000Z",
    "ok": true,
    "archiveName": "world-20261020T200000Z.tar.gz",
    "sizeBytes": 3200000000,
    "sha256": "…",
    "durationMs": 240000,
    "kept": ["world-20261020T200000Z.tar.gz"],
    "keptCount": 1,
    "error": null,
    "message": null
  },
  "worldPull": {
    "lastPullAt": "2026-10-20T21:00:00.000Z",
    "ok": true,
    "archiveName": "world-20261020T200000Z.tar.gz",
    "archiveNames": ["world-20261020T200000Z.tar.gz"],
    "pulledCount": 1,
    "kept": ["world-20261020T200000Z.tar.gz"],
    "keptCount": 1,
    "pendingRemaining": 0,
    "error": null,
    "message": null
  },
  "drill": {
    "lastRunAt": "2026-10-20T12:00:00.000Z",
    "ok": true,
    "report": "20261020T120000Z",
    "latestDb": "db-20261020T120000Z.sqlite",
    "schemaVersion": 20,
    "worldChecked": true,
    "error": null,
    "message": null
  },
  "offsite": {
    "lastRunAt": "2026-10-24T05:00:00.000Z",
    "ok": true,
    "remoteLabel": "myremote",
    "uploaded": 1,
    "skipped": 0,
    "failed": 0,
    "bytes": 123456,
    "keptRemote": 12,
    "plaintextSkipped": 0,
    "error": null
  }
}
```

字段说明：`world.kept`/`worldPull.kept` 是归档名数组，份数看 `keptCount`；`world.kept` 是“上次运行保留”，PC 拉取校验并 ack 后远端归档会被删除，不代表 Pi 当前仍有该数量；`drill.reportPath`/`dbIntegrity` 仅为旧状态文件兼容字段，当前脚本写 `report/latestDb/schemaVersion/worldChecked`。
`offsite`：缺失为 `null`（未配置，不告警）；只含远端别名 `remoteLabel` 与计数/时间/错误，不含远端真实路径/URL/凭据；`plaintextSkipped>0` 表示有明文归档被拒绝上传（安全信号）。

`GET /api/dashboard` 的 `backup` 始终返回对象（部分字段可为 `null`）：`lastPullAt/ageHours/sizeBytes/ok/overdue/lastError`，另含 `pendingCount/pendingBytes/orphanCount/ackedBytes`、`encryptedPendingCount/encryptedAckedCount`、`encryption{enabled,keyConfigured}`、`world/worldPull/drill/offsite`。状态文件由 root 世界备份脚本与 PC 拉取/演练/异地脚本写入，应用只读；不含密钥。

## 13. 笔记附件与版本历史

附件计入总配额，但不出现在普通文件列表/搜索/回收站；只能通过笔记接口管理与访问。

- `GET /api/notes/:id` → Note 增加 `attachments:[{fileId,name,size,mime,url}]`；`url` 为 `/api/files/<fileId>/content?inline=1`（栅格图片可内联，其它类型浏览器按下载处理）。
- `POST /api/notes/:id/attachments`（multipart，字段 `files`，1–5 个文件）→ `200 {items:[Attachment]}`；单文件 ≤ `NOTE_ATTACHMENT_MAX_BYTES`（默认 25 MiB），每笔记 ≤ `NOTE_MAX_ATTACHMENTS`（默认 100）；超限 `413 file_too_large`、配额不足 `409 quota_exceeded`、磁盘不足 `507 insufficient_storage`、非法名 `400 invalid_name`。
- `GET /api/notes/:id/attachments` → `{items:[Attachment]}`。
- `DELETE /api/notes/:id/attachments/:fileId` → `{ok:true}`（硬删除并释放配额；不进入回收站）。
- `GET /api/notes/:id/versions?limit=20&offset=0` → `{items:[{id,title,createdAt}],total}`。
- `GET /api/notes/:id/versions/:versionId` → `{version:{id,noteId,title,bodyMd,tags,createdAt}}`；跨笔记版本 `404 not_found`。
- `POST /api/notes/:id/versions/:versionId/restore` → 200 Note（恢复前自动保存当前版本快照）。
- 版本在标题/正文/标签变化时自动生成，每笔记保留最近 `NOTE_VERSIONS_KEEP`（默认 20）条；删除笔记级联删除版本与附件。

## 14. Bot 平台

Workbench 不再提供 QQ 管理、Webhook、发布或 OpenCode Chat。这些路径不存在。生产 QQ 由 DSH 管理。告警投递只有 `webhook`。

## 15. mcbot Bot 对接

mcbot 是独立的 Minecraft 附属 Bot 服务（仅监听 `127.0.0.1:3010`）。应用轮询只读接口，并代理管理员对话、在线模式、停止和急停。浏览器不直连 mcbot，服务端不下发 Token 或 URL。目标上游为 mcbot **v1.2.4**，只接受契约 v2。非 v2 的读取拒绝。这些端点都要会话，写操作还要 CSRF。凭据与响应边界见 `docs/SECURITY.md`。

### 通用语义

- 启用：`MCBOT_ENABLED=true` 且配置 `MCBOT_READ_TOKEN`（启动校验：`MCBOT_URL` 必须为 `http(s)://loopback[:port]` 根地址，拒绝 userinfo/路径/查询/片段）；控制：`MCBOT_CONTROL_TOKEN` 非空。
- 关闭：`MCBOT_ENABLED=false` 时 `GET /api/mcbot/status` 返回 `enabled:false` 空壳。其余端点返回 `503 mcbot_disabled`。
- 只读：控制 Token 为空时，管理员对话、急停、在线模式、`POST /tasks/stop` 与 `POST /autonomy/stop` 返回 `503 mcbot_control_disabled`。`/status`、自主快照和对话读取仍可用。
- 轮询：服务端每 `MCBOT_POLL_MS`（默认 5000，2000–60000）拉一次 `/status` + `/events/recent?limit=200`（覆盖一次突发，避免只看 100 条漏告警）；单飞（不并发/不堆积）；失败只更新 `reachable/stale/error` 并保留上次成功数据。
- 限流：仍开放的控制类（在线模式、停止任务、停止自主会话、急停）**20 次/分钟/IP**，管理员对话 **10 次/分钟/IP**；`/status`、`/autonomy`、`/chat`、`/presence` 的 GET **60 次/分钟/IP**；超限 `429 rate_limited` 并带 `Retry-After`。
- 审计：`mcbot.task.stop`、`mcbot.autonomy.stop`（只记原因字符数）、`mcbot.presence.set`（只记模式）、`mcbot.chat`（只记 `chars`）、`mcbot.emergency_stop`（只记失败腿名）、失败 `mcbot.control_failed`（只记稳定错误码）。不记录对话正文、步骤、Token、URL。
- 错误映射：上游 400/409 保留状态码，`error.code=mcbot_<上游稳定码>`（如 `mcbot_chat_busy`/`mcbot_task_rejected`）；上游 401/403 → `502 mcbot_auth_failed`；上游 429 → `429 mcbot_rate_limited`；上游 5xx 的 `task_disabled`/`control_disabled`/`admin_unavailable` 保留为 `503 mcbot_<code>`；其它上游错误/非 JSON/超限 → `502 mcbot_upstream_error`；禁用/不可达/控制未启用 → `503 mcbot_disabled`/`mcbot_unavailable`/`mcbot_control_disabled`/`mcbot_not_found`。`message` 为固定中文兜底，不含上游原文/地址/Token。

### GET /api/mcbot/status

需要会话。返回聚合快照（禁用时为空壳）：

```json
{
  "enabled": true,
  "reachable": true,
  "stale": false,
  "controlEnabled": true,
  "sayEnabled": true,
  "alertsEnabled": true,
  "eventsSupported": true,
  "version": "1.0.9",
  "contractVersion": 2,
  "lastPollAt": "2026-10-27T09:00:00.000Z",
  "lastSuccessAt": "2026-10-27T09:00:00.000Z",
  "error": null,
  "eventGap": null,
  "status": { "version": "1.0.9", "contractVersion": 2, "uptimeSec": 123, "state": "connected", "minecraft": { "connected": true, "username": "lofii" }, "player": { "health": 20, "food": 20 }, "server": { "reachable": true, "online": 1, "max": 6 }, "task": { "enabled": true, "active": false, "name": null, "state": "idle", "pendingResume": null, "queue": [] }, "admin": { "rcon": true, "tps": { "one": 19.9, "five": 19.8, "fifteen": 19.7 } } },
  "events": [ { "id": "036e732d-10", "type": "presence", "ts": "2026-10-27T08:59:58.000Z", "data": {} } ]
}
```

- `status`：上游 `/status` 快照（只接受契约 v2；示例里的版本号只说明字段形状），不含 Token/记忆正文；**不承诺固定字段**，前端对缺失嵌套段（`task`/`admin`/`ai`/`memory`/`minecraft`/`player`/`server`）安全读取并显示“—”，不会整页崩溃。
- `stale`：连续 3 个轮询周期无成功或距上次成功超过 3 个周期；`reachable=false` 时保留最后一次成功快照。
- `eventsSupported`：上游是否提供 `/events/recent`（旧版 404 时 false）；字段缺失/`undefined` 时前端**不把 undefined 当作支持**，回退为按 `contractVersion`（仅 number 有效）或已有事件数组判断；`contractVersion` 仅接受 number（否则显示“—”，不显示 `vundefined`）。
- `events`：内存环最近事件，**newest-first，最多 100 条且序列化总字节 ≤512 KiB**；服务端重启清空；不写入 DB/日志。
- `error`：稳定错误码（如 `mcbot_unavailable`/`mcbot_auth_failed`/`mcbot_cursor_failed`/`mcbot_upstream_error`），不是上游原文。**`reachable=true` 时 `error` 仍可能非空**（如 `/status` 成功但 `/events/recent` 失败或游标写库失败），前端必须展示可见警告，不得把“可达”等同于“事件/告警正常”。
- `lastPollAt` 为最近一次轮询**尝试**时间，失败也会更新。`lastSuccessAt` 只在 `/healthz` 契约与 `/status` 核心字段通过校验后更新；从未成功为 `null`。面板过期文案用 `lastSuccessAt`，null 时显示“尚无成功轮询”。
- `navigation` 可选。v1.0.7 起含 `lastFallbackReason`（最近一次兜底原因，≤160 字符）；无兜底或旧版缺字段时为 `null`。该短文本只给面板，不进入自主提示。
- `eventGap`：同一 `bootId` 下，最早可用事件序号超过已确认游标加 1 时为 `{bootId,fromSeq,toSeq,discoveredAt}`。只记录一次，`discoveredAt` 保持首次发现时间，游标越过空洞后仍保留。写入独立 meta `mcbot.event_gap`。首次连接、`bootId` 变化和单纯网络失败不新记缺口；`bootId` 变化不清掉已有缺口。集成关闭时为 `null`。契约版本不变。
- 游标/告警重试：`recordExternal` 写告警失败时游标停在上一条**已完整处理**的事件，下一轮重新处理失败事件。同一 `dedupe_key` 再次写入视为已处理，游标可以前进，且不再通知。`MCBOT_ALERTS_ENABLED=false` 时仍推进游标但不写告警。

### GET /api/mcbot/autonomy（v1.0.2）

需要会话 + GET 60/min 限流。返回 `{ "autonomy": { ... } }`；上游 mcbot 未启用自主模式时 `autonomy.enabled=false`。旧版 mcbot 无 `/autonomy` 时返回稳定上游错误（应用降级为无自主卡）。

应用不再提供 `POST /api/mcbot/autonomy/start`、`GET /api/mcbot/goals`、`POST /api/mcbot/goals`、`POST /api/mcbot/goals/:goalId/:action`、`POST /api/mcbot/tasks`、`POST /api/mcbot/tasks/resume`、`POST /api/mcbot/move`、`POST /api/mcbot/say` 和 `GET /api/mcbot/history`。这些路径不存在。游戏内口令仍可使用 mcbot 本机对应入口。

### POST /api/mcbot/autonomy/stop（v1.0.2）

需要会话 + CSRF + 控制 20/min。body 可为 `{}` 或 `{ "reason": "..." }`（≤200、无控制字符）；幂等。成功 **200** `{ "ok": true, "autonomy": { ... } }`。

### GET /api/mcbot/presence（v1.0.5）

需要会话 + GET 60/min 限流；返回 `{ "presence": { "mode": "auto|always|off", "source": "default|env|persisted", "updatedAt": "...", "connected": true, "lastDecision": "..." } }`。

### POST /api/mcbot/presence（v1.0.5）

需要会话 + CSRF + 控制 20/min；body `{ "mode": "auto|always|off" }`。成功 200 `{ "ok": true, "presence": ... }`；任务/自主会话运行中切 `off` 返回 `409 mcbot_presence_busy`；控制未启用 503；审计只记模式。

### GET /api/mcbot/status（v1.0.2 增量）

新增可选 `autonomy` 字段（`normalizeAutonomy` 归一化；旧版缺失为 `null`）；`status.autonomy` 与上游 `/status.autonomy` 一致。前端对未知 state 保留字符串并 label 兜底，不丢弃。
### POST /api/mcbot/tasks/stop

需要会话 + CSRF，body 可为空。成功 `200 { "ok": true, ... }`（中断当前任务并清空队列；只有 pending 时取消 pending 与队列）。无任务 → `409 mcbot_no_active_task`。

### GET /api/mcbot/chat（v1.2.3）

需要会话 + GET 60/min。关闭时 `503 mcbot_disabled`。返回 mcbot 内存中的 `{ "messages", "turn", "steps" }`。`turn` 为 `{ "id", "status": "pending|ok|error", "error" }` 或 `null`。每条消息含 `id`、`role`（`user` 或 `assistant`）、`text`、`at`，最多 40 条。`steps` 最多 80 条，种类只有 `user`（`text`）、`assistant`（`text`）、`tool`（`name` 与 `status: ok|error`）、`goal`（`action` 与最多 120 字的 `title`）、`todo`（`action` 与最多 120 字的 `title`）。工具名只来自现有 13 个 mcbot 工具。不返回工具参数、令牌、提示词或世界记忆正文。正文和步骤不进 SQLite，不进审计，重启即丢失。急停清空步骤。

### POST /api/mcbot/chat（v1.2.3）

需要会话、CSRF、控制 Token，以及发言限流 10 次/分钟/IP。body `{ "message": "1..2000 字符" }`。允许 ASCII `/`，拒绝 C0 与 DEL（`400 invalid_request`）。关闭时 `503 mcbot_disabled`，无控制 Token 时 `503 mcbot_control_disabled`。成功 **200** `{ "ok": true, "turnId": "...", "status": "pending" }`。mcbot 本机接受为 202，应用返回该 JSON，不把公网请求挂到模型的长等待上。上一轮未完成时 **409** `mcbot_chat_busy`，消息「上一条对话还在处理，请稍后再发」。对话不可用时 **503** `mcbot_admin_unavailable`。审计 `mcbot.chat` 只记 `{ "chars" }`。同一管理员会话会复用，以便 goal 与 todo 保持；30 分钟空闲、急停或进程退出后删除。

### POST /api/mcbot/emergency-stop（v1.2.3）

需要会话、CSRF、控制 Token，以及控制限流 20 次/分钟/IP。不调用模型。依次停止活动自主会话、打断目标并停止活动任务或待恢复、关闭管理员对话，并清空会话步骤。某一腿失败时继续其余腿。空闲算成功。返回 `{ "ok": true|false, "failures": ["task"|"autonomy"|"admin"] }`。审计 `mcbot.emergency_stop` 只记 `failures`。`POST /api/mcbot/tasks/stop` 与 `POST /api/mcbot/autonomy/stop` 仍单独可用，空闲任务停止仍是上游的 `409 mcbot_no_active_task`。

### 事件与告警

- `/events/recent` 事件 envelope `{id,type,ts,data}`；`type` 已知 `presence|task|chat|movement|alert`，`data` 形状随类型变化且视为不可信输入，前端只读取白名单字段并纯文本渲染；查表一律 own-property，避免 `__proto__`/`constructor` 命中原型链。
- 轮询每轮向上游取最近 **200** 条（覆盖一次突发；上游 ring 500），合并进内存缓存时按 id 去重、newest-first、最多 100 条且总字节 ≤512 KiB。
- `alert` 事件映射为本应用告警事件（`status='event'`），映射与字段见 §10；告警游标保存在 `meta.mcbot.event_cursor={bootId,lastEventId,lastTs}`，首次/重启/`bootId` 变化只建基线不重放；`MCBOT_ALERTS_ENABLED=false` 仍推进游标但不写告警；告警写入失败时游标停在上一条已处理事件并在下一轮重试（不静默丢告警）。
- 聊天事件只进服务端内存事件缓存（≤100 条/≤512 KiB），不提供历史查询、不持久化、不写日志/审计正文；应用重启或 mcbot 重启即丢失。


## Minecraft Bot 本机契约

Bot 只监听回环地址。读 Token 与控制 Token 分离。下面的路径是 mcbot 自己的路径，不是 Workbench 的 `/api/mcbot`。

## 1. 基础信息

| 项目 | 值 |
|---|---|
| Base URL | `http://127.0.0.1:3010`（仅回环，不对外） |
| 读 Token | `HTTP_TOKEN`，用于 `/status`、`/presence`、`/goals`、`/task`、`/events`、`/events/recent`、`GET /admin/chat` |
| 控制 Token | `HTTP_CONTROL_TOKEN`，用于 `/task/*`、`POST /move`、`POST /say`、`/presence`、`/goals*`、`/autonomy/start|stop`、`POST /admin/chat`、`POST /emergency-stop` |
| 契约版本 | `CONTRACT_VERSION=2`，由 `/healthz`、`/status` 与 `/events/recent` 的 `contractVersion` 返回 |
| Token 位置 | Pi：`/etc/mcbot/env`（root:mcbot 0640） |
| 数据格式 | JSON / SSE，UTF-8 |
| 请求体上限 | 8 KiB |
| 自主工具 | 生产由 DSH 插件经私有 Unix socket 调用。配置 `DSH_AGENT_SOCKET` 后 `/autonomy/mcp` 返回 404。未配置时该路径只接受当前会话随机 Bearer，不暴露给应用/浏览器 |
| MCP 工具发现 | `AUTONOMY_MCP_WARMUP_MS=3000`：运行时注册后等待 OpenCode 刷新工具列表再创建 session |
| `/say` 限流 | 10 次/分钟（进程内） |
| 控制接口限流 | 30 次/分钟（`CONTROL_RATE_LIMIT`） |
| 鉴权头 | `Authorization: Bearer <token>`；不支持 URL query token |

读/控制 Token 必须分离。用读 Token 调控制接口返回 401；用控制 Token 调读接口返回 401。控制 Token 为空时，控制接口返回 503 `control_disabled`，读接口不受影响。

```bash
READ="$(sudo grep '^HTTP_TOKEN=' /etc/mcbot/env | cut -d= -f2-)"
CTRL="$(sudo grep '^HTTP_CONTROL_TOKEN=' /etc/mcbot/env | cut -d= -f2-)"
```

## 2. GET /healthz

无需鉴权。

```json
{
  "status": "ok",
  "version": "1.0.9",
  "contractVersion": 2,
  "uptimeSec": 123,
  "state": "connected",
  "connected": true
}
```

`state`：`idle` / `connecting` / `connected` / `backoff` / `cooldown`。动态模式下 `idle` 是正常状态（无玩家在线）。

`contractVersion` 为只读契约版本（当前 `2`），与 `/status`、`/events/recent` 返回值一致；新增可选字段不升版本，破坏性变更才递增。契约 v2 把发言划入控制 Token。

## 3. GET /status

需要读 Token。返回完整快照；v0.2 字段保持兼容，`task` 增加 `pendingResume`。

```json
{
  "version": "1.0.9",
  "contractVersion": 2,
  "uptimeSec": 123,
  "state": "connected",
  "minecraft": {
    "connected": true,
    "username": "lofii",
    "host": "127.0.0.1",
    "port": 25565,
    "version": "26.1",
    "reconnects": 0,
    "lastDisconnect": null
  },
  "player": {
    "dimension": "主世界",
    "position": { "x": 204.5, "y": 63, "z": 469.5 },
    "health": 20,
    "food": 20
  },
  "server": {
    "reachable": true,
    "online": 1,
    "max": 6,
    "versionName": "Paper 26.1.2",
    "motd": "Raspberry Pi 5 | Minecraft LAN",
    "latencyMs": 5,
    "lastPingAt": "2026-10-26T13:25:01.000Z"
  },
  "presence": {
    "enabled": true,
    "mode": "auto",
    "modeSource": "default",
    "modeUpdatedAt": null,
    "pollMs": 15000,
    "graceMs": 60000,
    "checkMs": 5000,
    "otherPlayers": 0,
    "lastDecision": "connected"
  },
  "survival": { "enabled": true, "lastRunAt": "2026-10-26T13:25:00.000Z", "lastAction": "idle", "lastError": null },
  "navigation": {
    "state": "idle",
    "source": "planner",
    "attempts": 1,
    "lastFailureKind": null,
    "lastFallback": null,
    "aiUsed": false,
    "updatedAt": "2026-10-30T12:00:00.000Z"
  },
  "ai": { "enabled": true, "provider": "opencode-go", "model": "deepseek-v4.1-flash", "inFlight": 0, "queued": 0, "failures": 0, "lastLatencyMs": 2359, "lastError": null },
  "memory": { "players": 1, "turns": 2 },
  "task": {
    "enabled": true,
    "active": true,
    "name": "fishing",
    "state": "running",
    "startedAt": "2026-10-26T13:22:43.689Z",
    "elapsedSec": 170,
    "progress": {
      "fishCaught": 5, "wheatHarvested": 0, "planted": 0, "deposited": 0,
      "treesChopped": 0, "logsChopped": 0, "saplingsPlanted": 0, "mobsKilled": 0,
      "oresMined": 0, "coalMined": 0, "ironMined": 0, "copperMined": 0,
      "forestTreesChopped": 0, "naturalLogsChopped": 0, "naturalSaplingsPlanted": 0,
      "sleepVotes": 0, "nightSkipped": 0, "patrolWaypoints": 0, "patrolDistance": 0
    },
    "failures": 0,
    "lastError": null,
    "pendingResume": null,
    "queue": []
  }
}
```

`task.state`：`idle` / `starting` / `running` / `depositing` / `recovering` / `stopping` / `defending` / `pending_resume`。

有待恢复任务时：

```json
"task": {
  "enabled": true,
  "active": false,
  "name": "fishing",
  "state": "pending_resume",
  "startedAt": "2026-10-26T13:22:43.689Z",
  "elapsedSec": 137,
  "progress": {
    "fishCaught": 4, "wheatHarvested": 0, "planted": 0, "deposited": 0,
    "treesChopped": 0, "logsChopped": 0, "saplingsPlanted": 0, "mobsKilled": 0
  },
  "failures": 0,
  "lastError": null,
  "pendingResume": {
    "taskId": "46451943-eae1-41c0-8df3-beef3c7b60f4",
    "name": "fishing",
    "startedAt": "2026-10-26T13:22:43.689Z",
    "elapsedSec": 137,
    "progress": { "fishCaught": 4, "wheatHarvested": 0, "planted": 0, "deposited": 0, "treesChopped": 0, "logsChopped": 0, "saplingsPlanted": 0, "mobsKilled": 0 },
    "expiresAt": "2026-10-26T13:35:00.619Z"
  },
  "queue": [
    { "taskId": "...", "name": "farming", "requestedBy": "panel", "requestedAt": "2026-10-26T13:25:00.000Z" }
  ]
}
```

- `minecraft.connected` 是 Bot 自身是否已 spawn；`server.online` 是服务器在线人数（Bot 在线时包含 Bot）。
- `presence.otherPlayers` 不含 Lofii。
- `ai.lastError` 已截断，不含提示词或密钥。
- 不暴露记忆内容、Token、OpenCode 密码。
- 401：`{"error":"unauthorized","message":"..."}`。

## 4. GET /task

需要读 Token。返回当前任务（与 `/status.task` 一致，含 `pendingResume` 与 `queue`）。

```json
{ "task": { "...": "..." } }
```

## 5. GET /events（SSE）

需要读 Token；仅支持 `GET`。

```http
GET /events HTTP/1.1
Authorization: Bearer <HTTP_TOKEN>
Accept: text/event-stream
Last-Event-ID: <bootId>-<seq>   # 可选
```

响应头：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

连接后先发 `retry: 5000`，再发 `hello`；每 15 秒发 `: ping` 注释。最多 8 个并发客户端（`SSE_MAX_CLIENTS`），超过返回 503。

### 5.1 事件 envelope

```json
{
  "id": "036e732d-10",
  "type": "task",
  "ts": "2026-10-26T13:24:14.828Z",
  "data": {}
}
```

SSE 帧的 `id` 字段即 envelope `id`；`event` 字段为 `hello` / `task` / `chat` / `presence` / `movement`。

### 5.2 hello

`hello` 的 `data` 直接是快照：

```json
{
  "version": "1.0.9",
  "bootId": "036e732d",
  "lastEventId": "036e732d-10",
  "resync": false,
  "snapshot": { "...StatusSnapshot..." }
}
```

- `Last-Event-ID` 属于当前 `bootId` 且在 ring（500 条）内：回放该 ID 之后的事件。
- `bootId` 不同、ID 过旧、非法：`resync: true`；面板应重新拉 `/status` 与 `/task`。
- SSE 是内存 ring，进程重启后清空；不要把 SSE 当持久消息队列。

### 5.3 task

```json
{
  "action": "started|progress|depositing|recovering|stopping|stopped|completed|failed|resume_required|resumed|interrupted|queued|queue_started|queue_cleared|defending|alert",
  "task": { "...TaskSnapshot..." }
}
```

### 5.4 chat

只发 Lofii 对话：

```json
{ "direction": "in", "username": "Antifield", "message": "Lofii 去钓鱼", "source": "chat" }
{ "direction": "out", "source": "ai|command|task|proactive|movement|http", "text": "好，我去钓鱼啦。", "lines": ["好，我去钓鱼啦。"] }
```

- `in` 仅被点名/唤醒的消息；无关公屏不发。
- `out` 是 Lofii 的回复/任务/主动消息；`source` 用于面板筛选。
- 不包含记忆全文、Token、密码。

### 5.5 presence

```json
{
  "state": "connected",
  "connected": true,
  "otherPlayers": 0,
  "lastDecision": "connected",
  "taskActive": true,
  "taskName": "fishing",
  "taskState": "running"
}
```

状态变化时最多约 2 秒内推送。

### 5.6 movement

```json
{ "action": "home|come|follow|stop", "target": "Antifield", "status": "started|completed|failed", "error": null, "requestId": "..." }
```

`follow` 只发 `started`；`/move stop` 时发 `stop` 的完成事件。

## 6. GET /events/recent（只读轮询）

需要读 Token；仅支持 `GET`。读取内存事件 ring 的最近事件，用于面板后端低频轮询或 SSE 断线后的补拉；**不替代 SSE**，事件不持久化。

```http
GET /events/recent?limit=50 HTTP/1.1
Authorization: Bearer <HTTP_TOKEN>
```

| 参数 | 默认 | 约束 |
|---|---|---|
| `limit` | `50` | 十进制整数 1–200；非整数、0、201、空值均返回 400 |

成功（200）：

```json
{
  "contractVersion": 2,
  "bootId": "036e732d",
  "lastEventId": "036e732d-10",
  "events": [
    { "id": "036e732d-9", "type": "task", "ts": "2026-10-26T13:24:12.000Z", "data": {} },
    { "id": "036e732d-10", "type": "presence", "ts": "2026-10-26T13:24:14.828Z", "data": {} }
  ]
}
```

- `events` 按发生顺序（旧 → 新）升序排列，最多 `min(limit, ring 内事件数)` 条；ring 为空时 `events: []`、`lastEventId: null`。
- 事件 envelope 与 SSE 一致（`id/type/ts/data`），但**不含 `hello`**；`contractVersion` 当前为 `2`。
- `bootId` 与 `lastEventId` 用于增量判断：`bootId` 变化说明进程重启，面板应重新拉 `/status`/`/task`；`lastEventId` 可保存用于去重或作为 SSE `Last-Event-ID` 的参考。
- 错误：401 `unauthorized`（缺失/错误 Token；控制 Token 不适用）；400 `invalid_request`（`limit` 非法）；405 `method_not_allowed`（非 GET）。
- 只读接口：不改 ring、不产生事件、不写审计；`/events`（SSE）行为不变。

## 7. 控制接口

本机任务、移动、游戏发言和自主启动仍给游戏内口令与内部调用使用。Workbench 面板不再代理其中的开始、移动和发言。

### 7.0 GET /admin/chat 与 POST /admin/chat

`GET` 使用读 Token，返回 `{ messages, turn, steps }`。消息最多 40 条，步骤最多 80 条，只在进程内存。步骤只含用户文本、助手文本、工具名与成败、目标或待办的动作和短标题。`POST` 使用控制 Token，并占用 `/say` 的 10 次/分钟限额。body `{ "message": "1..2000" }`。允许 ASCII `/`，拒绝 C0 与 DEL。成功 **202** `{ "ok": true, "turnId", "status": "pending" }`。已有进行中的回合返回 **409** `chat_busy`。未装配管理员对话时 **503** `admin_unavailable`。空闲 30 分钟、急停或进程退出后清空。急停同时清空步骤。

### 7.0.1 POST /emergency-stop

使用控制 Token 与控制限额。不调用模型。活动自主会话、活动任务或队列、待恢复，以及管理员对话都会停止。某一腿失败时继续其余腿。空闲算成功。返回 **200** `{ "ok", "failures" }`，失败名只有 `task`、`autonomy`、`admin`。

### 7.1 POST /task/start

需要控制 Token + `Content-Type: application/json`。

```json
{ "name": "fishing|farming|woodcutting|mining|forest|sleep|patrol|guard|escort|explore|clearing" }
```

- 空闲：202 `{"ok":true,"queued":false,"position":null,"task":{...}}`，任务立即 active。
- 已有 active：入队，202 `{"ok":true,"queued":true,"position":1..3,"task":{...}}`。
- 队列最多 3 个（`QUEUE_MAX`，不含 active）；同任务允许重复。
- 任务上限默认 60 分钟（`TASK_MAX_MINUTES`）；mining 内部 30 分钟上限。
- 有 pending：409 `resume_pending`（必须先 resume 或 stop/清空）。
- 队列满：409 `queue_full`。
- 任务开关关闭：503 `task_disabled`。
- 不需要 Bot 已在线：任务会先进入 active，由动态存在逻辑自动连接 Lofii。

### 7.2 POST /task/stop

```json
{ "reason": "panel" }
```

- active：202，任务进入 `stopping`，并**清空队列**。
- 只有 pending：202，取消 pending 与队列（审计 `task.discard_pending`）。
- 都没有：409 `no_active_task`。

### 7.2.1 队列语义

- active 正常完成 → 自动启动队首，SSE `task.queue_started`。
- active 失败、防御撤退、恢复超时、`/task/stop` → 清空队列。
- `GET /task.queue` 与 `/status.task.queue` 可见当前队列。
- 队列与 active 一起写入 `task-state.json` v2；服务重启后 pending + queue 保留，resume 后继续。
- v0.3 的 v1 task-state 文件自动迁移，新进度字段补 0。

### 7.3 POST /task/resume

需要控制 Token。body 可为空，或：

```json
{ "taskId": "46451943-eae1-41c0-8df3-beef3c7b60f4" }
```

- pending 未过期：202，恢复原进度与剩余时间。
- 无 pending：409 `no_pending_task`。
- 过期/taskId 不匹配：409 `resume_failed`。
- 10 分钟（`TASK_PENDING_TTL_MS`）未确认：自动 `interrupted`，清空 pending。

### 7.4 POST /move

需要控制 Token + JSON。

```json
{ "action": "home|come|follow|stop", "target": "Antifield" }
```

- `home`：回家；忽略 `target`。
- `come` / `follow`：`target` 可省略，默认 `COMMAND_ALLOWLIST[0]`（Antifield）；必须在线，否则 409 `target_not_online`。
- `stop`：只停移动，不停止任务。
- 任务 active：409 `task_active`（先 `/task/stop`）。
- Bot 未连接：409 `not_connected`。
- 202 只表示已接受；结果通过 SSE `movement` 事件返回。

### 7.4.1 砍树 / 被动防御 / 记忆摘要

- `woodcutting` 只处理固定 oak 树场 `x180–193, z455–464`；实际地面块 y=63、原木从 y=64 起；只砍 `oak_log`、逐棵补种 `oak_sapling`，原木存箱。
- 任务中被动防御：12 格内 zombie/husk/drowned/skeleton/stray/spider/cave_spider 才接战；排除 creeper/enderman/witch/玩家；HP≤12、food≤6 或 >2 只怪时撤退回家并让当前任务失败（清队列）。
- 记忆摘要不新增 HTTP 接口；每 40 turns（20 来回）后台生成 ≤1000 字聊天摘要，注入后续 prompt。

### 7.5 错误码汇总

| 条件 | HTTP | error |
|---|---|---|
| 缺失/错误 Token | 401 | `unauthorized` |
| 控制 Token 未配置 | 503 | `control_disabled` |
| 任务开关关闭 | 503 | `task_disabled` |
| 请求体非 JSON | 415 | `unsupported_media_type` |
| 请求体过大 | 413 | `payload_too_large` |
| 非法 JSON/字段 | 400 | `invalid_request` |
| 有 pending 时启动 | 409 | `resume_pending` |
| 队列满 | 409 | `queue_full` |
| 无任务 | 409 | `no_active_task` / `no_pending_task` |
| 移动目标离线 | 409 | `target_not_online` |
| 任务 active 时移动 | 409 | `task_active` |
| Bot 未连接 | 409 | `not_connected` |
| 限流 | 429 | `rate_limited` |

## 8. POST /say

需要控制 Token + JSON。只允许聊天文本，任意位置的 ASCII `/`、C0 控制字符和 DEL 都返回 400。

```json
{ "message": "来自 AntifieldCloud 的问候" }
```

成功：`{"ok":true,"lines":1}`。错误：

| 条件 | HTTP | error |
|---|---|---|
| 未连接 | 409 | `not_connected` |
| 首字符 `/` | 400 | `message_must_not_start_with_slash` |
| 空消息/超 720 字符/非法 JSON | 400 | `invalid_request` |
| 非 JSON | 415 | `unsupported_media_type` |
| 超 8 KiB | 413 | `payload_too_large` |
| 超过 10 次/分钟 | 429 | `rate_limited` |

## 9. 管理、历史与告警

### 9.1 GET /admin/status

需要读 Token。只读 RCON 白名单：`tps`、`list`、`whitelist list`、`time`。

```json
{
  "admin": {
    "enabled": true,
    "rcon": true,
    "updatedAt": "2026-10-27T07:31:08.071Z",
    "lastError": null,
    "tps": { "one": 19.1, "five": 19.4, "fifteen": 19.8 },
    "online": { "count": 2, "max": 6, "players": ["Antifield", "lofii"] },
    "whitelist": { "count": 6, "names": ["lofii", "SFZ", "Jay", "Antifield", "GAY", "shoayu"] },
    "time": { "ticks": 21461, "label": "03:27" },
    "backup": { "status": "unknown" }
  }
}
```

- `/status` 也包含同一 `admin` 对象。
- RCON 失败时 `rcon=false`，`lastError` 截断；不影响任务/HTTP。
- 没有写管理接口、没有任意命令执行；备份目录不存在，`backup.status` 固定 `unknown`。

### 9.2 GET /history

需要读 Token。

```text
GET /history?kind=samples&from=<ISO>&to=<ISO>&limit=100
GET /history?kind=alerts&from=<ISO>&to=<ISO>&limit=100
```

- `kind` 默认 `samples`；`limit` 1–1000（默认 100）；ISO 时间非法 → 400。
- `samples` 每 60 秒一条；保留 30 天；字段：`ts/connected/state/taskName/taskState/health/food/memoryMb/tps/queueLen/rssMb`。
- `alerts` 字段：`id/ts/type/severity/message/details`。
- 响应：`{kind, from, to, count, samples|alerts}`。
- 不含聊天正文/Token/密码。

### 9.3 SSE alert

```json
{
  "type": "alert",
  "data": {
    "type": "low_health|task_failed|disconnected|chest_full|defense_retreat",
    "severity": "warning|error",
    "message": "Lofii 血量偏低：8/20",
    "details": {},
    "ts": "2026-10-27T07:31:17.802Z"
  }
}
```

- 5 分钟同类型冷却；启动后 10 秒内不报低血量。
- 告警写入 SQLite `alerts` 表。

## 10. 游戏内行为

- 唤醒词：`Lofii` / `@Lofii`（不区分大小写；只回应被点名的消息）。
- 仅 `COMMAND_ALLOWLIST` 内玩家可下命令，默认 `Antifield`。
- 命令：状态、钓鱼、种田、砍树、挖矿、砍天然林、睡觉、巡逻、收工、回家、存东西、过来、跟随、停下、看我、挥手、帮助。
- 安全区扩至 `x111–239, z410–474`；挖矿/天然林只在安全区、保护盒外操作；天然林只 oak/spruce/birch 并补种；挖矿只煤/铁/铜裸露矿、不挖隧道。
- 睡觉用 Vote2Sleep（min 1、40%）；非夜晚/无床/vote 失败正常结束。
- 巡逻四角安全区边界（内缩 4 格），最多 15 分钟，不主动追怪。
- v0.5 仍默认保留游戏内/AI 意图直接触发；`HTTP_ONLY_HIGH_RISK=true` 可关闭高风险触发。
- 任务期间即使 Antifield 下线，Lofii 保持在线；任务结束恢复动态下线。

## 12. 自主会话

自主会话代码默认关闭（`AUTONOMY_ENABLED=false`）；生产进程为 v1.2.3（`/opt/mcbot/releases/20261114T043045Z`），`AUTONOMY_ENABLED=true`。主人通过游戏聊天，或在 Minecraft Bot 页对话后由模型决定是否启动。应用面板不再直接启动自主会话。生产由 DSH 插件经私有 Unix socket 调用受控工具，mcbot 策略层校验并执行。配置该 socket 后 `/autonomy/mcp` 返回 404。OpenCode 原生 MCP 只属于已退役的回滚路径。**不要为普通面板/第三方开放 `/autonomy/mcp` 或该 socket**。

v1.0.3 增加有界环境观察、只读容器读取、进食/装备与事件驱动重决策；应用对缺失字段/工具保持兼容。

### 12.1 GET /autonomy

需要读 Token。返回：

```json
{"autonomy":{"enabled":true,"active":true,"state":"running","goal":"准备食物","startedAt":"...","elapsedSec":12,"remainingSec":1188,"toolCalls":2,"maxToolCalls":12,"lastAction":"start_task","lastReason":"目标需要鱼","lastError":null,"lastDecisionAt":"...","decisionCycles":0,"lastEvent":null,"lastObservedAt":"...","blockers":[]}}
```

`/status` 同时包含同一 `autonomy` 对象（可选字段；旧版 mcbot 缺失时应用按 null 降级；v1.0.3 新增字段为追加）。

### 12.2 POST /autonomy/start

需要控制 Token + `Content-Type: application/json`。body 可为 `{}` 或 `{ "goal": "准备一些食物" }`；goal trim 后 ≤200 字符、无控制字符。

- 202 `{ "ok": true, "autonomy": {...} }`；
- 409 `autonomy_busy`（已有 active/排队/pending 任务或会话）；
- 400 `invalid_request` / `invalid_goal`；
- 503 `autonomy_disabled` / `autonomy_unavailable`。

启动条件：`AUTONOMY_ENABLED=true`、AI 已启用、Minecraft 已连接、无 active/queue/pending 任务。

### 12.3 POST /autonomy/stop

需要控制 Token。body 可为空或 `{ "reason": "..." }`（≤200 字符、无控制字符）；幂等。返回 202 `{ "ok": true, "autonomy": {...} }`。会中断 OpenCode 会话、停止活动任务并清理 MCP/session；v1.0.3 同时关闭容器窗口并停止自主寻路。

### 12.4 原生 MCP 工具

工具名以 OpenCode 运行时 server 名 `mcbot_autonomy` 为前缀；权限规则为 deny-all + `mcbot_autonomy_*` allow：

| 工具 | 参数 | 约束 |
|---|---|---|
| `start_task` | `run_id, task, reason` | task ∈ `AUTONOMY_TASKS`；无 active/queue/pending；健康/食物过低拒绝 |
| `stop_task` | `run_id, reason` | 有 active 任务 |
| `go_home` | `run_id, reason` | 无 active/pending 任务 |
| `deposit` | `run_id, reason` | 无 active/pending 任务 |
| `task_status` | `run_id` | 只读 |
| `observe` | `run_id` | v1.0.3；只读环境快照 + 半径内 allowlist 方块/容器；计入工具预算 |
| `inspect_chest` | `run_id, target, reason` | v1.0.3；target 为 `x,y,z`；仅扫描半径内、allowlist 容器、无 active/queue/pending；短距寻路不传送、不破块；只读不取物并立即关闭 |
| `eat` | `run_id, item, reason` | v1.0.3；item 必须是背包内食物；仅 `food < AUTONOMY_EAT_BELOW` 且空闲 |
| `equip` | `run_id, item, reason` | v1.0.3；item 必须是背包内护甲/工具/武器；仅空闲；目标槽位由类型决定 |
| `finish` | `run_id, summary` | 结束会话；会话结束会清理活动任务 |
| `memory_read` | `run_id`，可选 `category`、`key` | 读取世界记忆正文。分类仅限 `place`、`resource`、`food`、`danger`、`route`、`note`。给出 `key` 时必须同时给出 `category`。不启动任务，计入工具预算 |
| `memory_write` | `run_id, category, key, text, reason` | 按分类和键写入或覆盖。键 1–64，正文 1–240，均不含控制字符。最多 200 条；已有键可更新，满额后拒绝新键。不启动任务 |
| `memory_forget` | `run_id, category, key, reason` | 删除一条记忆。不存在则返回错误。不启动任务 |

每次会话 `run_id` 随机；MCP Bearer token 每次随机且仅在会话期间有效。工具调用审计 `autonomy.tool`/`autonomy.reject`，只记任务名、理由截断、错误码、容器类型/摘要计数，不记录 prompt/Token/完整容器内容。记忆工具只记分类和键，不记正文。世界记忆与聊天记忆分开，按当前维度选取 `world-memory.json`／`world-memory.nether.json`／`world-memory.end.json`（均 0600，每文件最多 200 条），历史主世界 version 1 格式兼容。提示词只带当前维度、分类计数和最近 8 个键，`observe` 返回半径内方块和容器。挖矿／天然林可记录已扫描并复核的 resource 坐标；到场继续复核，失效时回退扫描。工具表仍是上面 13 个，不新增环境变量、参数或跨维度移动。

断线时无法确认当前维度，记忆工具返回 `memory_dimension_unavailable`，不会回退读取主世界记录；未知维度返回 `memory_dimension_invalid`。

### 12.8 在线模式、长期目标与自动生存

**GET /presence（读 Token）**：返回 `{ mode, source, updatedAt, connected, lastDecision }`；`mode ∈ auto|always|off`，`source ∈ default|env|persisted`。

**POST /presence（控制 Token）**：body `{ "mode": "auto|always|off" }`；成功 200 `{ mode }`；任务/队列/待恢复/自主会话运行中切 `off` 返回 409 `presence_busy`；持久化失败 500 `presence_persist_failed`；非法模式 400 `invalid_request`。

**GET /goals?limit=20（读 Token）**：返回 `{ goals: [...] }`，目标含 `id/objective/status/currentStep/steps`；默认最多 20，范围 1–50。

**POST /goals（控制 Token）**：body `{ "objective": "1..200 字符", "steps": [{"kind":"task","taskName":"woodcutting"},{"kind":"deposit"},{"kind":"home"}] }`；任务名受白名单限制，最多 5 步；创建后为 `pending`，**不会自动开始**。目标动作：`POST /goals/:id/start|pause|resume|cancel`。

**持久化与安全**：`presence.json` 与 `goals.db` 位于 `/var/lib/mcbot`，权限 `0640`，不保存 Token/聊天正文；目标重启后为 `paused`，必须主人显式恢复；`path` 失败最多安全重试一次，生存中断恢复且无威胁后最多自动恢复一次。

**v1.0.5 环境变量**：`PRESENCE_MODE`、`PRESENCE_FILE`、`AUTO_SURVIVAL`、`AUTO_SURVIVAL_INTERVAL_MS`、`AUTO_EAT_BELOW`、`AUTO_RESTOCK`、`AUTO_RESTOCK_INTERVAL_MS`、`GOALS_FILE`、`GOALS_MAX_STEPS`；`AUTONOMY_TASKS` 默认追加 `clearing`。

### 12.9 确定性导航与受控路点

`/status` 新增可选 `navigation`：`state ∈ idle|planning|executing|fallback`、`source ∈ pathfinder|planner|ai|teleport|stopped|null`、`attempts`、`lastFailureKind`、`lastFallback ∈ teleport|stopped|null`、`aiUsed`、`updatedAt`。旧版缺失时应用隐藏该字段。

- 导航顺序：pathfinder 快速路径 → 确定性 A*（只读现有方块，支持台阶/楼梯/半砖与 1 格抬高、2 格下落）→ 受控执行 → AI 路点建议（默认 OpenCode 配置可用时启用）→ 安全锚点/传送/停止。
- 不挖掘、不放置、不跑酷、不跨维度。v1.0.6 当时把任务、目标和自主限制在安全区矩形内。v1.0.10 起行走不再受该矩形限制，见下一节。玩家实体未加载或跨维度时仍拒绝按名字传送。
- 安全传送必须是最后手段，同时写 `movement` 事件与 `navigation.lastFallback='teleport'`，并通过聊天提示。
- AI 只在确定性失败后单次请求，超时/非法/越界建议一律丢弃；AI 不直接控制移动。

**v1.0.6 环境变量**：`PATH_PLANNER_ENABLED`、`PATH_PLANNER_MAX_NODES`、`PATH_PLANNER_TIMEOUT_MS`、`PATH_MAX_REPLANS`、`PATH_TELEPORT_FALLBACK`、`PATH_OUTSIDE_SAFE_RADIUS`、`PATH_AI_ENABLED`、`PATH_AI_TIMEOUT_MS`、`PATH_AI_COOLDOWN_MS`。

**v1.0.10 活动范围**：行走不再受 `SAFE_*` 限制。`SCAN_RADIUS` 默认 32、最大 64。`CRITICAL_HEALTH` 默认 6，设为 0 关闭濒危回基地。寻路失败不再把目标点当作传送落点；`PATH_TELEPORT_FALLBACK` 仍被读取，但不触发任意点传送。

### 12.5 事件驱动重决策

- 触发：`task` 事件的 `queued/queue_started/completed/failed/stopped/interrupted/queue_cleared/resume_required`，以及 `alert` 事件的 `low_health/low_food/inventory_full/defense_retreat/task_failed/chest_full`。
- 同原因 `AUTONOMY_EVENT_DEBOUNCE_MS`（默认 30000）去重；最多 `AUTONOMY_MAX_REPROMPTS`（默认 6）次；无周期定时器。
- 只有存在 active/queue/pending 任务时保持会话；否则首轮后结束。
- 安全事件依赖 `ALERTS_ENABLED=true`；关闭时不会产生安全阈值重提示。

### 12.6 环境与动作配置

```text
AUTONOMY_ENABLED=false
AUTONOMY_MAX_MINUTES=20
AUTONOMY_MAX_TOOL_CALLS=12
AUTONOMY_MAX_FAILURES=2
AUTONOMY_GOAL_MAX_CHARS=200
AUTONOMY_DECISION_TIMEOUT_MS=180000
AUTONOMY_MCP_WARMUP_MS=3000
AUTONOMY_SCAN_RADIUS=16
AUTONOMY_SCAN_MAX_BLOCKS=48
AUTONOMY_SCAN_BLOCKS=chest,trapped_chest,barrel,ender_chest,*_bed,water,crafting_table,furnace,blast_furnace,smoker,wheat,carrots,potatoes,beetroots,*_log,*_ore
AUTONOMY_CHEST_READ_ENABLED=true
AUTONOMY_CHEST_PATH_TIMEOUT_MS=12000
AUTONOMY_EAT_BELOW=18
AUTONOMY_ACTION_COOLDOWN_MS=5000
AUTONOMY_EVENT_DEBOUNCE_MS=30000
AUTONOMY_MAX_REPROMPTS=6
AUTONOMY_TASKS=fishing,farming,woodcutting,mining,forest,sleep,patrol,guard,escort,explore,clearing
```

### 12.7 `autonomy` 事件

SSE `/events` 与 `/events/recent` 新增 `type:"autonomy"`，data 形如 `{action,state,reason,error}`；应用用于展示自主状态变化。该事件是追加字段。当前契约为 2，发言使用控制 Token。
## 11. 对接建议

- 面板后端用 `fetch` + `Authorization` 消费 `/events`，不要用浏览器 EventSource 直连。
- 初始展示先拉 `/status` 与 `/task`，再用 SSE 增量更新；断线按 `Last-Event-ID` 重连，`resync:true` 时重新拉快照。
- 不便长期持有 SSE 时，可低频轮询 `GET /events/recent`（默认 50 条，可带 `limit`），由后端按 `bootId`/`lastEventId` 去重；`bootId` 变化时重新拉 `/status` 与 `/task`。`/healthz.contractVersion` 可用于契约兼容性检查。
- 控制调用只从面板后端发出，控制 Token 放后端 env；不要下发到浏览器。
- `/admin/status`、`/history` 使用读 Token；不可写。
- 告警建议后端按 `type` 去重/展示，并自行决定是否通知；本版没有 webhook。
- 本版不提供 `/metrics`、webhook、审计查询接口、跨维度/多 Bot/语音/桥接。
