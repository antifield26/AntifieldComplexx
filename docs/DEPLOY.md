# 部署手册（Raspberry Pi 5 / Debian 13，v1.2.4）

操作按本文件执行。涉及系统状态的步骤要逐条确认。公开仓库里的域名、地址和网段都是占位值，安装前按 `.local/DEPLOYMENT.md` 替换。该文件不提交。

目标是 `/opt/antifieldcloud/current`，服务用户 `antifieldcloud`，监听 `127.0.0.1:3000`。

## 当前运行与回滚

运行中的 Workbench 是 `/opt/antifieldcloud/releases/20261116T135139Z`（v1.2.4，schema 22）。插件列表代理放行 `/api/pluginManager/` 与 `/api/pluginInventory/`，仍拒绝上传、设置写入、凭据写入，以及原始路径中的 `%`。现行库已是 schema 22。恢复 v1.2.3 必须先换回迁移前快照 `/var/lib/antifieldcloud/backups/db-predeploy-20261116T135240676Z.sqlite`，再把 Workbench 指回 `/opt/antifieldcloud/releases/20261114T082631Z`，只重启 `antifieldcloud`。不能只切换 release。

mcbot 是 `/opt/mcbot/releases/20261116T135658Z`。同契约回滚指回 `/opt/mcbot/releases/20261114T043045Z` 并只重启 mcbot。DSH 是 `/opt/antifield-dsh/releases/20261114T051442Z`（0.2.2-rc.3，QQ 插件 0.5.5）。该 release 的 Web 策略指向 `/usr/local/bin/pnpm-dsh`。2026-11-17 写入前的换票器、策略和配置副本在 `/var/backups/antifieldcloud/dsh-plugin-page-20261117T015458Z`。更早的策略副本在 `/var/backups/antifieldcloud/web-policy.yml.20261114T051442Z`。再退时，Workbench 使用 `20261114T042643Z`，DSH 使用 `20261114T043420Z`。v1.2.2 使用 Workbench `20261113T072133Z`、mcbot `20261113T072417Z`、DSH `20261113T080907Z`。这些更早的回滚在恢复对应数据库快照后保留当时的数据库及 WAL。

跨 schema 退回 v1.1.1 必须恢复 schema 20 快照 `db-predeploy-20261111T104848131Z.sqlite`、Workbench `20261109T143755Z`、mcbot `20261110T022539Z`、当时的 Access 策略和公网界面。只恢复公网界面时把 `PUBLIC_APP_SHELL` 设为 true 并重启，不改 schema。

更早的 release 指针见 [CHANGELOG](../CHANGELOG.md)。不要把部署前快照覆盖到仍在写入的现行库上，除非数据库本身已经损坏。

## 维护入口

日常拉取、世界状态、演练状态和 smoke 使用 `/usr/local/sbin/antifield-maint` 的固定动词。它不接受任意命令、环境覆盖或自定义 root 路径。状态文件来源必须是普通文件，并受 64 KiB 上限约束。

无限免密 sudo 已撤销。Pi 使用全局 sudo 票据。管理员先在交互终端执行 `sudo -v`，再在票据有效期内运行部署脚本。密码不写入脚本或环境文件。无人值守备份只走固定入口。

部署、安装依赖、切换 release 和改配置继续使用管理员密码。不要把 bash、node、npm、install、tee 或通配路径放进免密规则。更新维护脚本后要由管理员重新安装并核对 SHA。

QQ 监督器随独立 DSH release 切换，只替换包装器和监督模块，保留锁定依赖、账号、配置和会话数据。失败时恢复旧 runtime 指针并只重启 QQ。

## 客户端构建

三个公开 HTTPS 源来自未提交的 `.local/client-build.env` 或 CI：`VITE_API_ORIGIN`、`VITE_AI_ORIGIN`、`VITE_ACCESS_ORIGIN`。`npm run build:client:windows` 与 `build:client:android` 同时注入 Vite 和 Cargo，缺失或非法即失败。发行构建必须打开 `custom-protocol`。

Windows 构建 NSIS。Android 的正式路径使用仓库脚本、SDK 36 和既有兼容签名。本机若绕过该脚本直接组装 Android，必须传入同样的三个源，并关闭 Gradle configuration cache。私钥不进源码或发布附件。

## DeepSeek Harness

CI 用 `deploy/dsh/package-lock.json` 独立安装。DSH 与 SDK 固定为 0.2.2-rc.3，QQ 插件固定为 0.5.5。`sudo bash deploy/dsh/stage.sh` 安装三个 systemd 单元、专用账号和 socket 目录，并把 npm 12.2.2、pnpm 10.34.9 与查询包装 `pnpm-dsh` 装到 `/usr/local/bin`。`npm` 必须留在该前缀下，不能是指向主目录的符号链接：Web 服务启用 ProtectHome，而 `pnpm view` 会调用 `npm`。Web 策略把插件查询指向 `/usr/local/bin/pnpm-dsh`。该包装只在 `view` 去掉 npm 12 不接受的 fetch-retries 参数。模型侧插件管理工具保持关闭。2026-11-17 生产把该包装、两个只显示插件和 Web 策略写入正在运行的 DSH release，随后只重启了 `antifield-dsh-web`。用户已验收插件页，并完成一次安装和卸载。后续 DSH 程序更新仍由管理员原子切换 `current`。

凭据放在 `/etc/antifieldcloud/dsh`，权限 0600，由 systemd `LoadCredential` 注入。Web、QQ 与 mcbot Agent 使用各自的模型和平台凭据。保持 Cloudflare Access。插件页不新增 Access bypass。

Web 工作区命令走 Bubblewrap，只挂载专用工作区和系统运行库。模型侧插件管理工具保持关闭。Minecraft Agent 的最小策略不启用 shell、文件系统或清单插件。

回滚时先停 DSH，保存新会话的加密冷备，再切回上一 runtime。OpenCode 已从 Pi 移除；需要那条回滚路径时，从 PC 上验证过的离线档恢复 2.2.5，并单独核对运行中的 `/api/info`。

## Minecraft Bot 部署

mcbot 是独立服务，只监听 `127.0.0.1:3010`。从 `apps/mcbot` 运行 `scripts/deploy.ps1`。脚本把 release 解到 `/opt/mcbot/releases/<UTC>`，安装生产依赖，原子切换 `current`，失败时切回上一 release。

默认保留最新 3 个 release（`-KeepReleases`），并保护 `current` 与刚替换下来的 `previous`。首次 `-ServerConfig` 才会改 `max-players`、白名单和 OP，并重启 Paper。确认没有玩家在线后再做。

Token 由 root 执行 `scripts/sync-mcbot-tokens.sh`，从 `/etc/mcbot/env` 同步到应用环境。`--check` 只比较。控制 Token 为空时，控制接口和游戏发言返回 503。

手工回滚：

```bash
sudo ln -sfn /opt/mcbot/releases/<上一UTC> /opt/mcbot/current
sudo systemctl restart mcbot
curl -fsS http://127.0.0.1:3010/healthz
```

## 0. 拓扑与前置

- Pi：`antifield@192.0.2.10`（直连网线；TEST-NET-1 占位，实际网段见 `.local/DEPLOYMENT.md`），WiFi 示例 `198.51.100.10`（TEST-NET-2 占位；实际校园网段见 `.local`）。
- 域名：`app.<domain>`（应用）、`ai.<domain>`（Workbench 认证后的 DSH Web 反代）、`mc.<domain>`（Minecraft，现状保留），Cloudflare Tunnel 名称为 `pi`（UUID 见 `.local`）。
- Minecraft、SakuraFRP 与 RDP/桌面继续由各自的系统服务管理。应用监控范围见 §0 的服务清单。
- 本仓库从 Windows PC 通过 SSH 部署；PC 需有 `C:\Users\<user>\.ssh\id_ed25519`。
- 非敏感部署值（域名/路径/公网 MC 地址）写入 Pi 的 `/etc/antifieldcloud/deploy.conf`（root 只读，不提交仓库），
  由 `bootstrap-env.sh` 读取；密钥只来自现有服务配置或离线保管。
- 当前 schema **v22**：删除 Workbench 旧 QQ 表，外部告警通道只保留 webhook。现行库已迁移。恢复 v1.2.3 必须使用迁移前快照 `db-predeploy-20261116T135240676Z.sqlite`。
- schema 21（2026-11-11 已部署）：设备登记、会话绑定与请求签名。迁移前生产库是 schema 20，快照为 `db-predeploy-20261111T104848131Z.sqlite`。回到 v1.1.1 必须恢复该快照、v1.1.1 release、当时的 Access 策略与公网界面。schema 20 增加外部告警 Webhook 和 QQ 入队状态。
- `PUBLIC_APP_SHELL` 默认 `true`，公网继续提供完整界面。设为 `false` 并重启后，应用公网主机只返回说明页「请使用客户端」和分享页；`127.0.0.1`、`localhost` 与 `::1` 仍提供完整界面。单独回滚该开关：改回 `true` 并重启，不改 schema。生产页面仍经 Access；`/api` 已在控制台放行到应用，见 §5.2。

## 1. 首次系统初始化（重装时执行）

```bash
sudo apt-get update
sudo apt-get install -y nftables age

# 服务账号（无登录 shell、无 sudo）
sudo addgroup --system antifieldcloud
sudo adduser --system --ingroup antifieldcloud --home /var/lib/antifieldcloud \
  --shell /usr/sbin/nologin --no-create-home antifieldcloud

# 数据目录
sudo install -d -o antifieldcloud -g antifield -m 0750 /var/lib/antifieldcloud
sudo install -d -o antifieldcloud -g antifieldcloud -m 0700 /var/lib/antifieldcloud/files /var/lib/antifieldcloud/tmp
sudo install -d -o antifieldcloud -g antifield -m 2770 /var/lib/antifieldcloud/backups
sudo install -d -o root -g root -m 0755 /opt/antifieldcloud/releases /etc/antifieldcloud
# 防火墙（仓库 deploy/nftables.conf；实际网段按 .local 修改后再安装）
# ！先确认当前 SSH 来源在允许网段内，否则加载后会锁死 SSH。
sudo cp -a /etc/nftables.conf /etc/nftables.conf.bak 2>/dev/null || true
sudo nft -c -f deploy/nftables.conf
sudo install -m 0644 deploy/nftables.conf /etc/nftables.conf
sudo nft -f /etc/nftables.conf
sudo systemctl enable --now nftables

# systemd 单元（应用 + 健康探针；世界备份 unit 见 §9.2）
sudo install -m 0644 deploy/antifieldcloud.service /etc/systemd/system/
sudo systemctl daemon-reload
```

nftables 默认策略与网段（详见 §9；`deploy/nftables.conf` 使用 TEST-NET 占位，安装前按实际替换）：默认 drop 入站；22 仅 `192.0.2.0/24` + `198.51.100.0/24`（示例占位）且新建连接限速 20/min；
25565 仅同网段；25575 仅 loopback；DHCP 仅 `eth0`/`wlan0`；80 不再放行。

## 2. 非敏感部署值与环境文件

```bash
# 只写非敏感值，不写任何密钥；实际域名/路径按 .local/DEPLOYMENT.md 填写
sudo install -o root -g root -m 0640 /dev/stdin /etc/antifieldcloud/deploy.conf <<'EOF'
APP_ORIGIN=https://app.example.com
AI_ORIGIN=https://ai.example.com
# 仅用于清理旧父域 Cookie（不再设置新 Cookie）；新装可留空，生产建议保留以精确清理
COOKIE_DOMAIN=.example.com
MC_PUBLIC_ADDRESS=mc.example.com:11798
DATA_DIR=/var/lib/antifieldcloud
WEB_DIST_DIR=/opt/antifieldcloud/current/web/dist
ADMIN_USERNAME=antifield
EOF
```

先部署一次代码（第 3 节，服务可先不启动），再生成环境文件：

```bash
cd /opt/antifieldcloud/current
sudo bash scripts/bootstrap-env.sh                  # 首次
sudo bash scripts/bootstrap-env.sh --dry-run        # 查看解析结果（不写文件、不显示密码）
sudo bash scripts/bootstrap-env.sh --force          # 轮换/重建（非敏感配置优先沿用旧 env/deploy.conf）
sudo ls -l /etc/antifieldcloud/env                  # 应为 -rw-r----- root antifieldcloud
```

- `bootstrap-env.sh` 从 `~/minecraft-server/server.properties` 读 RCON 密码、从 `/etc/opencode/opencode.env`
  读 `OPENCODE_PASSWORD`，写入 `/etc/antifieldcloud/env`，不回显密钥。
- 解析顺序：命令行参数 > 现有 env > `/etc/antifieldcloud/deploy.conf` > 示例默认值；`--force` **不会**把真实域名重置为
  `example.com`。若仍使用占位域名，脚本会打印警告。
- 可选参数：`--app-origin= --ai-origin= --cookie-domain=``--mc-public-address= --data-dir= --web-dist-dir= --admin-username=`。
- `APP_VERSION` 由 `bootstrap-env.sh` 从当前 release 的 `package.json` 读取（读不到直接失败，只使用当前 release 版本）；
  `deploy.ps1` 切换前也会注入并校验 `/healthz.version`。
  - `BACKUP_RESTORE_ENABLED=true`：启用 Web 备份列表/导入/文件级恢复；默认 false 时恢复计划/执行返回 403。
  - `BACKUP_IMPORT_MAX_BYTES=104857600`：Web 归档导入上限，实际还受 `MAX_UPLOAD_BYTES` 限制。
  - `BACKUP_IMPORT_RETENTION_DAYS=90`：Web 导入归档保留天数，0=永久；活动恢复计划引用的归档不删。
  - `ALERT_REPEAT_HOURS=24`：持续 firing 的重通知间隔（小时），0=关闭；新键优先于旧 `ALERT_COOLDOWN_MINUTES`。
  - Workbench 不读取 `CHATBOT_*`、`DSH_QQ_MANAGED` 或 `OPENCODE_HTML_MODE`。DSH Web 的 URL 与 socket 同时配置或同时留空。HTML 原样转发。生产残留键用 `bootstrap-env.sh --force --prune-unknown` 清理，先备份 env。
  - `CHUNKED_UPLOAD_ENABLED=true`：启用 5 GiB 分片上传（默认 true）。
  - `CHUNK_SIZE_BYTES=8388608`：块大小，1–100 MiB；Cloudflare 代理下建议 8 MiB。
  - `CHUNK_MAX_FILE_BYTES=5368709120`：单文件上限，默认 5 GiB，不得超过配额。
  - `CHUNK_SESSION_TTL_HOURS=24`、`CHUNK_MAX_CONCURRENT_SESSIONS=3`：会话过期与每用户并发上限。
  再运行 `--force` 追加缺失键，非敏感值会沿用现有 env/deploy.conf，不会重置真实域名）：
  - `BACKUP_PREPARE_TIMEOUT_SEC=3300`：Web/CLI 生成归档超时，与 PC 侧 55 分钟对齐。
  - `WORLD_BACKUP_STATUS_FILE`、`WORLD_PULL_STATUS_FILE`、`DRILL_STATUS_FILE`：默认
    `/var/lib/antifieldcloud/{world-backup,world-pull,drill}-status.json`，应用只读。
  - `ALERT_WORLD_BACKUP_MAX_AGE_HOURS=192`、`ALERT_DRILL_MAX_AGE_DAYS=35`：世界备份/拉取与演练超期阈值。
  - `NOTE_ATTACHMENT_MAX_BYTES=26214400`、`NOTE_MAX_ATTACHMENTS=100`、`NOTE_VERSIONS_KEEP=20`：笔记附件与版本限制。
  - `SHARE_MAX_ITEMS=50`：单个分享最多文件数。
  - `METRICS_ENABLED=true`、`METRICS_SAMPLE_SECONDS=60`、`METRICS_RETENTION_DAYS=30`：指标采样与保留。
  - `MCBOT_ENABLED=false`：mcbot Minecraft Bot 对接总开关（v0.8.0 引入，v0.8.1 加固，**默认关闭**）；启用时必须配置 `MCBOT_READ_TOKEN`，且 `MCBOT_URL` 为 loopback + http(s) 根地址（拒绝 userinfo/路径/查询/片段），否则拒绝启动。
  - `MCBOT_URL=http://127.0.0.1:3010`：上游仅 loopback（去尾斜杠）；mcbot 是独立服务，不对外、不进入 Cloudflare/nftables。
  - `MCBOT_READ_TOKEN=`、`MCBOT_CONTROL_TOKEN=`：由 root 执行 `scripts/sync-mcbot-tokens.sh` 从 `/etc/mcbot/env` 的 `HTTP_TOKEN`/`HTTP_CONTROL_TOKEN` 同步（64 位 hex）；**不要手工复制 mcbot 的 RCON/OpenCode 密码**。控制 Token 为空 = 只读（控制接口与 `/say` 均 503 `mcbot_control_disabled`）。
  - `MCBOT_TIMEOUT_MS=2500`（500–10000）：单次上游请求超时（毫秒）。
  - `MCBOT_POLL_MS=5000`（2000–60000）：`/status` + `/events/recent` 轮询间隔（毫秒）。
  - `MCBOT_ALERTS_ENABLED=true`：是否把上游 `alert` 写成应用告警事件（`status='event'`）；关闭时仍推进游标但不写告警。
  - mcbot Token 同步/轮换（root）：先 `cp -a /etc/antifieldcloud/env /etc/antifieldcloud/env.bak.$(date -u +%Y%m%dT%H%M%SZ)`，再 `sudo bash scripts/sync-mcbot-tokens.sh`；`sudo bash scripts/sync-mcbot-tokens.sh --check` 只比较不写盘。脚本写前自行备份、原子 install、保持 0640，不回显 Token；Token 变化后 `systemctl restart antifieldcloud` 生效。轮换 mcbot 侧 Token 后必须重新同步。

## 3. 从 PC 部署（带迁移前 DB 快照与自动回滚）

```powershell
cd "$env:USERPROFILE\projects\AntifieldComplexx"
npm run check
.\scripts\deploy.ps1 -PiHost 192.0.2.10   # 替换为 Pi 实际直连地址
```

`deploy.ps1` 在本机生成 Workbench 文件清单，上传后先验 tar 的 SHA-256，再核对包内版本与逐项哈希。DSH 源码和独立锁文件随包分发。生产依赖在目标机用锁文件安装。脚本从生产环境配置识别 DSH 模式，配置冲突时中止。

- 切换前验证 SQLite 一致性快照的 SHA-256、完整性和 schema，并保存在用 release 指针及生产配置。切换后同时校验应用版本、schema、DB 和运行时就绪。
- 同 schema 健康检查失败时，脚本恢复旧配置与指针，并复检上一版本。现行 SQLite 与 WAL 保留原位。跨 schema 进入人工维护，先保全现行库，再验证恢复源。
- 先部署 Workbench 并验收分享、上传与回滚，再在 Bot 空闲时运行 `apps/mcbot/scripts/deploy.ps1`。mcbot 发布包有独立清单，启动校验版本、契约与运行时 socket。随后更新 Windows 计划任务，实际拉取并隔离恢复，最后执行完整 smoke。
- 部署成功后脚本自动运行只读 smoke 子集：`smoke.ps1 -SkipPublic -SkipLocalBackup -ExpectedVersion <版本>`；
  **smoke 失败默认让部署脚本失败**（发布门禁），确需只告警时用 `-AllowSmokeFailure`；两种情况都不会自动回滚已完成的部署。
- **首次部署**（`/etc/antifieldcloud/env` 尚不存在）：脚本只上传/安装并切换 current，跳过 DB 快照、重启与健康检查；
  按第 2 节生成 env 后再 `sudo systemctl enable --now antifieldcloud`。
- 失败清理：切换前失败会删除不完整 release 与 `/tmp` 临时包；本地 tar 总在 finally 清理。
- release 保留 3 个，且清理时永不删除 `current` 与本次 `previous`。
- 手工等价步骤（仅在脚本不可用时）：解包 → `npm ci --omit=dev --ignore-scripts` → 先跑
  `node scripts/backup.mjs --snapshot-db` → 写入/校验 `APP_VERSION` → `ln -sfn` → `systemctl restart antifieldcloud` → `curl /healthz`。

### 3.0 当前部署步骤

1. 在 PC 上跑 `npm run check`、`npm run build`、`node scripts/check-version.mjs` 和 `node scripts/check-prod-deps.mjs`。期望应用与 mcbot 为 1.2.4，schema 为 22，契约为 2，DSH 为 0.2.2-rc.3，QQ 插件为 0.5.5。2026-11-16 的生产切换见文首。
2. 确认没有未确认的归档。开启加密后按两倍明文预算留磁盘。部署前核对并保留 schema 21 的一致性快照。迁移执行后，恢复 v1.2.3 必须使用这份快照。
3. 部署 Workbench：`.\scripts\deploy.ps1 -PiHost <直连 IP>`。脚本校验 tar、安装生产依赖、做迁移前快照并切换 current。这次迁移跨 schema，失败时进入人工维护，先保全现行库。
4. Bot 空闲后再部署 mcbot。Minecraft 保持运行。核对 `/healthz` 与契约 v2。
5. 冒烟使用 `smoke.ps1 -ExpectedVersion 1.2.4 -ExpectedSchemaVersion 22 -ExpectedMcbotVersion 1.2.4 -RequireMcbotState -ExpectedMcbotContractVersion 2 -ExpectedDshVersion 0.2.2-rc.3 -ExpectedDshQqVersion 0.5.5 -RequireOpenCodeStopped`。配置 Access 后追加客户端标识。未启用 mcbot 时用 `-SkipMcbot`。
6. 整包加密与 Google Drive 异地副本保持开启。回滚指针见文首。跨 schema 退回 v1.1.1 必须同时恢复 schema 20 快照、当时的 release、Access 策略和公网界面。
## 3.2 OpenCode v2.2.5 升级与兼容性复核（本机执行，发布门禁）

本窗口目标 **OpenCode v2.2.5**（升级前生产为 v2.2.0，2026-10-30 发布）。与应用相关的变化：工具调用名 `bash` 映射为 `shell`（真实插件工具名仍为 bash 时优先）；MCP stdio 单条消息超过 10 MiB 不再断开连接；空闲地点不再立刻重启 MCP；compaction 提示限制在模型上下文内。**Breaking**：TUI 插件需要 OpenTUI 0.8。应用使用原生 HTTP API 与本地 MCP，不使用 `@opencode/ai`、TUI 插件或 OpenTUI，无需业务改造。

升级前只读查看 Pi 上的 `opencode.json`。没有把托管策略 `integration.use` 拆成 `mcp.use`/`skill.use`/`plugin.use` 时，不改配置，也不改 `compaction.buffer`。不要预先加入显式 `bash`/`shell` deny；只有矩阵证明 `deny *` 被绕过时才加。

必须先完成本节，再部署应用。矩阵失败则恢复**本次** v2.2.0 备份并停止。回滚目标不是 2026-10-28 的 v2.1.4 备份。不重启 Minecraft。

```bash
# 0) 备份（root）：二进制、data、env、unit、MCP 配置。记下 TS，回滚用这一份。
TS=$(date -u +%Y%m%dT%H%M%SZ); BK=/var/backups/opencode
sudo install -d -o root -g root -m 0700 "$BK"
sudo tar -C /var/lib/opencode -czf "$BK/opencode-bin-$TS.tar.gz" .opencode/bin/opencode
sudo tar -C /var/lib/opencode --exclude='.opencode/bin' -czf "$BK/opencode-data-$TS.tar.gz" .
sudo cp -a /etc/opencode/opencode.env "$BK/opencode.env.$TS"
sudo cp -a /etc/systemd/system/opencode.service "$BK/opencode.service.$TS"
sudo cp -a /var/lib/opencode/.config/opencode "$BK/opencode-config-$TS" 2>/dev/null || true
sudo cp -a /opt/antifieldcloud/current/scripts/*-mcp.mjs "$BK/" 2>/dev/null || true

# 1) 升级并重启。upgrade 只替换磁盘二进制，必须显式 restart。
sudo -u opencode env HOME=/var/lib/opencode /var/lib/opencode/.opencode/bin/opencode upgrade 2.2.5 --method curl
sudo -u opencode /var/lib/opencode/.opencode/bin/opencode --version   # 只代表磁盘二进制
sudo systemctl restart opencode && systemctl is-active opencode

# 2) 校验运行中服务。/proc/<pid>/exe 不得含 (deleted)；/api/info 期望 "version":"2.2.5"。
PID=$(systemctl show opencode -p MainPID --value)
sudo readlink -f /proc/$PID/exe
AUTH=$(printf '%s' "opencode:$(sudo grep -E '^OPENCODE_PASSWORD=' /etc/opencode/opencode.env | head -n1 | cut -d= -f2-)" | base64 -w0)
curl -fsS -H "Authorization: Basic $AUTH" http://127.0.0.1:4096/api/info
```

### 本窗口矩阵（在运行中的 2.2.5 上执行，通过前不部署应用）

| 编号 | 检查 | 结果 |
|---|---|---|
| V1 | 运行中 `/api/info` 为 2.2.5，进程 exe 非 deleted，Basic `/api/session` | PASS（2026-11-04，`/api/info=2.2.5`，exe 非 deleted，会话列表 200） |
| V2 | 会话列表 | PASS（200，`data` 为数组） |
| V3 | deny-all 创建会话；名为 `bash` 与 `shell` 的工具调用均被拒绝 | PASS（会话 200，存下的规则为 `*:deny`。生产模型 `opencode-go/deepseek-v4.1-flash` 没有发出可执行的工具调用：要求 `bash` 时回复该工具不可用；要求 `shell` 时把 DSML 文本留在 assistant 正文，没有工具结果。未观察到 `deny *` 被绕过，未加显式 bash/shell deny） |
| V4 | prompt → assistant content/finish | PASS（同一模型，`finish=stop`，正文 `OK`） |
| V5 | `/api/experimental/session/:id/wait` | PASS（204） |
| V6 | 会话列表形状/清理 | PASS（`data` 数组加 cursor；测试会话已删除） |
| V7 | 图片 prompt files | PASS（1×1 PNG data URL，200；assistant `finish=stop`，正文 `IMAGE`） |
| V8 | botmsg 与 searxng 各 1 个进程且 connected；自主会话只放行 `mcbot_autonomy_*` | PASS（`/api/mcp` 中 botmsg 与 searxng 均为 connected，MCP 进程各 1；searxng 服务进程另有 2 个。自主规则创建为 `*:deny` 加 `mcbot_autonomy_*:allow`。内置 `opencode_console` 为 needs_auth，本次未改配置） |
| V9 | 会话删除/清理 | PASS（DELETE 204，随后 GET 404） |
| V14 | 资源余量 | PASS（可用内存约 4.0 GiB，OpenCode RSS 约 456 MiB，根分区可用 35G、已用 38%） |

V10–V13（真实 QQ）沿用既有验收，本次不重跑。2026-11-04 的备份 timestamp 是 `20261104T062115Z`。`opencode.json` 没有把 `integration.use` 拆成 `mcp.use`/`skill.use`/`plugin.use`，本次未改配置，也未改 `compaction.buffer`。默认不带模型的新会话会落到 `opencode/crouton-alpha-free`，该模型在当前地区返回 403；应用与 mcbot 显式使用 `opencode-go/deepseek-v4.1-flash`，矩阵 V3–V7 用的是这个模型。

### 回滚（本窗口失败即执行）

```bash
sudo systemctl stop opencode
sudo tar -C /var/lib/opencode -xzf /var/backups/opencode/opencode-bin-<TS>.tar.gz
sudo tar -C /var/lib/opencode -xzf /var/backups/opencode/opencode-data-<TS>.tar.gz
sudo cp -a /var/backups/opencode/opencode.env.<TS> /etc/opencode/opencode.env
sudo cp -a /var/backups/opencode/opencode.service.<TS> /etc/systemd/system/opencode.service
sudo systemctl daemon-reload && sudo systemctl start opencode
# 期望运行中 /api/info 回到 2.2.0，且 exe 不含 (deleted)
```

恢复后不要部署 1.0.7。`deploy/tool-versions.json` 在仓库里仍指向 2.2.5 时，未升级的机器不能用严格 smoke 的 `2.2.5` 期望值宣称通过。

## 4. 初始化管理员与 TOTP（必须由本人交互执行）

在**交互式 SSH** 中运行（不要把密码/二维码发到聊天）：

```bash
sudo -u antifieldcloud -H /usr/local/bin/node /opt/antifieldcloud/current/scripts/provision.mjs
```

流程：设置用户名 → 输入两次密码（≥12 位）→ 扫描终端二维码/手动保存密钥 →
输入 6 位验证码 → 保存 10 个恢复码（只显示一次）。

重置：

```bash
sudo -u antifieldcloud -H /usr/local/bin/node /opt/antifieldcloud/current/scripts/provision.mjs --reset-password
sudo -u antifieldcloud -H /usr/local/bin/node /opt/antifieldcloud/current/scripts/provision.mjs --reset-totp
```

## 5. Cloudflare Tunnel 与 DNS

备份并编辑 Pi 上的 `/etc/cloudflared/config.yml`，保留原有 `tunnel`/`credentials-file`/`protocol`，只替换
`ingress` 为仓库 `deploy/cloudflared-ingress.yml` 的内容（示例）：

```yaml
ingress:
  - hostname: app.example.com
    service: http://127.0.0.1:3000
  - hostname: ai.example.com
    service: http://127.0.0.1:3000
  - hostname: mc.example.com
    service: tcp://localhost:25565
  - service: http_status:404
```

```bash
sudo cp -a /etc/cloudflared/config.yml /var/backups/antifieldcloud/cloudflared-config.yml.$(date +%s)
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared -n 30 --no-pager
sudo cloudflared tunnel info <TUNNEL_UUID>    # 检查 connector 与版本升级提示
```

**DNS 由用户在 Cloudflare 后台手动添加**（现有 `cert.pem` 是隧道 token，不是账号证书，CLI 无 DNS 权限）：

| 类型 | 名称 | 内容 | 代理 |
|---|---|---|---|
| CNAME | `app` | `<TUNNEL_UUID>.cfargotunnel.com` | Proxied（橙色云） |
| CNAME | `ai` | `<TUNNEL_UUID>.cfargotunnel.com` | Proxied（橙色云） |

- 不要修改 `mc.example.com`（指向 SakuraFRP，与工作台无关）。
- Cloudflare 代理有 **100MB（Free/Pro）/200MB（Business）请求体上限** 与默认 100s 代理读超时；应用
  `MAX_UPLOAD_BYTES` 默认按 100 MiB 配置，超过上限的上传由边缘直接 413（见 FAQ）。
- cloudflared 以 root 运行；当前已通过 `20-hardening.conf` drop-in 加固（见 §9.6），定期用
  `cloudflared tunnel info` 的版本提示升级（`--no-autoupdate` 不会自动升级）。

### 5.1 Rocket Loader / 自动注入

目标：只为 `ai` 主机关闭 Cloudflare 对模块脚本的改写和自动注入，不影响 `app`。Workbench 把 HTML 原样转发，不再注入垫片。

1. Cloudflare Dashboard → Rules → **Configuration Rules** → Create rule：
   - 表达式：`http.host eq "ai.example.com"`；
   - 设置：**Rocket Loader: Off**；
   - 保存并部署。官方已将 Rocket Loader 从 Page Rules 迁移到 Configuration Rules。
2. Speed → Optimization：如仍启用 Rocket Loader，保持全局设置不动，以 host 规则为准。
3. Web Analytics → Manage Site：自动注入设为 **Disable**（严格 CSP 下 beacon 被拦截）。
4. 如启用 Bot Fight Mode，其 JavaScript Detections 不能单独关闭；可整体关闭或接受控制台 CSP 报错。
5. 验收：
   - `curl -fsS https://ai.example.com/` 的 HTML 中 `type="module"` 未被改写；
   - 认证浏览器确认 DSH Web 的会话、模型选择和 SSE/WS 可用。
6. 回滚：删除该 Configuration Rule。应用侧没有 HTML 模式可切回。

### 5.2 Cloudflare Access 策略与 bypass

目标：在 Cloudflare 边缘给 `app.<domain>` 增加第二层身份校验（应用 TOTP 仍是最终认证），同时保证健康检查与公开分享不被 Access 拦截。
**Access 配置不在仓库内。漏配时 `/healthz` 与公开分享会被重定向到登录页。**

生产当前配置（API 创建；含 AI 主机）：
- 主应用 `AntifieldComplexx`：`app.<domain>`，One-time PIN IdP，策略 `Owner allow`（指定邮箱）+ `Smoke service token`（`non_identity`，指定 service token）。
- 生产仍有 4 个独立 **Bypass** 应用（各自 `Bypass Everyone`）：`/healthz`、`/api/chatbot/webhook`、`/s`、`/api/public/shares`。Workbench 不再提供 QQ Webhook，该 bypass 可以保留。
- service token 名称 `smoke-readonly`，有效期 1 年；Client ID/Secret 只保存在 PC `.local/cf-access.env`（gitignored），不写仓库；`CF_ACCESS_APP_AI_ID` 也已写入该文件。
- 2026-11-14 之前已实测：未登录 `/` 302 到 `*.cloudflareaccess.com`；上述 bypass 路径返回应用状态码而非 302；`ai` 未认证 302、service token 401。
- 2026-11-11 客户端验收：用户在控制台放行应用 `/api`。未登录 `/api/version` 与 `/api/metrics` 返回应用 401 JSON。`POST /api/auth/password` 对 Tauri Origin 的预检为 204，错误口令为 400 JSON 并回显该 Origin。未登录 `/` 与 `/files` 仍 302 到 Access。Windows 与 Android 客户端登录验收通过。service token 不进入安装包。退回 v1.1.1 时连同当时的 Access 策略一起恢复。

手工重建/迁移时按以下步骤：

1. Zero Trust → Access → Applications → Add an application → Self-hosted：
   - Application name：`AntifieldComplexx`；Session duration：建议 8–24h。
   - Public hostname：`app.<domain>`（路径留空）。
   - Policy：`Allow`，Include 选择本人邮箱（One-time PIN）或已配置的身份提供商；不要添加 `Everyone`/`Bypass` 到整站。
2. **先创建 4 个独立的 path 应用**（路径应用的优先级高于整站主应用）：
   - 每个应用 Domain 填 `app.<domain>/healthz`（或对应路径），Policy 选 **Bypass + Everyone**；
   - 路径分别为：`/healthz`、`/s`、`/api/public/shares`。生产上仍在的 `/api/chatbot/webhook` bypass 可以保留。
   - `/s` 与 `/api/public/shares` 覆盖公开分享；`/healthz` 供 smoke 与健康检查。
   - 原生客户端不能完成 Access 浏览器登录。`/api` 必须到达应用；认证仍是密码、TOTP 与设备签名，浏览器写请求另要 CSRF。页面与 `ai` 主机保持 Access。不要把 service token 放进安装包。
3. 验证（未登录浏览器/命令行）：
   ```bash
   # 健康检查：200 JSON，不能是 Cloudflare Access 302
   curl -sS https://app.<domain>/healthz
   # 公开分享：未知 token 应为应用 404，而不是 Access 登录页
   curl -s -o /dev/null -w '%{http_code}\n' https://app.<domain>/s/not-a-token
   # 主应用：未登录应 302 到 <team>.cloudflareaccess.com（或 Access 登录页）
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.<domain>/
   ```
   带 service token 访问受保护 API 应返回应用 401（不是 302），并据此跑完整 smoke。
4. 回滚：删除 path Bypass 应用或整个主 Access Application；清理浏览器 Access Cookie 后重试。回滚后 Webhook/health/分享恢复无边缘身份层，
   应用侧签名/限流仍生效。
5. 注意：Access 的 `Bypass` 只影响边缘身份校验，不改变应用会话/CSRF/签名；不要把 Access 当作应用认证替代品。
   Cloudflare 账号本身必须开启 2FA（Access 配置权限等同于入口控制权）。
6. **service token（供 smoke/CI）**：Zero Trust → Access → Service Auth → Create Service Token，绑定到主应用 `Service Auth` 策略；
   把 Client ID/Secret 通过命令行传给 smoke：
   ```powershell
   .\scripts\smoke.ps1 -PiHost <直连 IP> -ExpectedVersion 1.0.9 -ExpectedSchemaVersion 20 -ExpectedOpenCodeVersion 2.2.5 -ExpectedMcbotVersion 1.0.9 -ExpectedMcbotContractVersion 2 `
     -AccessClientId "<id>" -AccessClientSecret "<secret>"
   ```
   两者必须同时提供，否则脚本直接报错；凭据只用于请求头，不打印/不写仓库。建议专用、最小范围、定期轮换；
   `-SkipPublic` 时不发起公网请求，无需 token。未配置 Access 时不要传这两个参数（传了也被边缘忽略，但无意义）。

## 6. 验证

本机（Pi 上）：

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -H 'Host: app.example.com' -fsS http://127.0.0.1:3000/healthz
```

公网（DNS 生效后）：

```powershell
.\scripts\smoke.ps1 -PiHost 192.0.2.10 -AppUrl https://app.<domain> -AiUrl https://ai.<domain> `
  -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -ExpectedVersion 1.0.9 -ExpectedSchemaVersion 20 -ExpectedOpenCodeVersion 2.2.5 -ExpectedMcbotVersion 1.0.9 -ExpectedMcbotContractVersion 2
```

未启用 mcbot 时追加 `-SkipMcbot`（跳过 `systemctl is-active mcbot` 与 `/healthz.contractVersion` 检查），不得把跳过项计为 PASS。

配置 Cloudflare Access 后，可在同一命令追加 `-AccessClientId/-AccessClientSecret`：脚本会给公网请求附加
`CF-Access-Client-Id`/`CF-Access-Client-Secret` 头，并额外检查“带 token 到达应用但未登录 → 401”；两者必须同时提供，凭据不打印。

`smoke.ps1` 覆盖：公网健康/302/401、CSP/nosniff/referrer/HSTS、首页（仍是管理界面时检查 PWA manifest/sw/offline 为 200；首页为「请使用客户端」时这些路径为 404，且正文不含 `id="root"`）、公开分享页 404/410、
指标/告警/分享等 API 401、Pi 服务与 `/healthz` 版本（`-ExpectedVersion`）、内存 cgroup、nftables 规则/25575 阻断/25565 可达、
备份 pending 与 48h 状态、密钥包状态、世界备份/世界拉取/演练状态文件、已安装脚本 SHA-256 与仓库一致、
本地世界/应用归档 `.sha256` 旁文件；所有 SSH 检查带重试与硬超时。`-SkipPublic`/`-SkipLocalBackup`/`-SkipScriptHash`
用于部署后只读子集。
只读检查（缺依赖返回 `SKIP:` 不计 PASS，可选依赖用 SoftCheck 只 WARN）：OpenCode 版本精确断言（`-ExpectedOpenCodeVersion`）、
mcbot 服务 `active` 与 `/healthz.version` 与 `contractVersion`（`-ExpectedMcbotVersion` / `-ExpectedMcbotContractVersion`，`-SkipMcbot` 跳过）、
`/api/mcp` 的 `botmsg`/`searxng` connected 状态与 MCP 进程数阈值（`-MaxMcpProcesses`）、fail2ban active/jail/bantime、systemd unit 与仓库 SHA 对比、
env 键漂移（相对 bootstrap MANAGED_KEYS）、nftables 可选 SSH 来源断言（`-ExpectedSshSources`）、备份加密配置（开关/公钥 owner/mode/格式/age/`*.plain.tmp` 残留）、
异地副本状态（ok/超期/`plaintextSkipped>0`）、本地备份旁文件与归档 SHA 实测（含 `.age` 必须带 `.meta.json`）、Windows 备份任务安装标记（版本 + 脚本 SHA）。
`-SkipOpenCode/-SkipMcp/-SkipFail2ban/-SkipUnitDrift/-SkipEnvDrift/-SkipEncryption/-SkipOffsite/-SkipLocalTaskCheck/-SkipMcbot` 可按环境跳过。

Windows 备份计划任务（**管理员 PowerShell**；安装脚本会收紧 ACL 并做 Pi 可达性预检）：

```powershell
.\scripts\install-backup-task.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups"
# 只预览不注册：
.\scripts\install-backup-task.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -DryRun
```

手工检查：`https://app.example.com` 登录、上传/预览、Dashboard MC 状态、白名单增删、文件分享与告警卡片；
`https://ai.example.com` 登录后进入 opencode。若 opencode 仍要求输入自身密码，属于其 UI 行为，
从 Pi `sudo grep OPENCODE_PASSWORD /etc/opencode/opencode.env` 获取后输入一次（不写入前端）。

## 7. 主机健康探针（vcgencmd → /run JSON）

`deploy/antifieldcloud-health.service` + `.timer` 每 60s 以 root 采集欠压/降频/温度/风扇并写
`/run/antifieldcloud/pi-health.json`（0644），供应用告警模块读取。

```bash
sudo install -d -m 0755 /usr/local/libexec
sudo install -m 0755 deploy/health-probe.sh /usr/local/libexec/antifieldcloud-health.sh
sudo install -m 0644 deploy/antifieldcloud-health.service deploy/antifieldcloud-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now antifieldcloud-health.timer
sudo systemctl start antifieldcloud-health.service
cat /run/antifieldcloud/pi-health.json
```

- `deploy/antifieldcloud.service` 已设置 `Environment=PI_HEALTH_FILE=/run/antifieldcloud/pi-health.json`；
  更新 unit 后执行 `sudo systemctl daemon-reload && sudo systemctl restart antifieldcloud` 使其生效。
- 告警阈值（磁盘/温度/备份超期/欠压等）由 env 的 `ALERT_*` 控制；webhook 配置只读展示，不在前端存储明文密钥。

## 8. 内存限制检查（重要）

应用 unit 的 `MemoryMax=512M` 依赖内核 memory cgroup；若 Pi 内核命令行包含 `cgroup_disable=memory`，限制不会生效：

```bash
cat /proc/cmdline | tr ' ' '\n' | grep -i cgroup
cat /sys/fs/cgroup/cgroup.controllers        # 必须包含 memory
sudo systemctl show antifieldcloud -p MemoryCurrent -p MemoryMax
```

- 若 controllers 缺少 `memory`：从内核命令行移除 `cgroup_disable=memory`（检查 `/boot/firmware/cmdline.txt` 与固件/镜像
  默认 cmdline 的实际来源），重启，再确认 `memory` 出现在 controllers 且 `MemoryCurrent` 有数值。
- 该项是发布验收的硬性检查（`smoke.ps1` 会失败），不能用“应用内存占用低”代替。

## 9. 防火墙、系统加固、SSH、世界/演练与 Bot 接入

### 9.1 nftables 规则

当前 `deploy/nftables.conf`：默认 `policy drop`；loopback/established/ICMP 放行；DHCP 仅 `eth0`/`wlan0`；
**22 仅 `192.0.2.0/24` + `198.51.100.0/24`（TEST-NET 占位，安装前替换为实际直连/校园网段），且 `ct state new` 限速 `20/minute burst 40 packets`**；
**25565 仅同网段**（IPv6 仅 `fe80::/10`）；**25575 显式 drop**；80 不再放行；出站不限制。

```bash
# 备份 → 语法校验 → 加载 → 验证（root）
sudo cp -a /etc/nftables.conf /etc/nftables.conf.bak.$(date +%s)
sudo nft -c -f deploy/nftables.conf
sudo install -m 0644 deploy/nftables.conf /etc/nftables.conf
sudo nft -f /etc/nftables.conf
sudo systemctl enable --now nftables
sudo nft list ruleset
ss -tlnp | grep -E ':25565|:25575'
```

- **前置确认（否则会锁死 SSH）**：先确认自己当前的 SSH 来源地址在 `192.0.2.0/24` 或 `198.51.100.0/24`（示例占位；实际网段按 `.local/DEPLOYMENT.md` 替换）内；
  不确定时先在 Pi 本机/物理键鼠旁操作，并保持一个已建立的 SSH 会话不要断开。
  实际网段按 `.local/DEPLOYMENT.md` 修改；网段宁窄勿宽。
- 期望：外部 `<Pi IP>:25575` 失败、`127.0.0.1:25575` 正常；22/25565 在允许网段内正常、其它来源不可达；
  22 频繁新建连接会被限速（暴力破解防护）。
- 回滚：`sudo cp /etc/nftables.conf.bak.<ts> /etc/nftables.conf && sudo systemctl restart nftables`；
  紧急解绑（需物理键鼠/已建立 SSH）：`sudo systemctl disable --now nftables && sudo nft flush ruleset`。
  **不要**在只有一条 SSH 连接且来源网段未确认时清空规则。

### 9.2 systemd 加固

`deploy/antifieldcloud.service` 已启用：`CapabilityBoundingSet=`（空）、`AmbientCapabilities=`、`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`、
`PrivateDevices`、`PrivateTmp`、`ProtectSystem=strict`、`ProtectHome=true`、`ReadWritePaths=/var/lib/antifieldcloud`、
`ProtectKernelTunables/Logs`、`ProtectControlGroups`、`ProtectClock/Hostname`、`RestrictNamespaces/SUIDSGID/Realtime`、
`LockPersonality`、`SystemCallArchitectures=native`、`StartLimitIntervalSec=60/StartLimitBurst=5`、`MemoryMax=512M`。

```bash
sudo cp -a /etc/systemd/system/antifieldcloud.service /var/backups/antifieldcloud/antifieldcloud.service.$(date +%s)
sudo install -m 0644 deploy/antifieldcloud.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart antifieldcloud
curl -fsS http://127.0.0.1:3000/healthz
journalctl -u antifieldcloud -n 50 --no-pager
```

- 回滚：恢复备份的 unit → `daemon-reload` → `restart`。若出现 `status=226/NAMESPACE` 或权限错误，先确认
  `ReadWritePaths` 覆盖 `/var/lib/antifieldcloud`，再检查 `/run` 目录归属。
- 健康探针 `deploy/antifieldcloud-health.service/.timer` 与 `PI_HEALTH_FILE` 不变（§7）。
- 世界备份 unit `antifieldcloud-world.service` 也使用同类加固（整机只读、仅数据目录可写、Minecraft 目录只读、空 cap 之外仅保留必要 chown/chmod）。

### 9.3 世界备份 timer 安装与回滚

```bash
# 安装/更新（root）
sudo install -m 0644 deploy/antifieldcloud-world.service deploy/antifieldcloud-world.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now antifieldcloud-world.timer
systemctl list-timers antifieldcloud-world.timer
# 手动触发一次并检查
sudo systemctl start antifieldcloud-world.service
journalctl -u antifieldcloud-world -n 80 --no-pager
cat /var/lib/antifieldcloud/world-backup-status.json
ls -lh /var/lib/antifieldcloud/world-backups/
```

- `OnCalendar=Sun 12:00 Asia/Shanghai`（显式时区）、`Persistent=true`、`AccuracySec=1min`；`flock -w 600` 串行、
  `TimeoutStartSec=4h`；unit 只读整机、仅 `/var/lib/antifieldcloud` 可写、`/home/antifield/minecraft-server` 只读。
- 归档保留最新 4 份（含本次），旧 legacy 文件不动；状态文件 0644，`error/message` 为 ASCII 错误码 + 英文说明，
  便于 PowerShell/前端解析。
- 回滚/停用：`sudo systemctl disable --now antifieldcloud-world.timer`；需要时删除 `/etc/systemd/system/antifieldcloud-world.{service,timer}` 后
  `daemon-reload`。不要删除既有归档；确需清理按「15.6.4 旧 cron 迁移与旧归档手动清理」。
- 旧世界 cron 已在验收后停用；不要同时保留 cron 与 timer，避免重复打包（见 §14）。
- 定时策略（用户 2026-10-21 确认）：仅项目世界备份 timer 统一到周日 12:00；`antifieldcloud-health.timer` 保持每 60s；
  apt-daily/logrotate/fstrim 等系统维护 timer 保持发行版默认，不纳入统一调整。

### 9.4 世界拉取（Windows 周任务，已安装）

```powershell
# 手动跑一次仍用仓库脚本（直连网线可达；占位地址与默认备份根）
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\world-pull.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups"
# 计划任务不要指向仓库路径。install-backup-task.ps1 会把脚本复制到下面的固定副本再注册。
# 任务名保持 AntifieldCloud-World-Pull。-BackupRoot 与每日任务相同。
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1" -PiHost 192.0.2.10 -BackupRoot "%USERPROFILE%\AntifieldCloudBackups"'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 12:00
Register-ScheduledTask -TaskName "AntifieldCloud-World-Pull" -Action $action -Trigger $trigger -Description "AntifieldComplexx 世界备份周度拉取"
```

- 两阶段：scp `.part` → 远端 `.sha256` 比对 → 原子改名 → 删除远端归档/旁文件（ack）；**失败不 ack、不动远端**，退出码 1。
- 本地保留最新 4 份；日志 `%LOCALAPPDATA%\AntifieldCloud\world-pull.log`；远端状态写 `world-pull-status.json`。
- 回滚/停用：`Unregister-ScheduledTask -TaskName "AntifieldCloud-World-Pull" -Confirm:$false`；已拉取归档保留。已安装的脚本副本可留在 `%LOCALAPPDATA%\AntifieldCloud\`。
- `install-backup-task.ps1` 安装每日应用归档任务时，同时安装世界拉取：把 `scripts\world-pull.ps1` 复制到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，注册 `AntifieldCloud-World-Pull`（周日 12:00，时限 3 小时）。`-PiHost`/`-PiUser`/`-BackupRoot` 与每日任务相同。本机备份根见 `.local`，世界归档在该根下的 `world\`。缺源文件时安装脚本在复制和注册之前失败，DryRun 也不写任务。恢复演练仍按 §9.5 手动/季度执行。重装需要管理员 PowerShell，且不要为了改路径再拉一份世界归档。

### 9.5 恢复演练（drill.ps1，季度/升级前）

```powershell
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\drill.ps1 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -ExpectedSchemaVersion 22
# 加密归档：提供离线私钥（先解密校验 plainSha/plainSize，再复用 drill-verify 全量校验）
.\scripts\drill.ps1 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -ExpectedSchemaVersion 22 -AgeIdentityPath "$env:USERPROFILE\.age\backup-age-identity.txt"
# 需要验证世界解包时（先确认临时盘 ≥3× 世界归档体积）
.\scripts\drill.ps1 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -ExpectedSchemaVersion 22 -IncludeWorld
# 回写 Pi 状态（可选）
.\scripts\drill.ps1 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -PiHost 192.0.2.10
```

- 只读校验 PC 上最新 full + 其后全部 inc：sidecar SHA、tar 条目安全、manifest、最新 DB `integrity_check/foreign_key_check/schema_version`；
  输出 `%BackupRoot%\drills\<UTC>\report.json|report.md`（保留 180 天，`-KeepDays` 可调）。
- 可选回写 `/var/lib/antifieldcloud/drill-status.json`（0644），Dashboard 与 `drill_stale` 告警读取；未运行状态 unknown。
- 回滚：不安装计划任务即无需回滚；删除旧报告目录即可释放空间；不要删除归档本身。
- 演练记录仍按「15.7 恢复演练（自动化 + 记录）」表格补充（报告路径 + 结果 + 世界是否解包）。

### 9.6 主机加固现状（环境事实）

- **journald persistent**：`/etc/systemd/journald.conf.d/60-workbench-persistent.conf` 设
  `Storage=persistent`、`SystemMaxUse=64M`、`RuntimeMaxUse=32M`；Pi 的 `/var/log` 由 log2ram 承载，关机前同步。
- **cloudflared**：`2026.10.7`（2026-11-07）；`/etc/systemd/system/cloudflared.service.d/20-hardening.conf` 仍启用
  `NoNewPrivileges/PrivateTmp/ProtectSystem=full/ProtectHome` 等。旧回滚二进制 `cloudflared-2026.10.1` 与 `cloudflared-2026.10.3` 已删除。配置备份 `cloudflared-config.yml.20261019T175406` 仍保留。升级当时登记了 4 条隧道连接；本次清理没有重启 cloudflared，服务仍为 active。
- **rpcbind** 已禁用（111 关闭）；**fake-hwclock** load/save 已启用（无 RTC 电池时近似关机时间），NTP 仍负责校时。
- **RCON**：Paper 无 bind 配置，25575 仍监听所有接口；仅由 nftables 丢弃非 loopback 入站。
- **SSH 已改仅公钥**；**`fail2ban` 已安装并启用 `sshd` jail**
  （nftables 后端，24h ban，dbfile 持久化）；`deploy/systemd/nftables.service.d/10-fail2ban-restore.conf` 在 nftables 启动后异步恢复封禁 set；
  `antifield` 用户的 `NOPASSWD ALL` sudo 仍属既有残留，风险见 `docs/SECURITY.md` §4。

### 9.7 SSH 仅公钥（00- drop-in）与回滚窗口

目标：禁用密码/键盘交互登录，只允许公钥；用 `00-` 前缀确保在 `sshd_config.d` 中优先于云镜像/发行版其它 drop-in 生效。
操作前必须保留一个已建立的 SSH 会话/物理键鼠，并确认当前公钥可登录（`ssh -o PreferredAuthentications=publickey ...`）。
以下以 `00-antifield-hardening.conf` 为例；实际安装的 `00-*.conf` 文件名以本机为准（`ls /etc/ssh/sshd_config.d/`）。

```bash
# 0) 备份（root）
TS=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -o root -g root -m 0700 /var/backups/antifieldcloud
sudo cp -a /etc/ssh/sshd_config /var/backups/antifieldcloud/sshd_config.$TS
sudo ls -l /etc/ssh/sshd_config.d/ | tee /var/backups/antifieldcloud/sshd_config.d.list.$TS

# 1) 写入 00- drop-in（值按实际确认；不要动 Port/AllowUsers 等既有配置）
sudo tee /etc/ssh/sshd_config.d/00-antifield-hardening.conf >/dev/null <<'EOF'
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo chmod 0644 /etc/ssh/sshd_config.d/00-antifield-hardening.conf

# 2) 语法校验后平滑重载；保持现有会话不要退出
sudo sshd -t
sudo systemctl reload ssh

# 3) 新开一个终端验证（不要关闭旧会话）
ssh -o PreferredAuthentications=publickey antifield@<直连 IP> 'echo pubkey-ok'
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin) '
```

- 期望：`passwordauthentication no`、`kbdinteractiveauthentication no`、`pubkeyauthentication yes`；密码登录被拒。
- **回滚窗口**：保留 `/var/backups/antifieldcloud/sshd_config.$TS` 与 drop-in 的副本，记录切换时间；确认 smoke、备份、
  世界拉取、部署脚本（全部依赖公钥）均正常后再删除旧配置副本（至少保留一份到下次演练）。旧备份已归档 `/var/backups/antifieldcloud/`：`/root/sshd-before.txt`、
  `/root/sshd-cloudinit.conf.bak-20261021` 归档到 `/var/backups/antifieldcloud/`（0600 root），活动配置未改。
  回滚：`sudo rm /etc/ssh/sshd_config.d/00-antifield-hardening.conf`（或恢复备份）→ `sudo sshd -t` → `sudo systemctl reload ssh`，
  用密码/公钥重新验证；不要在只剩一条 SSH 连接时回滚。
- `fail2ban` 已启用：`sshd` jail 使用 nftables 后端、`bantime=24h`，只对公网/直连网段内的失败公钥/密码尝试封禁。
  ```bash
  sudo systemctl status fail2ban --no-pager
  sudo fail2ban-client status sshd                 # 当前封禁数/列表/日志文件
  sudo fail2ban-client get sshd bantime            # 期望 86400
  sudo nft list set inet f2b-table addr-set-sshd 2>/dev/null | head   # 封禁 set（名称以实际配置为准）
  ```
  **手工 `systemctl reload nftables` 不会触发** `ExecStartPost`，已有封禁 set 仍会丢失；此时必须手动
  `sudo systemctl restart fail2ban`。fail2ban drop-in 只在 `systemctl start/restart nftables` 时生效。
  改动 nftables 的部署脚本/手工流程要把这一步写进检查表。回滚：`sudo systemctl disable --now fail2ban`
  并移除本地 jail 配置（不恢复密码登录）；如 fail2ban 自身异常，先 `fail2ban-client -t` 校验配置，再看 `journalctl -u fail2ban`。
  日志后端为 log2ram/journald，重启后需确认 `/var/log/auth.log`/journal 仍可读；不要把 `ignoreip` 放得过宽。
- **fail2ban 封禁持久化**：
  - 确认 dbfile：`ls -l /var/lib/fail2ban/fail2ban.sqlite3`；jail 配置中 `dbfile` 指向该 SQLite（重启后从数据库恢复封禁）。
  - 安装 drop-in（仓库 `deploy/systemd/nftables.service.d/10-fail2ban-restore.conf`）：
    ```bash
    sudo install -d -m 0755 /etc/systemd/system/nftables.service.d
    sudo install -m 0644 deploy/systemd/nftables.service.d/10-fail2ban-restore.conf \
      /etc/systemd/system/nftables.service.d/10-fail2ban-restore.conf
    sudo systemctl daemon-reload
    sudo systemctl cat nftables.service | tail -n 8   # 确认 ExecStartPost 与 systemd-run 行
    ```
  - 验证（先制造一个可恢复的测试封禁或记录当前 `fail2ban-client status sshd`）：
    ```bash
    sudo systemctl restart nftables       # 触发 ExecStartPost，3 秒后异步重启 fail2ban
    sleep 5
    sudo fail2ban-client status sshd      # 封禁列表/统计应恢复
    sudo nft list set inet f2b-table addr-set-sshd 2>/dev/null | head
    ```
    不能同步 restart fail2ban：systemd job 会等待 nftables 自身启动作业，形成 ordering 死锁。
  - 手工 `systemctl reload nftables` 不执行 `ExecStartPost`；重载后仍需 `sudo systemctl restart fail2ban` 并复核封禁列表。
  - 回滚 drop-in：删除 `/etc/systemd/system/nftables.service.d/10-fail2ban-restore.conf` → `sudo systemctl daemon-reload`；
    不影响 nftables 规则与 fail2ban 现有封禁。生产已安装并实测 nftables restart 后封禁恢复；Cloudflare Access 也已配置并通过带 token 的 smoke。
- 回滚窗口结束后的验收：`sshd -T` 仍为仅公钥、`smoke.ps1`/备份/部署均通过、旧密码登录失败（可用被测主机/临时用户验证，不要锁死主账号）。

### 9.8 QQ

生产 QQ 由 DSH 管理。Workbench 不再提供 Webhook、发布、OpenCode Chat 或机器人管理页。这些路径不存在。凭据、白名单和会话记忆由 DSH 自己保管。告警只走 webhook。

历史接入记录见 [CHANGELOG](../CHANGELOG.md) 与 [ACCEPTANCE](ACCEPTANCE.md)。

### 9.10 备份整包加密启用/回滚（默认关闭）

```bash
# 1) 离线生成独立备份 age 密钥（PC 或可信离线环境；私钥 ≥2 份、禁止放 Pi）
age-keygen -o backup-age-identity.txt
grep '^# public key:' backup-age-identity.txt   # 取 age1… 公钥

# 2) Pi（root）：写入公钥并校验权限/格式
sudo install -o root -g root -m 0644 /dev/stdin /etc/antifieldcloud/backup-age.pub <<'EOF'
age1...（替换为第 1 步公钥）
EOF
sudo chmod 0644 /etc/antifieldcloud/backup-age.pub
sudo test -O /etc/antifieldcloud/backup-age.pub && ! find /etc/antifieldcloud/backup-age.pub -perm /022 -print -quit

# 3) env 开启（/etc/antifieldcloud/env 或 deploy.conf 路径；bootstrap-env.sh 已纳管）
BACKUP_ARCHIVE_ENCRYPTION=true
BACKUP_AGE_RECIPIENT_FILE=/etc/antifieldcloud/backup-age.pub

# 4) 私钥完成一次解密演练（PC：先做一次加密 prepare 并拉取，或手工加密/解密小文件验证）
#    drill.ps1 -BackupRoot <root> -AgeIdentityPath <identity> -ExpectedSchemaVersion 22
sudo systemctl restart antifieldcloud

# 5) 下一次 prepare 生成 .age；PC 拉取（会校验 .meta.json）并 ack；再跑 drill 解密校验
```

- **浏览器/Dashboard 验证**：Settings → 备份与恢复应显示“加密已启用、公钥已配置”；列表新归档带“加密归档（Web 不可校验/恢复）”；
  `GET /api/version` 的 `backupArchiveEncryption=true`、`backupAgeRecipientConfigured=true`。
- **回滚**：`BACKUP_ARCHIVE_ENCRYPTION=false` 并重启 → 下一次 prepare 恢复明文；已生成 `.age` 保留在 Pi/PC，由 PC 用私钥解密/演练；
  回滚不需要改 schema/DB。私钥丢失则已加密归档不可恢复（明确残余，见 `docs/SECURITY.md` §4）。
- **注意**：加密开启后空间预算按 2× 明文；`*.plain.tmp` 残留由启动/下次 prepare 清理（>24h）；不要手工删除 pending 密文/ sidecar。

### 9.11 异地副本启用/回滚（默认关闭）

```powershell
# 1) PC 先安装/配置 rclone（脚本不创建 remote/凭据）
rclone config            # 新建 remote（如 myremote），保存凭据到当前用户配置
rclone lsd myremote:     # 验证可访问

# 2) 安装异地副本计划任务（可同时保留每日应用归档任务）
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\install-backup-task.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" `
  -InstallOffsiteTask -OffsiteRemote myremote -OffsiteRemotePath AntifieldCloud/backups -OffsiteRemoteLabel myremote

# 3) 先手跑一次（dry-run 可加脚本参数）并检查状态回写与日志
Get-ScheduledTaskInfo -TaskName AntifieldCloud-Backup-Offsite
# Pi: cat /var/lib/antifieldcloud/backup-offsite-status.json
```

- 前提：本地已有加密归档（`.age` + `.meta.json` + `.sha256`）；脚本只上传 `.age`，明文计入 `plaintextSkipped` 且拒绝上传。
- 保留：链感知（最新 full + 其后全部 inc + 最近 N 天）；绝不删最新 full；删除上限与 dry-run 可用；远端只应有 `.age`/`.sha256`/`.meta.json`。
- 告警：`ALERT_OFFSITE_MAX_AGE_HOURS`（默认 48，0 关闭）与 `offsite_overdue`；状态文件缺失/未配置不告警。Dashboard 显示目标别名/计数/时间，不显示远端真实路径/凭据。
- **回滚**：`Unregister-ScheduledTask -TaskName AntifieldCloud-Backup-Offsite`（或 `install-backup-task.ps1` 重装时省略 offsite 参数）；
  已上传远端副本保留；应用归档主链路不受影响。

### 9.12 主机配置模板（deploy/host/）

- 目录：`deploy/host/README.md`（替换/安装/回滚/安全提示）、`sshd_config.d/00-antifield-hardening.conf`、`fail2ban/jail.d/antifieldcloud.local`、
  `cloudflared.service.d/20-hardening.conf`、`journald.conf.d/60-workbench-persistent.conf`、`log2ram.conf`。
- 模板含 `<SSH_USER>` 等占位，安装时必须替换为实际值，并做 `sshd -t`、`systemctl daemon-reload`、`systemctl restart` 后验证会话/服务；
  先复制现有文件备份（`cp -a ... .bak`）。
- 重建/迁移时以模板 + 密钥包（`backup-secrets.sh --include-host-config` 打包的实际配置）对照，避免“主机重建后加固丢失”。
- 回滚：用 `.bak` 覆盖并重启对应服务；nftables/sshd 变更必须先确认 SSH 回滚通道。

## 10. cloudflared 加固与升级（建议）

当前 cloudflared 已通过 drop-in 加固；如需重建/复核，可按实际版本使用以下限制（验证可写路径）：

```bash
sudo systemctl edit cloudflared
# [Service]
# NoNewPrivileges=yes
# ProtectSystem=strict
# ProtectHome=yes
# PrivateTmp=yes
# ProtectKernelTunables=yes
# ProtectControlGroups=yes
# CapabilityBoundingSet=CAP_NET_BIND_SERVICE
# RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
# ReadWritePaths=/etc/cloudflared
sudo systemctl daemon-reload && sudo systemctl restart cloudflared
```

升级：`cloudflared --version` 与 `sudo cloudflared tunnel info <UUID>` 的提示会显示目标版本；apt 源可能滞后，按 Cloudflare
官方 .deb/仓库升级后 `systemctl restart cloudflared`，并在 smoke 中确认隧道 4 连接已注册。

## 11. 应用回滚与数据库

同 schema 回滚先通过新 release 的 `deploy-state.mjs same-schema` 校验 live schema，再停止 Workbench。按部署留存的记录恢复旧配置和 release 指针，启动后校验版本、schema 及 Agent 就绪。数据库文件及 WAL 保持原位。

跨 schema 由管理员在维护窗口完成。优先前向修复以保留新写入。必须回退时先停止 Workbench，并把当前数据库和同名 WAL/SHM 保存到权限为 0700 的独立目录。用 `node scripts/deploy-state.mjs snapshot <迁移前快照> <部署记录中的 SHA-256>` 验证哈希、SQLite 完整性和旧 schema 后，才恢复已验证的快照。旧 WAL/SHM 需与原库一起保全，恢复的快照以独立文件启动。最后恢复配置和指针并复检。
- 每次部署在切换前生成 `/var/lib/antifieldcloud/backups/db-predeploy-*.sqlite`（0600，**保留最新 2 个**：`MAX_PREDEPLOY_SNAPSHOTS=2`，供自动回滚；明文快照属威胁模型明确豁免项，见 `docs/SECURITY.md` §4）。
- schema 只向上，仓库与现行库都是 v22。v22 删除旧 QQ 表，外部告警通道只保留 webhook。v21 增加设备登记、nonce 与会话 `device_id`。迁移单向，没有 down。旧代码遇到更高 schema 会拒绝启动。恢复 v1.2.3 必须先换回迁移前快照 `db-predeploy-20261116T135240676Z.sqlite`，不能只切换 release。
- 关闭 mcbot 对接：设 `MCBOT_ENABLED=false` 并重启应用。只读模式清空控制 Token 后重启，游戏发言返回 503。更早的 release 指针见 CHANGELOG。
- fail2ban drop-in 回滚：删除 `/etc/systemd/system/nftables.service.d/10-fail2ban-restore.conf` → `sudo systemctl daemon-reload`；
  不影响应用数据；回滚后 nftables restart 需手工 `systemctl restart fail2ban`。
- 部署后 smoke 失败的门禁：`deploy.ps1` 默认失败；若已用 `-AllowSmokeFailure` 保留部署，必须在 `docs/ACCEPTANCE.md` 记录未通过项。
- 数据恢复与全量/增量链解析、世界/密钥包恢复见「15.8 恢复（实际命令）」。
- cloudflared 回滚：`sudo cp /var/backups/antifieldcloud/cloudflared-config.yml.<ts> /etc/cloudflared/config.yml && sudo systemctl restart cloudflared`。

## 12. CI 检查

`.github/workflows/ci.yml` 在 push/PR 运行（`concurrency` 取消旧任务、各 job 有超时）：
Node 26 `npm run check` + `npm run build`；服务端覆盖率（`npm run test:coverage`）与前端覆盖率（`npm run test:web:coverage`）；
生产依赖边界（`npm ci --omit=dev` + `scripts/check-prod-deps.mjs`）；`npm audit --omit=dev --audit-level=high`；
gitleaks secret-scan；`shellcheck`（scripts/*.sh、deploy/*.sh）；`nft -c -f deploy/nftables.conf`；
Windows PowerShell job 覆盖**全部** `scripts/*.ps1` 的 PS 5.1 解析 + UTF-8 BOM 检查；Dependabot 月度更新 npm 与 GitHub Actions 依赖。
部署/备份脚本改动必须让 CI 全绿。

版本一致性：`node scripts/check-version.mjs` 比对 `package.json` 与 README/CHANGELOG/ACCEPTANCE/AGENTS、`deploy/env.example` 的
`APP_VERSION`、`docs/DEPLOY.md` 标题与 `package-lock.json` 根版本；并交叉校验 `deploy/tool-versions.json` ↔ `server/src/db.ts`
`SUPPORTED_SCHEMA_VERSION`、`docs/DEPLOY.md §3.2 OpenCode`、`docs/DEPLOY.md 当前 schema`、AGENTS/README/SECURITY/BOT/ACCEPTANCE 的
OpenCode 当前事实（已接入 CI check job）。发布前必须通过；过渡期调试可用 `CHECK_VERSION_ALLOW_STALE_TOOLS=1`，CI/发布不得使用。

其它门禁：`check-prod-deps.mjs`（裸导入边界）、PS 5.1 解析 + UTF-8 BOM（全部 `scripts/*.ps1`，含 `backup-offsite.ps1`）、
`run-tests.mjs` 覆盖率阈值（Lines 91 / Functions 85 / Branches 76）、gitleaks/shellcheck/nftables 语法。公开文档占位符扫描由 PR 审阅把关（不把真实值写入 CI 配置）。

## 13. 常见问题

| 现象 | 处理 |
|---|---|
| `deploy.ps1` SSH 超时 | 直连网线偶发丢包；脚本自带重试；检查 PC 网卡节能、网线、Pi `eth0` |
| `npm ci` 失败 | 确认 Pi 可访问 npm registry；使用 `/usr/local/bin/npm`；查看 `journalctl -u antifieldcloud` |
| 部署健康检查失败 | 脚本已自动回滚；看输出的 journalctl 与迁移前 DB 快照路径；修复后重新部署 |
| 公网 502 | `systemctl status cloudflared`；确认 app 在 3000 监听；DNS 是否 Proxied |
| 上传 >100MB 返回 413 | Cloudflare 套餐请求体上限；调小 `MAX_UPLOAD_BYTES` 或升级套餐，前端会提示大小限制 |
| 登录 429 | 15 分钟内失败次数过多；等待或重启应用清空内存限流 |
| 白名单 502 | RCON 不可用：`ss -tlnp | grep 25575`，`sudo journalctl -u minecraft` |
| `ai` 二次密码 | opencode 自身 Basic UI；按第 6 节输入一次，后续浏览器记住 |
| 内存 cgroup 缺失 | 按第 8 节移除 `cgroup_disable=memory` 后重启；`smoke.ps1` 会检查 |
| 备份 pending 堆积 | 先修直连/计划任务；pending 不会因空间清理被删；查 `backup.log` 与 `--pending` |
| 备份面板红色 | 计划任务失败/超过 48h：查任务 LastTaskResult、`%LOCALAPPDATA%\AntifieldCloud\backup.log` |
| 密钥包未生成 | 按「15.5 密钥包与备份整包加密」安装 age 并写入公钥；不影响普通归档 |
| 磁盘占用 | `df -h /`、`du -sh /var/lib/antifieldcloud/*`；配额 10 GiB；release/备份保留策略见文档 |
| 公网页面空白 / 入口脚本未执行 | app 入口脚本已加 `data-cfasync="false"`；ai 主机的 HTML 原样转发。若仍异常，在 Cloudflare Speed → Optimization/Configuration Rules 关闭 `ai` 的 Rocket Loader |
| 备份密钥包状态红/unknown | 看 `backup-pull.json` 的 `secretsOk/secretsLastError`；检查 age 公钥权限与 `backup-secrets.sh`；文件归档成功不等于密钥包成功 |
| 备份恢复 403 restore_disabled | env 未设 `BACKUP_RESTORE_ENABLED=true` 或未重启应用 |
| 大文件上传 413 | 普通单请求上限 100 MiB；>100 MiB 应自动走分片（`CHUNKED_UPLOAD_ENABLED=true`、5 GiB 上限）。检查 `/api/version` 的 `chunkedUploadEnabled/chunkSizeBytes/chunkMaxFileBytes`，以及块请求是否被 Cloudflare 单请求限制拦截 |
| 校园网暂时无法解析 | 递归 DNS 负缓存（约 30 分钟）；等待或用手机流量验证。不要修改 `mc.example.com` |
| 指标趋势卡空白 | 新部署尚无样本（等待 60s×N）或 `METRICS_ENABLED=false`；看 `/api/metrics?range=1h` 的 `sampleCount` 与 `journalctl` 采样告警 |
| 笔记附件 413/409 | 单文件 ≤`NOTE_ATTACHMENT_MAX_BYTES`（25 MiB）、每请求 1–5、每笔记 ≤100；配额不足 409、磁盘不足 507 |
| 多文件分享 409 share_bundle | 旧单文件 `/content` 不支持多文件；公开页/客户端改用 `items/:itemId/content` |
| 世界备份 unit 失败 | `journalctl -u antifieldcloud-world`；看 `world-backup-status.json` 的 `error/message`；常见 RCON 不可达、磁盘余量不足、save-all 超时；修复后 `systemctl start antifieldcloud-world.service` |
| 世界备份未按时运行 | `systemctl list-timers antifieldcloud-world.timer`；确认 `Persistent=true` 后关机错过的运行会在下次启动补做；检查 unit 是否被 `StartLimit` 限制 |
| 世界拉取失败/不 ack | 看 PC `%LOCALAPPDATA%\AntifieldCloud\world-pull.log` 与 Pi `world-pull-status.json`；失败保留远端归档，重跑即可 |
| 世界/演练状态 unknown | 任务未安装或从未运行；面板按 unknown 展示、告警可能触发；按 §9.4/§9.5 安装并跑一次 |
| 应用了新 nftables 后 SSH 断开 | 来源网段不在 `192.0.2.0/24`/`198.51.100.0/24`（模板占位，需替换为实际网段）；用物理键鼠或已建立连接恢复 `.bak` 并 `systemctl restart nftables` |
| 旧世界 cron 与新 timer 重复备份 | `crontab -u antifield -l` 确认无 `minecraft-backups` 行；旧归档按 §14 与「15.6.4 旧 cron 迁移与旧归档手动清理」手动清理 |
| 部署脚本报“工作树不干净” | 先提交；确需脏发布用 `-AllowDirty` 并在验收记录标注 commit/改动 |
| 部署后 smoke 失败但服务正常 | 默认门禁失败；看 FAIL 项修复后重跑 `smoke.ps1`；临时放行用 `-AllowSmokeFailure` 并记录未通过项 |
| `/healthz` 版本仍是旧版 | 检查 `/etc/antifieldcloud/env` 的 `APP_VERSION` 与 `package.json`；回滚后尤其要确认已还原上一 release 版本 |
| Workbench QQ 路径 | Workbench 不再提供 QQ Webhook、机器人页或 OpenCode Chat。这些路径不存在。生产 QQ 由 DSH 管理 |
| smoke Access token 无效 | 同时提供 `-AccessClientId/-AccessClientSecret`、确认 token 未过期且策略绑定 `app`；不要使用全局/宽范围 token |
| nftables restart 后封禁丢失 | drop-in 未安装/未 `daemon-reload`/dbfile 不可写；手工 reload 不触发，需 `systemctl restart fail2ban`（§9.7） |
| SSH 仅公钥后无法登录 | 24h 回滚窗口内删除 `/etc/ssh/sshd_config.d/00-antifield-hardening.conf` → `sshd -t` → `systemctl reload ssh`；用已建立会话/物理键鼠操作（§9.7） |
| fail2ban 未封禁/启动失败 | `fail2ban-client -t` 校验配置；`journalctl -u fail2ban -n 50`；确认 nftables 后端与 `sshd` jail 已启用、`bantime=86400`；日志后端（log2ram/journald）可读 |
| nftables 重载后封禁列表清空 | fail2ban 的封禁 set 随 nftables 重建丢失：`systemctl restart fail2ban` 后 `fail2ban-client status sshd` 复核；把该步骤写进 nftables 变更清单 |

## 14. 磁盘清理与保留策略

> 清理只允许 **孤儿归档 / 保留期到期 / 旧 release / 过期备份** 四类；任何操作先只读确认 + 二次确认，**不删除用户文件**。
> `DATA_DIR/bot-memory` 不属于上述四类，仅在确认无对应 Bot 记忆或 `chatbot_ai_memories` 时按保留期/人工清理，不得借“清理”删除活跃记忆。
> 不执行 `rm -rf /var/lib/antifieldcloud`、`/home/antifield/minecraft-server`、`/var/lib/opencode` 或 `data/` 下用户内容。

### 14.1 只读盘点（先做）

```bash
df -hT /; df -i /; du -xhd1 /var/lib/antifieldcloud /opt/antifieldcloud /home/antifield 2>/dev/null
journalctl --disk-usage
sudo -u antifieldcloud -H /usr/local/bin/node /opt/antifieldcloud/current/scripts/backup.mjs --pending   # 只看 pending/孤儿/partials
ls -1dt /opt/antifieldcloud/releases/* | head -n 5
ls -lh /var/lib/antifieldcloud/world-backups/ /var/lib/antifieldcloud/backups/secrets/ 2>/dev/null
```

### 14.2 可清理清单（仅四类，逐项确认）

| 类别 | 条件 | 命令示例 | 确认点 |
|---|---|---|---|
| 孤儿应用归档 | DB 无记录（`--pending.orphans`）且不是 pending/已确认 | `sudo rm -f /var/lib/antifieldcloud/backups/<name>.tar.gz{,.part,.sha256}` | 先列文件 + 记录 SHA/大小；确认与 `--pending` 输出一致 |
| 保留期到期备份 | PC `daily` >30 天、`weekly` >56 天、`secrets` >90 天；`db-predeploy-*.sqlite` 超过最新 **2** 个 | 在 PC 按目录/日期删除；Pi 只删最旧的 `db-predeploy-*` | 至少保留一份可解包副本；不删最新 full 链；不删最近迁移快照（自动回滚依赖） |
| 旧 release | 不是 `current`/`previous`，且早于两代 | `sudo rm -rf /opt/antifieldcloud/releases/<old>` | `readlink -f current/previous` 后确认 |
| 过期备份残片 | 已删除归档遗留的 `.part`/`.sha256`（无对应归档）或超 6h 的世界 `.part` | `sudo rm -f <对应残片>` | 先确认无同名正式归档；世界 `.part` 由脚本清理，手工仅限确认无人运行时 |
| 加密临时/孤儿 | `*.plain.tmp` 超过 24h 且确认无 prepare 在跑；`*.part.age`/`.meta.json.part` 无对应正式归档；`*.tar.gz.age` 有密文但 DB 无行（孤儿） | `--pending` 报告的 `partials/orphans` 为准，人工确认后再删 | **孤儿密文只报告不自动删**；缺 `.meta.json` 的归档先补/查因，不直接删；pending 中的 `.age`/sidecar 一律不动 |

- 以上四类之外（apt 包缓存、journald、开发缓存、cloudflared 回滚二进制、Bot 事件/指标/审计自动保留）**不属本清理清单**，
  按系统维护/各自保留策略另行评估，不得借“清理”删除应用数据或用户文件。
- 世界归档/世界拉取归档由脚本滚动保留 4 份，**不手工删除**；PC `world\` 同理。

### 14.3 明确不清理

- 除 §14.2 明确允许的孤儿/过期项外，`/var/lib/antifieldcloud` 的 DB、`files/`、`backups/`（pending/acked/imports/secrets）、`world-backups/`、`*-status.json` 一律不清理。
- `/var/lib/opencode`、`/etc/opencode`、`/etc/antifieldcloud/env`、`/etc/cloudflared/*`、`/home/antifield/minecraft-server/world`。
- 当前与 previous release、`/var/swap`、`preflight/age-key`、离线 age 私钥。
- `minecraft-backups` 归档已清理；如再次出现，仅在确认 PC 副本可解包后按「15.6.4 旧 cron 迁移与旧归档手动清理」处理。
- 用户文件（`files/` 与笔记附件）永不因“磁盘清理”删除；需要释放空间时用应用的回收站/配额流程。

### 14.4 二次确认与记录

1. 对每个待删文件先 `ls -l` + `sha256sum`（归档）并记录到运维日志/`docs/ACCEPTANCE.md`；
2. 删除前再次 `df -hT /` 记录释放前余量；
3. 删除后运行 `smoke.ps1` 与 `backup.mjs --pending`，确认无新增 pending/失败；
4. 任何“孤儿”判断以 DB/CLI 输出为准，不凭文件名猜测；不确定时保留并上报。
5. `world-backups` 由脚本保留最新 4 份；PC `world\` 同样保留 4 份；不要手动删 `world-<UTC>.tar.gz` 或 `.sha256`。
6. `metrics_samples` 30 天、`audit_log`/`alert_events` 90 天由应用自动清理；`db-predeploy-*.sqlite` 保留最新 **2** 个；不要手工删表。
7. 备份加密/异地相关目录（`backups/` 下的 `.age`/`.meta.json`/`.sha256`/`*.plain.tmp`、PC 远端副本）不在清理清单；按「15.5.1 备份整包加密」「15.5.2 异地副本」与本节“加密临时/孤儿”行处理。

## 15. 备份与恢复

目标是在 SD 卡损坏、误删、升级失败或世界损坏时恢复 `/var/lib/antifieldcloud` 与 Minecraft 世界。

四条链路是：应用数据归档、age 密钥包、Minecraft 世界归档，以及 PC 上的异地副本。归档和密钥包只落在 Pi、PC 备份目录或离线介质。Web 不持有私钥。加密归档只能在 PC 上用离线私钥解密、校验和恢复。

### 现行加密与异地副本

生产已开启整包加密。模板默认仍是关闭。Pi 只持有独立备份公钥，私钥留在 PC 和第二份离线副本。失败不回落明文。历史明文留在本机受限目录，不上传。

异地远端只接受 rclone 配置名。单字母盘符、本地路径和嵌在名称里的子路径会被拒绝。子目录只通过 `-RemotePath` 传入。Windows 任务可以显式传入 `-RcloneBin` 和 `-RcloneConfig`。配置目录只给当前用户、Administrators 和 SYSTEM。

生产异地副本是 Google Drive：独立 OAuth 客户端、`drive.file`、专用目录，以及 Production 状态。脚本只复制 `.tar.gz.age` 和 SHA、元数据旁文件。远端密文、SHA-256 和元数据三件套齐备才计入保留基线。任一上传或确认失败时，这一轮不删除旧链。

每日 13:00 的异地任务已启用。世界归档和独立密钥包仍由 PC 拉取，不进这条云端链。隐私说明见 [BACKUP-OAUTH-PRIVACY](BACKUP-OAUTH-PRIVACY.md)。

密钥包收录 mcbot 目标库、任务状态，以及主世界、下界和末地的世界记忆。每个文件单独记录 SHA-256 和大小。目标库快照使用 DELETE journal。生产原库的 WAL 不改。非空且未登记的 WAL 不能丢掉。

状态文件由固定维护入口写入。来源是随机临时文件，并受 64 KiB 上限约束。最近一次应用与世界隔离演练是 `20261113T081625Z`。

>`MCBOT_ENABLED=true` 时，age 密钥包在 `mcbot-state/` 收录目标库 SQLite 一致性快照、手动任务状态及世界记忆。清单逐项记录 SHA-256 和大小，状态为 `included`、`not_created` 或 `read_failed`。目标库必须已初始化。读取或校验失败时密钥包失败。Windows 拉取和 `smoke.ps1 -RequireMcbotState` 检查收录状态。

在 PC 私有临时目录解密密钥包后，仅解出 `mcbot-state/`。先执行 `node scripts/backup-mcbot-state.mjs verify <隔离目录>/mcbot-state` 核对清单与内容，再在该副本上执行 `restore`。恢复检查只输出计数与是否有待恢复任务。启动时在途目标转入暂停，已完成步骤保留。核对目标、任务和记忆后清理临时明文。

> **DSH 密钥包与冷备**。`DSH_WEB_URL` 与 `DSH_WEB_SSO_SOCKET` 同时配置时，密钥包必须包含 DSH 配置、凭据、Web Cookie 签名凭据和 QQ 结构化记忆一致性快照。PC 校验 `agentRuntime=dsh` 和 `includesDsh=true`。只配置其中一项时密钥包失败。两项都空时仍保存 OpenCode 回滚档，并要求 `includesOpencode=true`。部署和退役窗口用 `scripts/dsh-cold-backup.sh` 保存包括会话历史的独立加密归档，转移到 PC 并做隔离解密与恢复。密钥包和冷备保持 age 加密。


演练按 manifest 验证覆盖水位，允许重叠，发现空洞或水位倒退即失败。解包后对账目标 SQLite 中全部文件，校验大小与已有 SHA-256，历史无哈希项单独计数。链上曾缺失而后来补齐的文件可用于 Web 恢复。使用 `-IncludeWorld -RequireWorld` 在临时目录校验世界解包；运行报告可用 `-ReportRoot` 指定单独目录。`-RestoreOutputDir` 只在链、目标库和引用文件全部通过后，把 `db.sqlite` 与引用文件发布到尚不存在的目录。世界解包与该目录相互独立。

### 15.1 策略

| 链路 | 频率/触发 | 保留 | 确认方式 |
|---|---|---|---|
| 应用数据归档 | 每日（Windows 任务触发 `--prepare`，或 Web 手动 prepare） | Pi pending 直到确认、已确认 2 个；PC daily 30 天、weekly 56 天 | PC 校验密文/明文哈希后 `--ack` 才推进游标 |
| 应用归档整包加密 | 随应用归档（`BACKUP_ARCHIVE_ENCRYPTION=true`，默认关闭） | 同应用归档；Pi 只存 `.age` 与外部 sidecar | PC 拉取 `.age` + `.meta.json`，私钥离线 |
| 密钥包 | 每日随应用拉取任务执行 `backup-secrets.sh` | Pi `KEEP=2` 滚动；PC 90 天 | PC 拉取并校验 `.sha256` + `includesOpencode` |
| 异地副本 | 每日/自定义（`AntifieldCloud-Backup-Offsite`，默认关闭） | 远端链感知保留（最新 full + 其后全部 inc + 最近 N 天） | `rclone copyto --checksum` + 远端大小校验 |
| 世界备份 | 每周日 12:00（`antifieldcloud-world.timer`，显式 Asia/Shanghai，Persistent） | Pi 最新 4 份；PC `world\` 最新 4 份 | PC `world-pull.ps1` 校验 SHA 后删除远端（ack） |
| 恢复演练 | 季度/升级前手动运行 `drill.ps1` | 报告 180 天 | 报告通过 + `drill-status.json` |

- **两阶段（应用归档）**：Pi 端 `--prepare` 生成归档并记为 `pending`；Windows 拉取并校验 SHA-256 后 `--ack` 才推进备份游标。
  PC 未确认前 Pi 不删除 pending 归档，网络/PC 故障不会造成“归档已删但未备份”的数据丢失。
- **应用归档频率**：每日一次；建议的“全量”条件为“无已确认全量或最近全量超过 7 天”，由 `--pending` 的
  `needsFull/recommendedMode` 计算，Windows 任务按推荐模式执行（错过的周日会在下一轮补做全量）。
- **增量依据**：从生成归档所用的同一 SQLite 快照读取全部 `kind='file'`，包括回收站和笔记附件。覆盖集是最近一条有效全量链的 `manifest_json.files`。已确认归档以 SHA 校验后的记录为准，Pi 上的副本可以已经清掉。参与该链的 pending 必须仍在磁盘上，大小与记录一致；加密包还要有有效 sidecar。pending 损坏或缺失时停止生成并留下证据，不删除该 pending。没有可用基线、链上出现已删除空洞，或 manifest 无法证明覆盖时改为新全量；这些检查通过后才允许 `--full`。已找回的 `skippedMissing` 会再次进入增量。归档时间取真实 UTC 与最近一份本机归档时间加 1 毫秒的较大值。时钟告警仍用真实 UTC。`import` 归档不参与这条时间。重命名/移动只改元数据，由 DB 快照覆盖。
- **空间保护**：生成前检查剩余空间（本次估算 + 现有 pending + 仍占盘的已确认归档 + 孤儿归档 + 2 GiB），不足则返回 JSON 错误且不生成归档；
  **开启整包加密时本次估算按 2× 明文**（明文 tar 与密文峰值同时存在）+ 上述余量；世界备份按 `1.5 × 世界目录体积` 预检。
- **完整性**：归档 SHA-256 写入 DB 与 PC 的 `.sha256` 旁文件（**加密归档的 `.sha256` 始终表示密文 SHA-256**）；`--ack` 会再次校验 Pi 上文件；PC 下载后校验再原子改名。
- **整包加密（默认关闭）**：`BACKUP_ARCHIVE_ENCRYPTION=true` 时 `--prepare` 用独立备份 age 公钥生成 `*.tar.gz.age`，明文 SHA-256/大小只写归档外 sidecar 与 DB；失败关闭，绝不回退明文；私钥离线，Web 不持私钥（详见 §15.5.1）。
- **异地副本（默认关闭）**：PC 端 `backup-offsite.mjs/.ps1` 只上传 `.age`，链感知保留并写状态回 Pi；应用只读展示与告警（详见 §15.5.2）。
- **孤儿/legacy**：备份目录中无 DB 记录的归档只报告、不自动删除；无参数 legacy 入口必须显式 `--legacy`，不再隐式 ack。
  旧世界归档命名 `world-<YYYYMMDD>.tar.gz` 不匹配新的 `world-<YYYYMMDDTHHMMSSZ>.tar.gz` 规则，永远不会被自动清理。
- **QQ 凭据**：schema 22 起 Workbench 不再保存 QQ 凭据或 chatbot 表。生产 QQ 凭据在 DSH 密钥包与冷备里。env 里残留的 `CHATBOT_SECRET_KEY` 不参与 Workbench 恢复；清理用 `bootstrap-env.sh --force --prune-unknown`，先备份 env。
  普通归档仍含 TOTP 与会话，按敏感数据处理。

### 15.2 应用归档结构与协议

```text
# 明文（默认）
snapshot-20261019T100101239Z-full.tar.gz
├── backups/db-20261019T100101239Z.sqlite    # 一致性 DB 快照
├── backups/manifest-20261019T100101239Z.json
└── files/<xx>/<id>                           # 本次新增/全量文件内容

# 加密（BACKUP_ARCHIVE_ENCRYPTION=true）
snapshot-20261019T100101239Z-full.tar.gz.age          # age 密文（tar.gz 整体加密）
snapshot-20261019T100101239Z-full.tar.gz.age.sha256   # 密文 SHA-256
snapshot-20261019T100101239Z-full.tar.gz.age.meta.json# 归档外明文元数据（sidecar，schema 2）
```

`manifest.json` 字段（明文归档）：`schema:1 / createdAt / mode(full|inc) / since / database / files[] / fileCount / totalBytes /
skippedMissing[] / warnings[]`。`skippedMissing` 记录“DB 有行但磁盘文件缺失”的文件 id，恢复计划会据此剔除并报告；
`warnings` 记录缺失/时钟回拨等告警。

**加密归档**：归档内 manifest 使用 `schema:2`，只保留 `schema / createdAt / mode / since / database / files[] /
fileCount / totalBytes / skippedMissing / warnings / encrypted:true / archiveFormat:"tar.gz.age"`；**明文 SHA-256 与明文大小不放进被加密的
归档内部**（否则构成自引用），改由归档外 `<name>.meta.json`（`schema:2`，字段 `name/mode/createdAt/archiveFormat/encrypted/
encryptedWith:"age"/recipient/plainSha256/plainSize/cipherSha256/cipherSize`）与 DB `backup_archives.manifest_json` 保存。
归档名唯一可信来源是后缀 `.tar.gz.age`，不新增 DB 列/表（无 schema 迁移）。

DB 表 `backup_archives` 记录：`name(PK) / mode / created_at / sha256 / size / file_count / pulled_at / acked_at /
deleted_at / origin / verified_at / manifest_json / last_error`；`origin` 区分 `pi`（Pi 生成，参与 pending/ack）与
`import`（Web 导入，不参与 ack 游标）。`backup_state.last_backup_at` 只在 `--ack` 后推进。
`restore_plans` 记录文件级恢复计划（归档链、选择、目标名、状态、操作者、过期、`skippedMissing`）。
`meta.backup_missing_files` 记录上次缺失、等待恢复后补入增量的文件 id。
**归档状态语义**：已 ack 的 Pi 归档在 PC 拉取确认后可能主动删除服务端文件；API 对这类行返回
`status=acked`、`available=false`，Dashboard 显示“已确认”而不是“文件缺失”，Backups 页恢复按钮禁用并提示“服务端副本已清理”。
只有未 ack 的 Pi 归档或缺失的导入归档才会返回 `status=missing`。

`--prepare` 先写 `snapshot-*.tar.gz.part`，tar 成功后才原子改名为正式归档；失败/超时清理本次 `.part` 与陈旧锁。
**加密路径的崩溃一致性顺序**：tar → `*.plain.tmp` → 计算 plain SHA-256/size → age 加密到 `*.part.age` → rename `.age` → 写 sidecar（temp+rename）→ unlink `.plain.tmp` → 写 DB 行；崩溃最多留下可清理临时文件或“有密文无 DB 行”的孤儿（只报告、不自动删除）。unlink 先于 DB 行以缩短明文窗口，sidecar 已先落盘，因此密文/元数据仍可诊断。加密开启时 age 缺失/公钥非法/加密失败/空间不足均在 `--prepare` 阶段失败关闭，不产生 pending、不降级明文；启动/下次 prepare 清理超过 24h 的 `*.plain.tmp` 残留。
Web `prepare` 超时由 `BACKUP_PREPARE_TIMEOUT_SEC` 控制（默认 3300 秒，允许 60–7200），与 CLI/PC 侧 55 分钟对齐，避免大归档中途被杀。
陈旧锁（`.backup.lock` 超过 1 小时）可被接管并记录 warn；ack 的归档行、游标、`meta.backup_missing_files` 与审计在同一事务内提交。

### 15.3 Pi 端命令（以 antifieldcloud 运行）

```bash
CLI="sudo -u antifieldcloud -H /usr/local/bin/node /opt/antifieldcloud/current/scripts/backup.mjs"

$CLI --pending                    # {"ok":true,"count":..,"pending":[..],"needsFull":..,"recommendedMode":"full|inc",
                                  #  "orphans":[..],"partials":[..],"missingFiles":[..],"warnings":[..]}
$CLI --prepare --full             # 生成全量 pending 归档（不推进游标）
$CLI --prepare                    # 生成增量 pending 归档（无历史时自动全量）
$CLI --ack <name> --sha256 <hex>  # 校验后确认拉取、推进游标并清理过旧已确认归档（幂等、事务化）
$CLI --snapshot-db                # 仅做一致性 DB 快照（部署/升级前用），输出 {"ok":true,"snapshot":...}
```

- 成功输出单行 JSON；失败 `{ok:false,error}` 且退出码 1。归档权限 0640；DB 快照与清单 0600；`.backup.lock` 超过 1 小时视为陈旧并可接管（记 warn）。
- `--prepare` 额外返回 `warnings[]` 与 `skippedMissing[]`；加密开启时另返回 `encrypted:true / archiveFormat:"tar.gz.age" / metaName / plainSha256 / plainSize`。`--pending` 额外返回
  `orphans/partials/missingFiles/missingFileCount/warnings`；每个 pending 项带 `encrypted / archiveFormat / metaName / metaExists`，加密归档缺 sidecar 时在 `missingSidecars[]` 与 `warnings[]` 中提示（补齐前不得 ack/删除）。Windows 脚本用 `--no-warnings` 抑制重复提示（仍保留关键字段）。
- `--ack` 对加密归档接受 `.age` 名与密文 SHA-256（`pending[].sha256` 即密文 SHA），ack 后清理归档 + `.sha256` + `.meta.json`；`--deadline/cleanup` 不误删仍属于 pending 的 `.meta.json`。
- 上次缺失文件记录在 meta `backup_missing_files`：恢复物理文件后即使 `created_at` 早于增量水位，也会被强制纳入下一次增量并在 ack 时写回；
  这样不会因水位越过而永久漏备。
- `--ack` 只接受与 DB 记录一致的 SHA-256，且只允许游标前进（乱序 ack 安全）；ack 的归档行、游标、meta 与审计在同一事务内提交。
- 兼容入口：必须显式 `$CLI --legacy` 才执行“prepare + 立即 ack”；普通无参数运行会报错，旧脚本/任务应改用 `--prepare`/`--ack`。输出会标记 deprecated。
- 保护上限：归档内 DB 快照 ≤256 MiB、行数 ≤10 万；staging（解包临时目录）≤2 GiB 且不超过可用空间 20%；
  归档内容浏览 `GET /api/backups/archives/:name/entries` 按 IP 限流 30 次/分钟。

### 15.4 Windows 每日应用归档任务

```powershell
# 管理员 PowerShell；-PiHost/-BackupRoot 会显式写入任务参数（不要再依赖脚本默认占位值）
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\install-backup-task.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups"
# 可选：同时安装异地副本任务（默认关闭；需先配置 rclone remote）
.\scripts\install-backup-task.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" `
  -InstallOffsiteTask -OffsiteRemote myremote -OffsiteRemotePath AntifieldCloud/backups -OffsiteRemoteLabel myremote
```

- 任务名 `AntifieldCloud-Backup-Pull`；每日 `12:00` + 登录后补跑；电池供电时也运行；仅当前用户登录时运行。`-InstallOffsiteTask` 另建 `AntifieldCloud-Backup-Offsite`（默认每日 13:00、6h 超时、IgnoreNew）。
- **更新仓库后必须重装任务**：`install-backup-task.ps1` 会把最新 `backup-pull.ps1` 复制到 `%LOCALAPPDATA%\AntifieldCloud\` 并更新
  `backup-task.json` 的脚本 SHA/参数；重装后手跑一次，确认日志 `secrets=ok`、Pi `backup-pull.json` 的 `secretsOk=true`
  （密钥包内含 `CHATBOT_SECRET_KEY`，脚本不打印值），且 archive/SHA 校验通过。
- 安装脚本会：复制 `backup-pull.ps1` 到 `%LOCALAPPDATA%\AntifieldCloud\`；用 `icacls` 把备份目录 ACL 收紧为
  **当前用户 + Administrators + SYSTEM**（逐项校验，非白名单主体即失败）；安装前做 `PiHost:22` 可达性预检；
  回读校验任务参数并写安装标记 `backup-task.json`（版本/脚本 SHA/参数）；`-DryRun` 只打印计划不注册任务。
- 拉取流程：`--pending` →（无 pending 才 `--prepare`）→ `.part` 下载 → 密文 SHA-256 校验 → 原子改名 → 写
  `<archive>.sha256` →（加密归档：先拉 `<archive>.meta.json` 并校验 schema/name/mode/archiveFormat/encrypted/encryptedWith/recipient/plainSha256/plainSize/cipherSha256/cipherSize 与 pending 一致）→ `--ack` → 删除 Pi 归档、`.sha256` 与 `.meta.json`；失败保留 pending，下一轮重试同一归档，不重复生成；
  同轮已 ack 的归档跳过。**缺/非法 `.meta.json` 的加密归档按项跳过（不 ack、不删远端、`sidecarMissing` 记录），其余归档继续**；单个归档下载/SHA 失败仍中止本轮（避免错误 ack）。
- `-AgeIdentityPath`（可选）：对加密归档用 `age -d -i` 解密到临时文件，校验 `plainSha256/plainSize` 后立即删除临时明文；私钥路径与明文内容不写日志/状态。未提供则只做密文校验，状态 `plainVerified=null`。
- 所有 SSH/SCP 有硬超时（`Start-Process` + `taskkill /T /F`），secrets 拉取独立 try；`backup-pull.json` 分开记录
  `secretsAttempted/secretsOk/lastSecretsAt/secretsLastError/secretsArchiveName/secretsIncludesOpencode/includesHostConfig`，
  加密状态另记 `encrypted/plainVerified`；secrets 失败 `ok=false` 且退出码 1。
- 状态 JSON 在重试循环外一次性写入：写失败只记错误、不触发再次 prepare（避免重复归档）。
- PC 保留：`daily` 目录按时间保留 30 天、`weekly` 保留 56 天（8 周）、`secrets` 保留 90 天；日志
  `%LOCALAPPDATA%\AntifieldCloud\backup.log`（超过 1 MiB 自动轮转为 `backup.log.1`）。
- 状态：成功拉取后写 `/var/lib/antifieldcloud/backup-pull.json`，面板“备份”卡与告警读取；文件成功但密钥包失败会显示异常。
- 旧任务 `PiBackUp-Nightly` 保持原样，不修改。

### 15.5 密钥包与备份整包加密（age；整包加密默认关闭）

Pi 上安装 `age`，离线生成密钥对（私钥不要放 Pi/仓库）：

```bash
# 在 PC/离线环境（或 Pi 上生成后立刻把私钥移走）
age-keygen -o age-secrets.txt         # 文件内含私钥；妥善离线保存
grep '^# public key:' age-secrets.txt # 取 age1... 公钥
```

```bash
# Pi（root）：写入公钥、安装 age、生成密钥包
sudo apt-get install -y age
sudo install -o root -g root -m 0644 /dev/stdin /etc/antifieldcloud/secrets-age.pub <<'EOF'
age1...（替换为你的公钥）
EOF
sudo bash /opt/antifieldcloud/current/scripts/backup-secrets.sh
```

- 打包内容：`/etc/antifieldcloud/env`（含 `CHATBOT_SECRET_KEY` 与 `CHATBOT_*`）、`/etc/cloudflared/config.yml`、`/etc/cloudflared/cert.pem`、
  `/etc/cloudflared/<tunnel-uuid>.json`、`/home/antifield/minecraft-server/server.properties`、
  `/etc/opencode/opencode.env`、opencode `opencode.json`/`service.json` 及 opencode SQLite 一致性快照。
- 明文只在 0700 临时目录：优先 `/run/antifieldcloud/secrets-tmp`（tmpfs，重启即清），不可用时回退 `/tmp`；
  启动前清理上次残留，退出路径 trap 清理，不留下未加密产物。
- opencode DB 快照必须成功：临时快照父目录使用独立 0711 目录（默认 `/run/antifieldcloud/secrets-tmp-opencode`），
  快照子目录 0700 归 opencode；失败（目录不可遍历/不可写、node:sqlite 失败）直接使脚本失败退出，
  **不生成半成品密钥包**并由备份拉取状态置 `secretsOk=false`，避免“只 warning、PC 仍显示成功”的静默漏备。
- 脚本校验 age 公钥 root 属主/不可组写；不输出密码/密钥。
- 输出：`/var/lib/antifieldcloud/backups/secrets/secrets-<UTC>.tar.age` + `.sha256`；目录 root:antifield 2750，文件 0640。
- **保留**：Pi 端 `SECRETS_KEEP`/默认 `KEEP=2` 滚动保留最新 2 份；Windows 任务拉到本地后**不再立即删除远端密钥包**
  （PC 失败时可复用同一份）；PC 保留 90 天。
- 未安装 age/未配置公钥时只记录警告，不影响文件归档备份；但 secrets 状态会显示失败/未尝试。
- **主机配置可选打包**：`backup-secrets.sh --include-host-config` 会把 `deploy.conf`、`/etc/nftables.conf`、
  sshd drop-in、fail2ban jail、cloudflared/journald/nftables drop-in、应用 units、log2ram 配置中存在的文件一并打入密钥包，
  输出 `includesHostConfig`/`hostConfigFileCount`；模板与重建清单见 `deploy/host/README.md`。
- **`includesOpencode` 硬校验**：已安装 opencode（存在 opencode 用户或数据目录）但 DB 快照缺失/Node 不可执行时，
  `backup-secrets.sh` 直接失败、不生成“缺 opencode DB 的成功密钥包”；PC 拉取校验 `meta.includesOpencode`，否则 `secretsOk=false`。

#### 15.5.1 备份整包加密（独立 age 密钥，默认关闭）

- **目标**：应用归档落地即密文，避免 PC 备份目录/Pi 介质泄露直接暴露 TOTP secret、Bot 密文与文件内容。
  默认关闭（`BACKUP_ARCHIVE_ENCRYPTION=false`）；与 `secrets-age` **使用独立密钥对**，互不复用。
- **密钥**：Pi 只存公钥 `/etc/antifieldcloud/backup-age.pub`（root 属主、组/其他不可写、单行 `age1…`、≤4 KiB；
  启动时校验属主/权限/格式）；私钥离线保存 ≥2 份，**禁止放 Pi/仓库/PC 备份目录**。启用前必须用私钥完成一次
  `age -d` 解密 + 一次 `drill.ps1 -AgeIdentityPath` 演练，否则可能出现“备份成功但永不可恢复”。
- **命名与元数据**：`snapshot-<stamp>[-n]-(full|inc).tar.gz.age`；sidecar `<name>.meta.json`（schema 2）；
  `.sha256` 始终是**密文** SHA-256；`recipient`/`encryptedWith` 写入 sidecar、DB `manifest_json` 与 API 元数据（公钥非秘密），
  便于密钥轮换时识别不同公钥的归档。
- **失败关闭**：加密开启时 age 缺失/不可执行、公钥非法、加密失败、密文为空、空间不足（按 2× 明文）→ `--prepare` 失败，
  不产生 pending、不留明文最终归档、**不得降级明文**。临时明文使用 `*.plain.tmp`，密文+sidecar 落盘后立即删除；
  启动/每次 prepare 清理超过 24h 的残留。
- **空间**：峰值 ≈ 明文 tar + 密文 ≈ 2× 本次估算；预算 = 2× 估算 + pending + acked 未清理 + 孤儿 + 2 GiB 保留。
- **Web 边界**：应用不持私钥。`verify/import/entries/restore-plan/executeRestore` 对 `.age` 在归档名校验之前返回
  `409 archive_encrypted`（加密归档是预期状态，不写 `last_error`）；自动恢复目标选择跳过加密归档；Web UI 禁用对应按钮并展示
  “加密归档（Web 不可校验/恢复）”。整库恢复同样只能 PC 解密后走 §15.8.1。
- **启用顺序**（默认全关，可逐步回滚）：离线生成备份 age 密钥 → Pi 写公钥 → 私钥完成一次解密/演练 →
  `BACKUP_ARCHIVE_ENCRYPTION=true` 并重启 → 下一次 prepare 生成 `.age` → PC 拉取 + `--ack` → drill 解密校验 → 再配置异地副本。
  **回滚**：关闭开关恢复明文；已生成的 `.age` 保留（PC 侧解密/演练），不要在 Pi 上尝试解密。
- **环境变量**：`BACKUP_ARCHIVE_ENCRYPTION`、`BACKUP_AGE_RECIPIENT_FILE`（`bootstrap-env.sh` 已纳管）；测试夹具可用
  `BACKUP_AGE_FAKE=1`/`BACKUP_SKIP_KEY_OWNER_CHECK=1`（仅本地夹具，生产禁用）。

#### 15.5.2 异地副本（PC 端 rclone，默认关闭）

- **组成**：`scripts/backup-offsite.mjs`（纯逻辑 + CLI，链规划/保留/校验）+ `backup-offsite.ps1`（计划任务入口，硬超时、
  日志轮转、状态回写）+ `install-backup-task.ps1 -InstallOffsiteTask`（安装 `AntifieldCloud-Backup-Offsite`）。
- **只上传密文**：只选择 `.tar.gz.age`；明文归档拒绝上传并计入 `plaintextSkipped`；要求 `.sha256` 与 `.meta.json` 存在且
  本地密文 SHA 与 sidecar/pending 一致，否则跳过并记录 `failed`。
- **链感知保留**：先规划“最新 full + 其后全部 inc”，再叠加最近 N 天窗口；**绝不删除最新 full**；删除有上限（`--max-delete`）
  且默认 dry-run 可先演练；不做纯 `--min-age` 删除（可能删掉最新 full）。
- **上传与校验**：`rclone copyto --checksum` 上传归档 + `.sha256` + `.meta.json`，用 `rclone size` 校验远端大小；
  remote/remotePath/name 做白名单校验，`execFile` 无 shell；脚本不创建 rclone remote/凭据。
- **状态与告警**：状态 JSON 写 Pi `/var/lib/antifieldcloud/backup-offsite-status.json`（0644，随机 /tmp 名后 `sudo install`），
  字段 `lastRunAt/ok/remoteLabel/uploaded/skipped/failed/bytes/keptRemote/plaintextSkipped/error`；不含远端真实路径/URL/凭据。
  Dashboard `backup.offsite` 只读展示；`offsite_overdue` 告警阈值 `ALERT_OFFSITE_MAX_AGE_HOURS`（默认 48，0 关闭；
  状态文件缺失/未配置不进入条件列表，避免误报）。
- **回滚**：禁用/卸载异地任务即可；已上传副本保留，不影响应用归档主链路。

### 15.6 世界备份（Minecraft 世界一致性归档）

Minecraft 世界不在应用数据归档内，由 root 定时器独立备份；旧 `minecraft-backups` cron 已在验收后停用。

#### 15.6.1 Pi 端定时器与脚本

```bash
# 安装/更新 unit 与 timer（root）
sudo install -m 0644 deploy/antifieldcloud-world.service deploy/antifieldcloud-world.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now antifieldcloud-world.timer
systemctl list-timers antifieldcloud-world.timer
sudo systemctl start antifieldcloud-world.service    # 手动跑一次验证
cat /var/lib/antifieldcloud/world-backup-status.json
```

- `scripts/backup-world.mjs`（root）读取 `/etc/antifieldcloud/env`、`server.properties` 的 RCON/路径配置；
  预检世界目录、备份目录可写、磁盘余量（1.5× 世界体积）。
- 一致性流程：RCON `save-off` → `save-all flush`（180s 超时、失败重试一次）→ `tar -czf .part`（排除 `session.lock`）
  → gzip 完整性校验 → SHA-256 → 原子改名 `world-<UTC>.tar.gz`；**`save-on` 在 finally 中重试 3 次**，失败时状态 `ok=false`。
- 权限：归档与 `.sha256` 为 0640，属主 `antifieldcloud:antifield`（PC 用户 `antifield` 同组可 scp）；目录 0770（脚本显式 chown，不使用 setgid，避免 systemd `RestrictSUIDSGID` 拒绝）。
- 保留：Pi 侧最多保留最新 4 份（`WORLD_BACKUP_KEEP` 可调）；只删除匹配 `world-<YYYYMMDDTHHMMSSZ>.tar.gz` 的归档与旁文件，
  旧 legacy 命名文件不动；崩溃遗留超过 6 小时的 `.part` 会被清理。PC 拉取校验并 ack 后会删除远端归档，因此 Pi 的 4 份是
  “拉取前暂存”，不是长期异地副本；PC `world\` 才是长期保留（最新 4 份）。
- 状态：写 `/var/lib/antifieldcloud/world-backup-status.json`（0644，原子 rename），字段含
  `lastRunAt/ok/archiveName/sizeBytes/sha256/durationMs/kept/keptCount/error/message/errors/warnings/saveOffOk/saveOnOk/worldBytes`；
  `kept` 是归档名数组，份数看 `keptCount`，且是上次运行时的快照（PC ack 删除后不会实时回写）。
- 失败模式：Minecraft 未运行/RCON 不可达时备份失败并写状态；服务器 `save-off` 期间脚本崩溃时，`save-on` 会重试，
  仍失败则需手动在控制台执行 `save-on`（状态 JSON 会明确提示）。
- 旧世界 cron：验收后从 `antifield` 的 `crontab` 移除 `minecraft-backups` 行；旧归档约 9 GiB 不自动删除，
  按 §15.6.4 手动清理（清理前确认 PC 有副本）。

#### 15.6.2 Windows 周度世界拉取（用户手动安装任务）

```powershell
# 管理员 PowerShell；参数按实际直连地址/备份根目录填写（脚本在仓库 scripts/ 下，也可自行复制到固定路径）
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\world-pull.ps1 -PiHost 192.0.2.10 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups"

# 手动创建周任务（示例：每周日 12:00；路径按实际安装位置替换）
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\<user>\projects\AntifieldComplexx\scripts\world-pull.ps1" -PiHost 192.0.2.10 -BackupRoot "%USERPROFILE%\AntifieldCloudBackups"'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 12:00
Register-ScheduledTask -TaskName "AntifieldCloud-World-Pull" -Action $action -Trigger $trigger -Description "AntifieldComplexx 世界备份周度拉取"
```

- `install-backup-task.ps1` 安装每日应用归档任务，并可安装周度世界拉取任务；演练保持手动运行。

- 两阶段：查询远端 `world-backups` 与 `world-backup-status.json` → 逐个 scp 到 `.part` → 与远端 `.sha256` 比对
  → 原子改名 → 写本地 `.sha256` → 删除远端归档/旁文件（ack）；**校验失败不 ack、不动远端**，退出码 1。
  ack 删除远端是设计语义；Pi 因此只做暂存，长期副本在 PC `world\`。
- 本地保留最新 4 份（只删 `world-<UTC>.tar.gz` 匹配名及孤儿旁文件）；日志
  `%LOCALAPPDATA%\AntifieldCloud\world-pull.log`（>1 MiB 轮转）。
- 状态：写远端 `/var/lib/antifieldcloud/world-pull-status.json`（0644，`sudo install`），字段含
  `lastPullAt/ok/archiveName/archiveNames/pulledCount/sizeBytes/kept/keptCount/pendingRemaining/lastBackupAt/lastBackupOk/error/warnings`；
  `kept` 是本地归档名数组，份数看 `keptCount`。
- 所有 ssh/scp 有硬超时并杀进程树；UTF-8 输出编码统一；`-NoStatusWrite` 可跳过状态写入；失败也会尽量写 `ok=false`。

#### 15.6.3 磁盘与一致性注意

- Pi 世界约 4.1 GiB；`save-off` 窗口内 Minecraft 不落盘，gzip 打包在 Pi 上可能持续数分钟——定时器放在周日 12:00，
  不与玩家高峰重叠。脚本预检要求可用空间 ≥1.5× 世界体积；Pi 需要容纳拉取前的暂存归档，PC 拉取 ack 后会释放，
  仍需定期 `df -h` 确认。
- 世界归档是 tar.gz，恢复前必须停 Minecraft 或先 `save-off`，避免运行中的世界文件与归档混写。
- 世界备份不包含 Paper 配置/插件数据；这些仍由密钥包与应用数据归档覆盖。

#### 15.6.4 旧 cron 迁移与旧归档手动清理

```bash
# 1) 查看并移除旧世界备份 cron 行（保留其它行）
crontab -u antifield -l | grep -v 'minecraft-backups' | crontab -u antifield -
crontab -u antifield -l        # 确认已无 minecraft-backups 行

# 2) 确认 PC 上已有世界副本（world\ 下至少 1 份 world-*.tar.gz）后，清理旧归档
du -sh /home/antifield/minecraft-backups 2>/dev/null || true
sudo ls -lh /home/antifield/minecraft-backups | head
# 确认无误后按日期/大小逐个删除（示例；不要在生产高峰操作）
sudo rm -f /home/antifield/minecraft-backups/world-YYYYMMDD.tar.gz
# 或清理整个旧目录（确认 PC 已有副本且无其它依赖后）
sudo rm -rf /home/antifield/minecraft-backups
```

- 旧归档约 9 GiB，脚本与定时器都不会自动删除；删除前必须确认 PC 世界副本可解包（可用 `tar -tzf` 抽查）。
- 不要删除 `/var/lib/antifieldcloud/world-backups` 下新命名归档（由保留策略管理）；legacy 文件可手工清理。

### 15.7 恢复演练（自动化 + 记录）

演练校验 PC 上已拉取的真实归档，只读、不修改、不删除归档。每季度或升级前执行一次。备份根以本机计划任务为准，写在 `.local`，不写入公开文档。schema 期望值默认来自 `deploy/tool-versions.json`。最近一次应用与世界隔离演练是 `20261113T081625Z`。更早的演练记录见 CHANGELOG。

```powershell
cd "$env:USERPROFILE\projects\AntifieldComplexx"
.\scripts\drill.ps1 -BackupRoot <备份根>
.\scripts\drill.ps1 -BackupRoot <备份根> -IncludeWorld
.\scripts\drill.ps1 -BackupRoot <备份根> -PiHost 192.0.2.10
```

- 检查项：最新 full + 其后全部 inc、每份 `.sha256` 旁文件与 SHA-256、tar 条目安全（拒绝绝对路径/`..`/反斜杠/控制字符/
  符号链接/设备/白名单前缀）、解包后最新 `db-*.sqlite` 的 `PRAGMA integrity_check`/`foreign_key_check`/`meta.schema_version`、
  manifest `schema/mode/fileCount/totalBytes/since` 与实际内容一致；`-IncludeWorld` 额外校验世界归档 SHA/条目/`world/level.dat`。
- 输出：`%BackupRoot%\drills\<UTC>\report.json` 与 `report.md`；日志 `%LOCALAPPDATA%\AntifieldCloud\drill.log`；
  报告保留 180 天（`-KeepDays` 可调）；任何错误退出码 1。
- 可选写回 `/var/lib/antifieldcloud/drill-status.json`（0644），字段
  `lastRunAt/ok/report/fullArchive/incCount/latestDb/schemaVersion/worldArchive/worldChecked/error/warnings`；
  Dashboard 与 `drill_stale` 告警读取。未安装/未运行时状态为 unknown，不误报“已通过”。
- 演练报告写在备份根的 `drills\<UTC>\`，并回写 Pi 的 `drill-status.json`。未运行时状态为 unknown。证据留在报告和 `.local/DR-DRILL.md`。

### 15.8 恢复（实际命令）

> 恢复前先停止应用；恢复期间不要上传文件。先在临时目录解压、校验，再替换生产数据。
> 应用归档恢复需要约“选择字节 ×2 + 256 MiB”的额外空间（解包 + 落盘），并受 staging 2 GiB/20% 限制。

#### 15.8.1 应用数据（整库离线恢复）

先在 PC 生成并核对恢复目录，再由管理员做生产切换。世界归档不在这一步解包，见 §15.8.2。

1. **生成恢复目录**（PowerShell，目录必须尚不存在，父目录必须已存在）：

```powershell
.\scripts\drill.ps1 -BackupRoot "$env:USERPROFILE\AntifieldCloudBackups" -RestoreOutputDir "$env:USERPROFILE\AntifieldCloudBackups\restore-candidate" -ExpectedSchemaVersion 22
```

加密链另加 `-AgeIdentityPath`，解密只在这台持有离线私钥的 PC 上进行。报告 `errors` 为空且退出码为 0 后，该目录包含 `db.sqlite` 和目标库引用的 `files/<id 前两位>/<id>`。失败不创建目录，报告和原归档保留。目录已存在时报告 `restore_output_exists`，父目录不存在时报告 `restore_output_parent_missing`，两种情况都不改动已有内容。复制失败会删掉本次目标目录并记 `restore_output_failed`。

2. **核对恢复目录**：确认 `db.sqlite` 可打开，抽查 `files/` 中的目标文件，阅读同一次演练的 `report.json`。这一步通过后再停生产服务。

3. **生产切换**仍由管理员执行。停应用，把现有 `/var/lib/antifieldcloud` 改名保留，再把已核对的 `db.sqlite` 与 `files/` 放到新数据目录并修正属主后启动。下面的归档校验与 Pi 上叠加解包是同一切换的手工路径；使用恢复目录时，以目录里的 `db.sqlite` 与 `files/` 为复制源，不再在 Pi 上从 tar 里另选一份数据库。

4. **在 PC 上校验归档完整性**（PowerShell）：

```powershell
$root = "$env:USERPROFILE\AntifieldCloudBackups"
$latest = Get-ChildItem $root\weekly -Recurse -Filter *.tar.gz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$expected = (Get-Content "$($latest.FullName).sha256").Split(' ')[0]
if ((Get-FileHash -Algorithm SHA256 $latest.FullName).Hash.ToLower() -ne $expected) { throw "归档校验失败" }
```

5. **把“最近一次全量 + 其后的全部增量”上传到 Pi**（按文件名时间排序；若已采用恢复目录，改为上传该目录）：

```powershell
scp "$env:USERPROFILE\AntifieldCloudBackups\weekly\<日期>\<full>.tar.gz" antifield@192.0.2.10:/tmp/
scp "$env:USERPROFILE\AntifieldCloudBackups\daily\<日期>\<inc>.tar.gz" antifield@192.0.2.10:/tmp/
```

6. **Pi 上解包并选择最新 DB**（恢复目录路径改为复制 `db.sqlite` 与 `files/`）：

```bash
sudo systemctl stop antifieldcloud
RESTORE=/tmp/antifieldcloud-restore
rm -rf "$RESTORE" && mkdir -p "$RESTORE"
tar -xzf /tmp/<full>.tar.gz -C "$RESTORE"
for f in /tmp/<inc1>.tar.gz /tmp/<inc2>.tar.gz; do tar -xzf "$f" -C "$RESTORE"; done

# 关键：全量+增量叠加后会有多个 db-*.sqlite，必须按时间取最新一个
LATEST_DB=$(ls -1t "$RESTORE"/backups/db-*.sqlite | head -n 1)
test -n "$LATEST_DB" || { echo "找不到 DB 快照"; exit 1; }
echo "使用 DB 快照：$LATEST_DB"

# 替换数据（保留旧数据以便回退）
sudo mv /var/lib/antifieldcloud /var/lib/antifieldcloud.before-restore
sudo install -d -o antifieldcloud -g antifield -m 0750 /var/lib/antifieldcloud
sudo install -d -o antifieldcloud -g antifieldcloud -m 0700 /var/lib/antifieldcloud/files /var/lib/antifieldcloud/tmp
sudo install -d -o antifieldcloud -g antifield -m 2770 /var/lib/antifieldcloud/backups
# v0.7.3：上下文文档目录（派生数据，不进入备份；缺失时应用启用文档模式会启动失败）
sudo install -d -o antifieldcloud -g opencode -m 2750 /var/lib/antifieldcloud-context
sudo cp "$LATEST_DB" /var/lib/antifieldcloud/db.sqlite
if [ -d "$RESTORE/files" ]; then
  sudo cp -a "$RESTORE/files/." /var/lib/antifieldcloud/files/
fi
sudo chown -R antifieldcloud:antifieldcloud /var/lib/antifieldcloud
sudo chmod 0640 /var/lib/antifieldcloud/db.sqlite
sudo rm -f /var/lib/antifieldcloud/db.sqlite-wal /var/lib/antifieldcloud/db.sqlite-shm

# 启动并验证
sudo systemctl start antifieldcloud
curl -fsS http://127.0.0.1:3000/healthz
```

- `files/` 包含 `origin='note'` 的笔记附件物理内容；恢复整库时一并还原，DB 中的 `note_attachments` 决定其可见性。
  Web 文件级恢复只把 `origin='user'` 的文件恢复到新目录，不会把笔记附件放进云盘。
- 若归档 manifest 标记了 `skippedMissing`，对应文件内容不在归档中；恢复后这些文件仍缺失，下一次增量会尝试补入。

#### 15.8.2 世界数据（手动恢复）

```bash
# 1) 选择最新世界归档并校验（PC 或 Pi 上；PC 副本在 $BackupRoot\world\）
sha256sum -c world-<UTC>.tar.gz.sha256
# 2) 停服（或先 RCON save-off；推荐停服，避免运行中写世界）
sudo systemctl stop minecraft
# 3) 备份当前世界目录
sudo mv /home/antifield/minecraft-server/world /home/antifield/minecraft-server/world.before-restore
# 4) 解包（归档内为 world/ 目录）
sudo tar -xzf world-<UTC>.tar.gz -C /home/antifield/minecraft-server
sudo chown -R antifield:antifield /home/antifield/minecraft-server/world
# 5) 启动并确认玩家/区块正常；确认无误后再删除 world.before-restore
sudo systemctl start minecraft
```

- 世界归档一般含 `session.lock` 之外的完整世界；恢复后首次启动 Paper 会重建锁文件。
- 旧 legacy `world-<YYYYMMDD>.tar.gz` 归档结构相同，可按同样步骤恢复（先校验 SHA/可解包）。

#### 15.8.3 密钥包（需要离线 age 私钥）

```powershell
# PC 上
age -d -i age-secrets.txt -o secrets.tar "$env:USERPROFILE\AntifieldCloudBackups\secrets\<日期>\secrets-<UTC>.tar.age"
tar -xzf secrets.tar -C "$env:TEMP\antifieldcloud-secrets"
# 核对 .sha256 后，把 /etc/antifieldcloud/env、/etc/cloudflared/*、server.properties、opencode env 按原权限放回
```

- 解密在可信机器上做；恢复后检查 `/etc/antifieldcloud/env` 的域名/APP_ORIGIN/COOKIE_DOMAIN 与实际一致（COOKIE_DOMAIN 自 仅用于清理旧父域 Cookie，不再设置新 Cookie）。
- 密钥包不含普通文件内容；文件恢复走 §15.8.1，世界走 §15.8.2。

#### 15.8.4 验证清单

1. `/healthz` 返回 `{"ok":true,"version":"0.5.8","schemaVersion":13,...}`，服务 active；`/api/version` 登录后版本一致且 `botsEnabled` 与 env 一致。
2. 登录成功（TOTP 仍有效，因为 DB 快照含用户与 TOTP secret）；恢复码可用。
3. 文件列表数量、随机抽样文件的 SHA-256 与 API `GET /api/files/:id` 的 `sha256` 字段一致；笔记附件可见。
4. 图片/文本/PDF/预览正常，回收站内容与备份时一致；多文件分享/笔记版本可打开。
5. 白名单列表与备份时一致（RCON 可用时）；世界恢复后玩家可进入。
6. 备份 pending/状态正常（`backup.mjs --pending`、`backup-pull.json`、世界/拉取/演练状态文件）。
7. QQ 由 DSH 管理。确认 DSH 密钥包与冷备可解密，Workbench 不再提供 `/api/chatbots`。
8. 确认无误后再删除 `/var/lib/antifieldcloud.before-restore` 与 `world.before-restore`。

> 数据库迁移只向上、无 down 迁移：若回滚到旧 release，务必同时恢复升级前的 `--snapshot-db` 快照
> （部署脚本在切换前生成，路径 `/var/lib/antifieldcloud/backups/db-predeploy-*.sqlite`）。
> schema v13 高于旧程序支持版本时旧程序会拒绝启动，必须先还原快照。

### 15.9 Web 文件级恢复（不替换运行中的 DB）

Web 只做**文件级恢复**，不替换运行中的 DB 与 `files/`：

1. Settings → 备份与恢复 → 上传归档（≤100 MiB；需要 TOTP）或 scp 到 `DATA_DIR/backups/imports/` 后刷新；
2. 校验归档（流式 SHA-256 + tar 安全扫描）；
3. 恢复向导选择 full+inc 链和文件/目录 → TOTP + 输入 `RESTORE` → 计划 30 分钟有效；
4. 执行后只新建“恢复-<时间>”文件夹，使用新文件 ID，不覆盖原数据；失败会清理未完成内容；
5. `skippedMissing` 文件会从选择中剔除：计划返回 `skippedMissing` 列表；若所选全部缺失返回 400 `invalid_selection`；
   否则其余文件正常恢复，执行结果同样包含 `skippedMissing`（不整体失败）；
6. 整库恢复仍走 §15.8.1 的离线 root 流程，Web 不提供。

信任边界：归档含 TOTP/会话，导入需要管理员 TOTP；tar 仍按不可信输入处理，不提供归档下载；恢复计划单并发、30 分钟过期；
归档链只在同来源（Pi / Web 导入）内解析，避免跨来源拼出错误父子关系；归档浏览/导入/计划/执行均有独立限流。

### 15.10 故障排查

| 现象 | 处理 |
|---|---|
| `--pending` 报 `no such table: backup_archives` | Pi 未跑迁移：重启一次服务或先升级部署；确认代码/schema 为当前 v17 |
| pending 一直不减少 | PC 下载失败：看 `backup.log`；确认直连/SSH；保留 pending 是预期行为，不要手工删 DB 行 |
| `--ack` 报 SHA 不匹配 | 归档损坏/被替换；对比 PC `.sha256`，从 PC 副本重新确认或重新 `--prepare --full` |
| `磁盘空间不足` | 先完成 pending 拉取；清理旧 release/日志；空间预算含 pending+已确认+孤儿+2 GiB；世界备份另需 1.5× 世界体积 |
| `skippedMissing` 非空 | DB 有行但文件缺失（断电/误删）。备份继续、manifest 记录；恢复该文件后下一次增量自动补入；查 `warnings` |
| 密钥备份报 `age 未安装/缺少公钥` | 按 §15.5 安装 age 并写公钥；文件归档仍可成功，但 `secretsOk` 会为 false，属预期可见状态 |
| `opencode_snapshot_failed` / `opencode 快照目录不可写` | opencode 用户无法访问临时父目录或 DB：检查 `/run/antifieldcloud/secrets-tmp-opencode`（0711）与 `/var/lib/opencode` 权限；密钥包按失败处理（不会生成半成品），修复后重跑 |
| 备份面板超 48h 红色 | 检查计划任务 LastTaskResult、`backup.log`、Pi 直连与 pending 状态 |
| 世界备份状态 ok=false | 看 `/var/lib/antifieldcloud/world-backup-status.json` 的 `error/message`；常见为 RCON 不可达、磁盘不足、save-all 超时；修复后 `sudo systemctl start antifieldcloud-world.service` 重跑 |
| 世界备份超 8 天告警 | timer 未启用/未安装/上次失败；`systemctl list-timers`、`journalctl -u antifieldcloud-world`、smoke 世界状态检查 |
| 世界拉取状态超期/失败 | 检查 Windows 周任务、`world-pull.log`、直连与 Pi 上 `world-backups` 是否有归档；失败不会 ack，可重跑 |
| 世界归档 SHA 不一致 | 归档损坏/下载不完整；删除本地 `.part`/坏归档后重跑 `world-pull.ps1`；不要删除远端归档 |
| 恢复演练报告失败 | 看 `report.json` 的 `errors`：sidecar/链缺失、tar 不安全条目、DB integrity/FK/schema、manifest 不一致；先修备份再演练 |
| 演练状态 unknown | 从未运行或未指定 `-PiHost` 回写；运行 `drill.ps1 -PiHost ...` 或接受 unknown（不误报通过） |
| PC 有旧世界归档占空间 | 旧 cron 已停用；按 §15.6.4 手动清理，保留至少一份可解包副本 |
| 恢复后登录异常 | 确认恢复的是最新 DB、`/etc/antifieldcloud/env` 的域名与 APP_ORIGIN 一致；COOKIE_DOMAIN 自 仅用于清理旧父域 Cookie，必要时 `bootstrap-env.sh --force`（会沿用现有非敏感值） |
| 密钥包过大/失败但文件归档成功 | 看 `secretsLastError`；env 不可读会导致密钥包失败；修复 `/etc/antifieldcloud/env` 权限 0640 root:antifieldcloud |

### 15.11 覆盖、残余风险与限制

- **已覆盖**：应用数据归档（DB + 普通文件）、密钥包（env/cloudflared/Minecraft 配置；DSH 两项都配置时含 DSH 配置与 QQ 记忆，否则含 OpenCode 回滚档）、Minecraft 世界一致性归档（Pi 拉取前暂存最多 4 份、PC ack 删除远端；PC `world\` 长期保留 4 份）、自动化恢复演练；
  可选整包 age 加密与 PC 端异地副本（模板默认关闭；生产 v1.2.2 已开启整包加密与 Google Drive 异地副本）。
- **未覆盖**：Minecraft 插件/Paper 配置（由密钥包/应用归档部分覆盖）、对象存储；普通归档仍含 TOTP 与会话，
  PC ACL/离线介质是最后防线。age 私钥丢失导致加密归档不可恢复。DSH 冷备丢失导致 QQ 会话与凭据不可从 Workbench 恢复。
- **导入归档保留**：`BACKUP_IMPORT_RETENTION_DAYS`（默认 90，0=永久）控制 Web 导入归档保留；维护任务清理超期
  `origin='import'` 归档（跳过活动恢复计划引用），并清理无 DB 记录的超期导入文件。
- 浏览器导入上限 100 MiB；更大归档用 scp 到 inbox，备份归档导入独立于文件分片上传。
- 世界备份依赖 Minecraft 运行与 RCON；Windows 世界拉取周任务已安装并手动验证；恢复演练保持手动/季度。异地副本已启用，每日 13:00，只上传 `.age`。
- 恢复演练记录见 §15.7 与 `.local/DR-DRILL.md`；每次升级前重新演练。

#### 本轮明确不修 / 已知残留（DR 系列）

- **DR-1（时钟回拨/同毫秒）**：增量按最近有效全量链的文件清单选择，同毫秒写入会进入下一次增量。归档时间不早于最近一份本机归档。`--prepare` 仍用真实 UTC 对“文件 `created_at` 晚于当前时间/水位倒退”写 `warnings` 与 `clockSkew`，不拿抬高后的归档时间判断回拨。无法证明覆盖时改为新全量。
- **DR-7（导入归档无删除/保留策略）**：已由 `BACKUP_IMPORT_RETENTION_DAYS` 控制；活动恢复计划引用的归档不会删除。
- **DR-22（告警跨周期不重投）**：持续 firing 按 `ALERT_REPEAT_HOURS`（默认 24，0=关闭）重发 webhook，状态仍为 firing。
- **DR-23（锁心跳）**：`.backup.lock` 持有期间每 30s 刷新 mtime，超过 1 小时才按陈旧锁接管。
