# 安全说明

本文件描述当前信任边界、控制与残余风险。当前应用 schema 22，mcbot 契约 v2，在线 Agent 使用 DSH；离线回滚运行时：OpenCode v2.2.5。运行指针与验证缺口见 [ACCEPTANCE](ACCEPTANCE.md)，操作见 [DEPLOY](DEPLOY.md)。

## 1. 资产与信任边界

| 资产 | 保存位置与暴露范围 |
|---|---|
| 密码、TOTP、恢复码、会话 | Workbench 受限 SQLite；密码/恢复码/token 按契约哈希，TOTP secret 需要受保护备份 |
| 设备私钥 | 原生受控凭据存储；服务端仅保存公钥与吊销状态，不回传私钥 |
| 文件、附件、笔记、分享 | DB id 与 origin 管理；公开分享只暴露授权内容 |
| DSH 模型/QQ/Web Cookie 凭据 | 隔离服务的受限文件/LoadCredential，不由 Workbench QQ 管线保存 |
| mcbot 读/控制 Token | 独立受限 env，由固定脚本同步；不进入浏览器/API 响应/日志 |
| RCON 密码 | Minecraft 受限配置；应用 API 仅固定查询与白名单管理 |
| age 私钥与 OAuth/rclone 凭据 | 私钥离线至少两份；Pi 只持公钥，PC OAuth 配置按 ACL 限制 |

Cloudflare 终止公网 TLS，边缘可见明文。Access 保护页面；原生客户端 API 放行到应用后仍执行密码/TOTP/设备签名等应用认证。loopback、Unix socket、服务账号和目录权限共同构成内部服务边界。

## 2. 威胁与控制

| 威胁 | 当前控制 |
|---|---|
| 暴力登录/凭据重放 | scrypt、TOTP step 去重、恢复码一次性使用、分层限流和统一失败响应 |
| 会话劫持/CSRF/设备重放 | Secure/HttpOnly/SameSite Cookie、CSRF、Origin、Ed25519 签名与 nonce、吊销和会话失效 |
| 路径穿越/越权预览 | DB id、文件名与 origin 校验、不可变存储、预览白名单和 CSP |
| 上传/归档耗尽空间 | 配额、流式上限、并发和预留、磁盘预检、超时与事务终态 |
| 分享越权/超次数下载 | item 归属验证、解锁会话、原子名额预占、多端点共用计数 |
| SSRF/内部凭据泄露 | 固定 loopback 上游、redirect:error、Host/Origin、服务端覆盖 Authorization、响应流上限和脱敏 |
| 模型越权/迟到动作 | 最小工具策略、主人显式指令、短期运行凭据、执行 ID、安全阈值、急停先撤权及清理后再启动 |
| 备份泄露/不可恢复 | age、公钥权限、离线多份私钥、完整性/链校验、异地密文与隔离恢复 |
| 告警污染/重复投递 | status=event 与条件状态隔离、游标、dedupe_key、持久化投递箱和接收端幂等 |

## 3. 认证、HTTP 与原生客户端

- 密码 scrypt 参数 N=2^15、r=8、p=1，随机盐与恒定时间比较。TOTP、恢复码、挑战过期和会话轮换按 API 执行。
- 会话 Cookie 为 host-only、HttpOnly、Secure、SameSite=Lax；仅 loopback HTTP 可例外。app/ai 使用各自的 Cookie，不能依赖父域共享会话。
- Cookie 写操作校验 CSRF；app/loopback 是 app 写请求的可信 Origin，AI Origin 不在其中。公开分享解锁按自己的 Origin/限流规则处理。
- 合法 Bearer 必须同时通过设备签名，覆盖方法、路径/查询、原始体、时间戳和 nonce；验证后豁免 CSRF。非法 Authorization 不回退 Cookie。同一公钥不能绕过吊销重新登记。
- 设备签名体上限 9 MiB；原生允许来源为固定 Tauri Origin，不反射任意 Origin。文件传输流式处理，不把会话令牌放入下载链接。
- Windows 隔离 AI 窗口与 Android 独立 Activity/WebView 只接受固定 AI 来源和 SSO 路径；远端页面不获得设备命令、文件或签名权限。换票 User-Agent 保持一致，登出关闭旧连接。
- 对 UI 和事件字段按 unknown 验证、纯文本渲染；SVG/HTML/XML 强制下载，文本预览≤1 MiB，Markdown/HTML 按当前白名单净化。
- 安全头包括 CSP、禁止嵌入、nosniff 和 Referrer Policy；错误返回稳定业务码，不带堆栈、内部 URL、Token 或正文。

## 4. 文件、上传与分享

- 物理路径仅由 DB id 派生，文件内容不可覆盖；上传先写 tmp，再校验/原子 rename/登记。配额 10 GiB 包含回收站与附件。
- `origin=user|note|system` 决定可见性。普通列表、搜索、回收站和分享只接受适用 user 文件，附件只能经笔记接口管理。
- 分片逐片与整文件校验 SHA-256。坏片失效但保留其他分片与预留；文件行、completed/file_id 和块索引删除同事务，提交后清理失败不重复登记文件。
- 公开分享 token 只存 SHA-256，密码使用 scrypt；过期、吊销、次数耗尽分别返回稳定 410。多文件 item 必须属于分享，密码未解锁时不暴露清单。
- 内容端点按分享会话原子预占一次名额，同会话多文件/Range 共用。HEAD/304/416 不占用；全部在途发送未完成且中断时可归还，进程异常、结果未知则保留并允许同会话续传。
- 审计只记元数据，actor≤64、target≤256、detail≤4 KiB。非安全审计失败不回滚业务，失败诊断经 `/api/version.audit` 暴露；安全关键审计逐条尝试，公开下载计数在事务内。

## 5. DSH、QQ 与 mcbot

- DSH Web、QQ、mcbot Agent 的账号/Home/工作目录/凭据独立。Web 命令在专用工作目录与 Bubblewrap/审批策略内执行；Minecraft Agent 不启用 shell、文件系统或插件管理。
- Web 代理固定 loopback 上游，HTTP/WS 校验 Host/Origin。一次性 SSO 经受限 socket 换原生 Cookie，启动令牌不进入 URL/日志/错误。插件页沿用路径允许列表，模型侧 tool-plugin-manager 关闭。
- QQ 每 AppID 单一入站，私聊/群聊白名单、群 @Bot、分发前斜杠命令拦截和平台确认身份共同限制范围。图片下载有来源/重定向/大小/寿命限制；本地文件/交付物外发关闭。
- QQ 角色与结构化记忆在独立 profile 按 AppID/用户或群/成员隔离。变更候选本机审核；确认清除撤销相关记忆及候选。不能确认归属的内容不进入活动记忆。
- Workbench 不提供 QQ Webhook、发布、管理或 OpenCode Chat，不保存 QQ 业务表。企业微信仅是独立告警 webhook 的接收端。
- mcbot 只监听 loopback，应用客户端禁止重定向，单次请求有超时且响应体流式≤2 MiB。读/控制 Token 分离，上游 URL/Token 脱敏；应用不读取 RCON/DSH 凭据。
- 应用只接受契约 v2，仅代理只读状态、在线模式、管理员对话、停止和急停。直接任务开始/恢复、目标读写、移动、游戏发言、自主开始与 history 路径不存在，返回 404。
- 管理员对话要求会话/设备认证、CSRF 或签名、控制 Token 与限流；允许 ASCII `/`、拒绝 C0。mcbot 本机 `/say` 使用控制 Token 且拒绝 ASCII `/` 与 C0。
- 自主工具为现有 13 个，经私有 Unix socket 调用；没有 socket 自主不可用，配置后 `/autonomy/mcp` 返回 404。普通聊天/意图/路点建议没有动作工具。任务名与动作由 Bot 白名单校验，不向模型开放任意命令。
- 急停先撤销执行权，再取消模型、任务、移动和容器操作；旧会话清理结束后才接受新运行。超时、预算、失败、断线和手动操作均 fail-closed。
- 世界记忆按维度、固定分类隔离；提示词仅索引，正文经工具受控读取。观察只读，inspect_chest 不取物、不传送、不破块，eat/equip 仅空闲时使用背包物品。
- 聊天、事件和 DSH 步骤只留内存；事件缓存≤100 条且≤512 KiB，步骤≤80，短标题≤120 字。急停清空时间线；工具参数、prompt、凭据和记忆正文不进入应用 DB/审计。
- mcbot alert 只写 `status='event'`，不改变 `alert_state`。事件/去重键/投递项同事务，告警写失败不推进游标。webhook 使用持久化重试和 Idempotency-Key，接收端必须去重。

## 6. 运维与灾备

- Pi systemd 使用专用服务账号、空 capability、只读系统与最小可写路径；不通过关闭 ProtectHome 等加固解决路径问题。root 无人值守动作仅固定维护入口，不授予通用 shell/node/npm 免密 sudo。
- nftables 默认拒绝入站；SSH/Minecraft 游戏端口只放允许网段，RCON 只放 loopback。SSH 仅公钥，fail2ban 使用持久化数据库；规则重建后恢复封禁 set。应用不修改 Minecraft/frpc/SSH 或重启 Minecraft。
- 世界备份 root 服务仅固定 save-off/save-all flush/save-on，save-on 在 finally 收口；不从应用 API 触达。其他服务不继承该能力。
- 部署包明确清单和逐文件 SHA；切换前校验 DB 一致性快照、schema、指针和配置。健康检查验证版本/schema/运行时就绪。同 schema 回滚保留 DB/WAL，跨 schema 使用匹配快照前先保全现行数据。
- 备份 prepare/ack 分离，未确认归档不删。生产整包 age 与 Google Drive 异地开启，模板默认关闭；Pi 仅独立公钥、root 属主且组/其他不可写，私钥离线至少两份。
- 加密失败关闭，不生成 pending、不降级明文；临时明文只用 `.plain.tmp`，密文/sidecar 落盘后删除；空间按 2× 明文预算。plain SHA/size 位于 sidecar/DB，避免归档内自引用。
- `.age` 的 Web verify/import/entries/plan/execute 在名称合法化后、读取/解包前返回 `409 archive_encrypted`；Web 不持私钥，恢复目标跳过密文。PC 解密后仍须校验链、DB 和全部引用内容。
- 密钥包收录 DSH 配置/凭据/记忆与 mcbot 一致性目标库/任务/维度记忆；部署冷备另外包含 DSH 会话历史。服务启用但关键状态缺失或读取失败时，密钥包失败。
- 异地仅 age 密文及旁文件，链感知保留，最新 full 及所需增量受保护；状态不含远端真实路径/凭据。Windows 凭据和备份目录仅当前用户/Administrators/SYSTEM。
- 状态文件由 root/PC 写固定路径，应用同句柄检查普通文件、限制实际读取≤64 KiB；失败降级 null，不能让状态文件变成任意文件读取入口。

## 7. 当前残余与检查要求

- 单进程与内存限流、SQLite NORMAL 的断电窗口、Cloudflare 边缘明文、单存储介质及依赖外部平台的可用性是当前限制。
- 审计 best-effort 在底层 DB 故障时仍可能丢失；需监控 failureCount/persisted 并处理存储错误。
- 加密归档的私钥丢失无法恢复。受限明文预部署快照和崩溃残留临时明文仍需权限与清理控制；密文孤儿只报告，不擅自删除。
- mcbot 状态存在轮询延迟，内存会话/事件会随重启清空。未实际验证的真机、平台和恢复场景不能写成通过，缺口以 AUDIT/ACCEPTANCE 为准。
- 发布检查覆盖应用认证、设备吊销、非法 Origin、分享并发、分片损坏、工具撤权、告警受控投递、备份拉取和隔离恢复；负路径在候选夹具验证，生产仅执行获准验收。

版本变更仅维护于 [CHANGELOG](../CHANGELOG.md) 与 [ROADMAP](ROADMAP.md)。
