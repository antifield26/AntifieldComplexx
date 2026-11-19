# 部署手册（Raspberry Pi 5 / Debian 13，v1.2.5）

操作按本文件执行。涉及系统状态时先核对任务授权、备份和回滚条件，在已有授权内逐项执行并记录结果。公开仓库里的域名、地址和网段都是占位值，安装前按 `.local/DEPLOYMENT.md` 替换。该文件不提交。

目标是 `/opt/antifieldcloud/current`，服务用户 `antifieldcloud`，监听 `127.0.0.1:3000`。

## 当前运行与回滚

当前 schema **v22**，应用 v1.2.5，mcbot 契约 v2。以下资源按 2026-11-19 生产检查记录，实际操作前重新验证。包 SHA 与待验项见 [ACCEPTANCE](ACCEPTANCE.md)。

| 组件/用途 | 当前资源 |
|---|---|
| Workbench | `/opt/antifieldcloud/releases/20261118T150139Z` |
| Workbench 同 schema 回滚目标 | v1.2.4，`/opt/antifieldcloud/releases/20261116T135139Z` |
| Workbench 跨 schema 回滚目标 | v1.2.3，`/opt/antifieldcloud/releases/20261114T082631Z`；要求 schema 21 快照 `db-predeploy-20261116T135240676Z.sqlite`（SHA-256 `ca3f4565626f288013db296dd88dfabc5a55a6355da904e2e1836b9f208bced2`） |
| mcbot | `/opt/mcbot/releases/20261118T150139Z`；同契约回滚指针 `/opt/mcbot/releases/20261116T135658Z` |
| DSH | 当前 `/opt/antifield-dsh/releases/20261119T020617Z`，基包 `/opt/antifield-dsh/releases/20261118T150321Z`。基包缺少 Minecraft Agent 所需模块。上一版回滚资源为 `/opt/antifield-dsh/releases/20261114T051442Z`，恢复前按本手册核对配置和三个服务。 |
| 生产回滚配置 | `/var/backups/antifieldcloud/update-125-20261118T150139Z`，包含旧指针、环境和 DSH 单元。固定维护入口另有安装备份 |

同 schema 回滚只恢复指针和配置，保留现行 DB/WAL。目标程序不支持现行 schema 时进入人工维护，先加密保全新写入，再使用匹配快照，不能只切 release。其他版本的变更记录仅见 CHANGELOG/ROADMAP，不能凭版本名称直接推断可恢复性。

## 现场核对与故障定位

| 配置/条件 | 当前要求 |
|---|---|
| 主机连接 | 实际地址与备份根只查 gitignored `.local/DEPLOYMENT.md`；直连 SSH 有重试，校园 WiFi 存在 AP 隔离 |
| 校园网 Portal | Pi 出口认证有效才可连接 Tunnel；7844 出站阻断、1033/530 时先核对出口认证，再在获准范围恢复 cloudflared |
| 运行时 | Node `/usr/local/bin/node` 26.13.0；npm 12.2.2、pnpm 10.34.9 在 `/usr/local/bin`；cloudflared 2026.10.7；执行前读实际版本 |
| Minecraft | Paper 26.1.2；RCON 25575 的凭据仅来自受限配置，不输出；接口暴露由防火墙限制，中文输出剥离 `§` 颜色码 |
| Minecraft 插件 | Chunky 1.5.66、CoreProtect CE 24.1、EssentialsX 2.22.0、LuckPerms 5.5.91、PlaceholderAPI 2.12.3、VaultUnlocked 2.20.3、ViaVersion 5.12.2、Vote2Sleep 1.3.0 |
| 健康与存储 | memory cgroup、60 秒健康探针、age/rclone 与 unattended-upgrades；核对状态文件的新鲜度和实际磁盘空间 |
| 调度 | 世界备份周日 12:00，PC 拉取周日 12:30，异地副本每日 13:00，演练手动/季度；系统维护 timer 保持其默认策略 |
| 管理边界 | Cloudflare/QQ 后台、交互初始化、私钥和 Windows 管理员任务按根 AGENTS；PiForge 残留不在本项目维护范围 |

当前世界约 4.1 GiB，世界备份按实际目录体积的 1.5× 预留。任何本机路径、版本或资源估算在执行前重新核对。配置清理用 `bootstrap-env.sh --force --prune-unknown`，先备份环境文件；应用不读取 `CHATBOT_*`、`DSH_QQ_MANAGED`、`OPENCODE_HTML_MODE`。

发布证据分别标识 Tag、应用基包 commit/包 SHA、DSH runtime 与现场覆盖文件。未登记的逐文件哈希列为待验，不认定为与 Tag 一致。

## 维护入口

日常拉取、世界状态、演练状态和 smoke 使用 `/usr/local/sbin/antifield-maint` 的固定动词。它不接受任意命令、环境覆盖或自定义 root 路径。状态文件来源必须是普通文件，并受 64 KiB 上限约束。

无限免密 sudo 已撤销。Pi 使用全局 sudo 票据。管理员先在交互终端执行 `sudo -v`，再在票据有效期内运行部署脚本。密码不写入脚本或环境文件。无人值守备份只走固定入口。

部署、安装依赖、切换 release 和改配置继续使用管理员密码。不要把 bash、node、npm、install、tee 或通配路径放进免密规则。由管理员运行 `scripts/install-maintenance.sh` 安装固定副本，脚本先保全现有入口和 sudoers。保存回滚目录标识并用 smoke 核对实际调用文件的 SHA。

QQ 监督器随独立 DSH release 切换，只替换包装器和监督模块，保留锁定依赖、账号、配置和会话数据。失败时恢复旧 runtime 指针并只重启 QQ。

## 客户端构建

三个公开 HTTPS 源来自未提交的 `.local/client-build.env` 或 CI：`VITE_API_ORIGIN`、`VITE_AI_ORIGIN`、`VITE_ACCESS_ORIGIN`。`npm run build:client:windows` 与 `build:client:android` 同时注入 Vite 和 Cargo，缺失或非法即失败。发行构建必须打开 `custom-protocol`。

Windows 构建 NSIS。Android 的正式路径使用仓库脚本、SDK 36 和既有兼容签名。本机若绕过该脚本直接组装 Android，必须传入同样的三个源，并关闭 Gradle configuration cache。私钥不进源码或发布附件。

## DeepSeek Harness

DSH Web 的 `web.env` 设置 `DSH_APP_ORIGIN=https://app.example.com`，用于设置分页中的主站固定入口。上线前确认目标等于 Workbench 的 `APP_ORIGIN`。独立 QQ 管理 socket 只有 QQ 服务及 Workbench 服务组可访问。

候选先验证分页、绑定与失败回滚，再在维护窗口加密保全 QQ 现状和旧服务文件。stage 从旧 root 配置一次性导入绑定到 QQ 服务账号目录，旧配置用于核验与回滚。装好新固定维护副本后再切 Workbench 和 DSH 指针。回滚前若已有换绑或解绑，先保全新状态，再按现行绑定恢复旧单元所需配置，解绑状态不得启动旧网关。

DSH 与 SDK 固定为 0.2.2-rc.3，QQ 插件固定为 0.5.5，依赖由 `deploy/dsh/package-lock.json` 和 integrity 校验。`sudo bash deploy/dsh/stage.sh` 安装三个隔离服务、账号、socket 目录及系统包管理入口；运行前核对当前任务授权。

- Web、QQ、mcbot Agent 分别使用独立账号、Home、工作目录和凭据；受限凭据通过 systemd LoadCredential 注入。
- Web 只监听 loopback，SSO 使用受限 Unix socket。QQ/Minecraft 的只显示插件不启动独立入站或动作工具，也不可禁用/卸载。QQ 每 AppID 单一入站。
- 插件查询使用 `/usr/local/bin/pnpm-dsh`；仅 `view` 去除 npm 不接受的 fetch-retries 参数，其他命令交给系统 pnpm。npm 不得链接到被 ProtectHome 拦截的主目录。
- Web 命令受 Bubblewrap 和工作目录限制。模型侧插件管理关闭；Minecraft Agent 不启用 shell、文件系统或清单插件。
- 安装、启动、Cordis/Agent/Session/工具注册与 ARM64 权限在候选中验证，失败不生产切换。程序更新使用新 release 和原子 current，现场覆盖须有逐项哈希与回滚副本。
- 回滚前保全 DSH 新会话和 QQ 结构化记忆的加密冷备。OpenCode 仅作离线回滚，见 §3.2。

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
- 当前 schema **v22**：设备认证、文件/知识库/分享、备份和告警数据由 Workbench 保存；外部告警投递仅 webhook，QQ 业务由 DSH 保存。跨 schema 恢复源见文首。
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
25565 仅同网段；25575 仅 loopback；DHCP 仅 `eth0`/`wlan0`；80 不放行。

## 2. 非敏感部署值与环境文件

非敏感源、端口、目录等写入受限主机的 `/etc/antifieldcloud/deploy.conf`；实际域名和路径按 `.local/DEPLOYMENT.md`。秘密来自独立服务的受限文件，不在命令输出或公开文档中填写值。

- 用 `scripts/bootstrap-env.sh` 生成/更新应用 env；更新前保存副本，`--force` 按纳管键重建，`--force --prune-unknown` 还会清理未知键。文件保持 root:antifieldcloud 0640，写入采用同目录临时文件和原子替换。
- `APP_ORIGIN` 与 `AI_ORIGIN` 必须不同且是有效 Origin。DSH_WEB_URL 与 DSH_WEB_SSO_SOCKET 同时配置或同时留空，在线 DSH 使用固定 loopback 根 URL 和私有 socket。
- `PUBLIC_APP_SHELL=true` 默认提供公网完整界面；false 时公网管理页为客户端说明，分享页仍可用；loopback 提供完整界面。页面 Access 与 API 应用认证独立。
- 应用不读取 CHATBOT_*、DSH_QQ_MANAGED、OPENCODE_HTML_MODE。OpenCode 密码兼容读取只适用于 DSH 两项均留空的回滚配置；在线 DSH 不依赖该运行时安装。
- mcbot 默认关闭。启用时配置 loopback 根 MCBOT_URL 与读 Token，控制 Token 为空则只读；由 root 的 `scripts/sync-mcbot-tokens.sh` 从 `/etc/mcbot/env` 同步，`--check` 只比较，不读取/回显 RCON 或模型凭据。
- 备份整包加密、独立公钥路径、异地状态、告警阈值与 webhook 按模板/解析器配置；生产开关和任务状态见 ACCEPTANCE。密钥只通过受限文件注入。

完整键名、默认值和范围以 `deploy/env.example`、`apps/mcbot/deploy/env.example`、配置解析器和 API 为准；不在本手册复制一份所有默认值。修改后先校验配置/权限，再在授权范围重启对应服务并验证健康状态。

## 3. 从 PC 部署（带一致性快照与回滚）

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
- release 保留 3 个，且清理时永不删除 `current` 与切换前的 `previous`。
- 手工等价步骤（仅在脚本不可用时）：解包 → `npm ci --omit=dev --ignore-scripts` → 先跑
  `node scripts/backup.mjs --snapshot-db` → 写入/校验 `APP_VERSION` → `ln -sfn` → `systemctl restart antifieldcloud` → `curl /healthz`。

### 3.0 当前部署步骤

1. PC 执行 `npm run check`、`npm run build`、`node scripts/check-version.mjs` 与 `node scripts/check-prod-deps.mjs`；期望版本从 tool-versions 读取，当前应用/mcbot 1.2.5、schema 22、契约 2、DSH 0.2.2-rc.3、QQ 插件 0.5.5。
2. 核对 pending、磁盘、配置与运行指针，保存当前 schema 22 的一致性快照。用于 v1.2.3 回退的 schema 21 快照另行保留，不能用当前快照覆盖。
3. 执行 `.\scripts\deploy.ps1 -PiHost <直连IP>`；核对包清单/SHA、目标依赖、快照、版本/schema/运行时就绪。跨 schema 失败转人工维护，同 schema 回滚保留现行库。
4. Bot 空闲后切换 mcbot，核对 healthz 与契约 v2；Minecraft 保持运行。DSH 各服务分别验收。
5. 完整 smoke 使用 `-ExpectedVersion 1.2.5 -ExpectedSchemaVersion 22 -ExpectedMcbotVersion 1.2.5 -RequireMcbotState -ExpectedMcbotContractVersion 2 -ExpectedDshVersion 0.2.2-rc.3 -ExpectedDshQqVersion 0.5.5 -RequireOpenCodeStopped`，Access 参数来自受限文件；未启用 mcbot 时用 `-SkipMcbot`。
6. 更新 Windows 固定任务副本，实际拉取并隔离恢复。恢复状态回写后用 `-RequireRecoveryDrill -ExpectedSchemaVersion 22` 完成最终 smoke，验证当前 schema 和世界解包证据。记录失败和待验项。

## 3.2 OpenCode 离线回滚运行时

离线回滚运行时：OpenCode v2.2.5。生产不运行 OpenCode，端口 4096 应关闭；DSH 自主会话与管理员对话不回退到该运行时。

恢复仅在明确获准的回滚任务中执行：

1. 先加密保全现行 DSH 配置、凭据、QQ 记忆和会话；保全应用及 mcbot 的现行写入。
2. 从 PC 的受限离线保留位置选已验证的运行时档，核对清单、SHA、解密结果与包内版本。档案定位见本机部署记录，不能只按文件日期选择。
3. 在隔离目录验证二进制、unit、配置和一致性会话数据库；确认与目标应用 release、schema、代理和 QQ 单入站策略匹配。
4. 按对应回滚方案恢复必要组件，保持权限与 loopback 约束，不重启 Minecraft；应用数据库按 §11 处理。
5. 若回滚方案启用 OpenCode，检查实际运行进程的 `/api/info`、可执行文件、认证、会话及工具权限；停止 DSH 对应入站，防止双重处理。未通过不宣称恢复成功。

运行时档的版本沿革及升级实验记录仅见 CHANGELOG/ROADMAP。

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

备份并编辑 Pi 上的 `/etc/cloudflared/config.yml`，保留原有 `tunnel`/`credentials-file`/`protocol`，仅按仓库 `deploy/cloudflared-ingress.yml` 核对 app/ai 的入口，保留其他现有服务（示例）：

```yaml
ingress:
  - hostname: app.example.com
    service: http://127.0.0.1:3000
  - hostname: ai.example.com
    service: http://127.0.0.1:3000
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

目标：只为 `ai` 主机关闭 Cloudflare 对模块脚本的改写和自动注入，不影响 `app`。Workbench 原样转发 HTML，不注入垫片。

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

Access 页面应用保护 `app.<domain>` 的页面，独立应用保护 `ai.<domain>`。原生客户端要求 `/api` 到达 Workbench；匿名 API 仍返回应用 401，不能因为边缘放行而省略应用认证。健康检查 `/healthz`、分享 `/s/*` 与 `/api/public/shares/*` 需要到达应用。

Cloudflare 后台操作由用户完成，Agent 可准备路径和校验步骤。Workbench 不提供 QQ 回调，不需要为 QQ 添加应用入口。不要扩大到整个 AI 主机的 bypass，也不要改变 Minecraft CNAME。

Smoke 使用受限 `.local/cf-access.env` 中的服务令牌，凭据不进入命令日志、安装包或仓库。Owner allow 与 Smoke service token 按主机分别配置；轮换后更新本机文件并重跑探测。Free 套餐的能力以当前配置为准，应用侧限流与鉴权始终保留。

验收覆盖：未认证页面由 Access 拦截，未认证 API 返回应用 401，合法 Tauri Origin 预检可达，分享返回应用状态码，AI HTTP/WS 校验会话和 Origin。检查结果写 ACCEPTANCE，不把配置存在当成访问通过。

## 6. 验证

部署内只读 smoke 与完整 PC/公网/备份验收分别执行，检查结果写 ACCEPTANCE；FAIL/WARN/SKIP 不能记成 PASS。完整示例：

```powershell
.\scripts\smoke.ps1 -PiHost 192.0.2.10 -PiUser antifield -BackupRoot '<本机备份根>' `
  -ExpectedVersion 1.2.5 -ExpectedSchemaVersion 22 `
  -ExpectedMcbotVersion 1.2.5 -ExpectedMcbotContractVersion 2 -RequireMcbotState `
  -ExpectedDshVersion 0.2.2-rc.3 -ExpectedDshQqVersion 0.5.5 -RequireOpenCodeStopped
```

Access 参数来自受限本机配置，不能把服务令牌写入脚本、日志或安装包。未启用组件按脚本支持的 Skip 参数标注，不能跳过后宣称该组件通过。

核对应用版本/schema、DSH 三路就绪和插件页边界、mcbot v2、停止/急停、主机加固、应用鉴权、公开分享、告警受控投递、实际备份拉取和隔离恢复。Web 人工验证包括 Workbench 登录、AI 单点换票/续聊/停止/登出和非法 Origin；客户端覆盖 Windows/Android 登录恢复、文件传输、预览、AI 返回与外观。

Bot 动作在获准受控区域验证，模型和平台负路径在隔离候选中验证；测试不重启 Minecraft。Windows 任务安装与固定副本更新见 §15.4。

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
**25565 仅同网段**（IPv6 仅 `fe80::/10`）；**25575 显式 drop**；80 不放行；出站不限制。

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
- 归档保留最新 4 份；不匹配当前命名的文件不自动删除；状态文件 0644，`error/message` 为 ASCII 错误码 + 英文说明，
  便于 PowerShell/前端解析。
- 回滚/停用：`sudo systemctl disable --now antifieldcloud-world.timer`；需要时删除 `/etc/systemd/system/antifieldcloud-world.{service,timer}` 后
  `daemon-reload`。不要删除既有归档；确需清理按「15.6.4 调度与保留核对」。
- 同一世界只配置一条授权调度链，不并行配置 cron 与 timer 重复打包；保留与清理见 §14。
- 定时策略：仅项目世界备份 timer 统一到周日 12:00；`antifieldcloud-health.timer` 保持每 60s；
  apt-daily/logrotate/fstrim 等系统维护 timer 保持发行版默认，不纳入统一调整。

### 9.4 世界拉取（Windows 周任务）

PC 以最近已到期的周日 12:00（Asia/Shanghai）为目标周期，每分钟检查且最多等待 30 分钟。已生成且通过目标归档 SHA-256 后才记成功，等待失败保留最近一次成功时间。Windows 任务需由管理员重新安装。

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
- `install-backup-task.ps1` 安装每日应用归档任务时，同时安装世界拉取：把 `scripts\world-pull.ps1` 复制到 `%LOCALAPPDATA%\AntifieldCloud\world-pull.ps1`，注册 `AntifieldCloud-World-Pull`（周日 12:30，时限 3 小时）。`-PiHost`/`-PiUser`/`-BackupRoot` 与每日任务相同。本机备份根见 `.local`，世界归档在该根下的 `world\`。缺源文件时安装脚本在复制和注册之前失败，DryRun 也不写任务。恢复演练仍按 §9.5 手动/季度执行。重装需要管理员 PowerShell。

### 9.5 恢复演练（drill.ps1，季度/部署验收）

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

### 9.6 主机加固状态

SSH 仅公钥，fail2ban 的 sshd jail 使用 nftables 后端与持久化 dbfile；journald 为持久化模式，并限制日志空间。Pi 的 log2ram 由其服务负责同步；应用不写任意主机路径。

cloudflared 使用专用 unit/drop-in 和最小权限，凭据只在受限配置；Node/npm/pnpm 的系统可执行路径须满足服务 ProtectHome。实际版本见现场核对表，执行前从运行进程与文件重新确认。

### 9.7 SSH 仅公钥与封禁恢复

当前 SSH 仅公钥，00- drop-in 优先于其他配置；PasswordAuthentication/KbdInteractiveAuthentication 为 no，PubkeyAuthentication 为 yes。变更只在明确授权和备份后执行，先保留已建立 SSH 会话/物理回滚通道，再校验 sshd -t、新会话公钥登录和有效配置，不能在唯一连接上试错。

配置备份保存在 `/var/backups/antifieldcloud` 的 root 0600 文件中，至少保留一个可恢复副本到下次演练。回滚使用实际备份，不猜测文件名或默认恢复密码登录。

fail2ban 的 sshd jail 使用 nftables 后端、24h ban 和持久化 `/var/lib/fail2ban/fail2ban.sqlite3`。nftables start/restart 后的 drop-in 异步恢复 fail2ban set，不能同步等待形成 ordering 死锁；手工 reload 不执行 ExecStartPost，须按流程 restart fail2ban 并核对封禁集合。模板在 `deploy/systemd/nftables.service.d/10-fail2ban-restore.conf`。

只读验证使用 sshd -T、systemctl status、fail2ban-client status/get、nft list；配置语法先 fail2ban-client -t。生产不制造封禁故障，日志和持久化恢复用候选环境验证，现行验证缺口写 ACCEPTANCE。

### 9.8 QQ

生产 QQ 由 DSH 管理。Workbench 不提供 Webhook、发布、OpenCode Chat 或机器人管理页。这些路径不存在。凭据、白名单和会话记忆由 DSH 自己保管。告警只走 webhook。

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

同 schema 回滚只恢复 release 指针和配置，保留现行数据库及 WAL；停止应用、切指针后只重启应用并检查版本/schema/运行时就绪。不得用预部署快照覆盖健康且有新写入的现行库。

跨 schema 回退必须人工维护：先停止相关写入、加密保全现行 DB/WAL 和配置，校验恢复源的 SHA、SQLite integrity/foreign keys 和 schema，再恢复与目标 release 匹配的快照。当前 v1.2.3 目标只支持 schema 21，资源见文首；不能只换指针。新写入优先前向修复，回退时明确保全与重放方案。

mcbot 同契约独立回滚其指针，先等待空闲并保全状态。DSH 回滚先保全新会话和 QQ 记忆，分别验证三个服务，保持 QQ 单一入站。数据库损坏时的整库恢复见 §15.8。

## 12. CI 检查

`.github/workflows/ci.yml` 在 push/PR 运行（`concurrency` 取消旧任务、各 job 有超时）：
Node 26 `npm run check` + `npm run build`；服务端覆盖率（`npm run test:coverage`）与前端覆盖率（`npm run test:web:coverage`）；
生产依赖边界（`npm ci --omit=dev` + `scripts/check-prod-deps.mjs`）；`npm audit --omit=dev --audit-level=high`；
gitleaks secret-scan；`shellcheck`（scripts/*.sh、deploy/*.sh）；`nft -c -f deploy/nftables.conf`；
Windows PowerShell job 覆盖**全部** `scripts/*.ps1` 的 PS 5.1 解析 + UTF-8 BOM 检查；Dependabot 月度更新 npm 与 GitHub Actions 依赖。
部署/备份脚本改动必须让 CI 全绿。

版本一致性：`node scripts/check-version.mjs` 比对 `package.json` 与 README/CHANGELOG/ACCEPTANCE、`deploy/env.example` 的
`APP_VERSION`、`docs/DEPLOY.md` 标题与 `package-lock.json` 根版本；并交叉校验 `deploy/tool-versions.json` ↔ `server/src/db.ts`
`SUPPORTED_SCHEMA_VERSION`、`docs/DEPLOY.md §3.2 离线回滚运行时`、`docs/DEPLOY.md 当前 schema`、README/SECURITY/ACCEPTANCE 的
OpenCode 离线回滚版本（已接入 CI check job）。发布前必须通过；过渡期调试可用 `CHECK_VERSION_ALLOW_STALE_TOOLS=1`，CI/发布不得使用。

工程指令门禁：`npm run check:agents` 随 `npm run check` 在 CI 执行，检查 AGENTS 的字节与祖先链预算、根导航、相对 Markdown 链接、字面 npm script 名称和 Node 脚本入口。它不运行文档命令、不检查全部文档语义或生产状态；详细边界见 [INDEX](INDEX.md)。AGENTS 只引用版本来源，不手抄发布版本。

其它门禁：`check-prod-deps.mjs`（裸导入边界）、PS 5.1 解析 + UTF-8 BOM（全部 `scripts/*.ps1`，含 `backup-offsite.ps1`）、
`run-tests.mjs` 覆盖率阈值（Lines 91 / Functions 85 / Branches 76）、gitleaks/shellcheck/nftables 语法。公开文档占位符扫描由 PR 审阅把关（不把真实值写入 CI 配置）。

## 13. 常见问题

| 现象 | 处理 |
|---|---|
| `deploy.ps1` SSH 超时 | 直连网线偶发丢包；脚本自带重试；检查 PC 网卡节能、网线、Pi `eth0` |
| `npm ci` 失败 | 确认 Pi 可访问 npm registry；使用 `/usr/local/bin/npm`；查看 `journalctl -u antifieldcloud` |
| 部署健康检查失败 | 脚本已自动回滚；看输出的 journalctl 与迁移前 DB 快照路径；修复后重新部署 |
| 公网 502 | `systemctl status cloudflared`；确认 app 在 3000 监听；DNS 是否 Proxied |
| Pi 重启后 Tunnel 1033/公网 530，7844 出站失败 | 按「现场核对与故障定位」先核对校园网 Portal 认证与 Pi 出口，再在获准范围恢复 cloudflared |
| 上传 >100MB 返回 413 | Cloudflare 套餐请求体上限；调小 `MAX_UPLOAD_BYTES` 或升级套餐，前端会提示大小限制 |
| 登录 429 | 15 分钟内失败次数过多；等待或重启应用清空内存限流 |
| 白名单 502 | RCON 不可用：`ss -tlnp | grep 25575`，`sudo journalctl -u minecraft` |
| AI 换票失败 | 核对应用会话、Host/Origin、DSH Web/socket 就绪与 User-Agent，不输出 Cookie/启动令牌 |
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
| cron 与 timer 重复备份 | 只读盘点相关调度，按授权保留单一链；归档处理按 §14/§15.6.4 |
| 部署脚本报“工作树不干净” | 先提交；确需脏发布用 `-AllowDirty` 并在验收记录标注 commit/改动 |
| 部署后 smoke 失败但服务正常 | 默认门禁失败；看 FAIL 项修复后重跑 `smoke.ps1`；临时放行用 `-AllowSmokeFailure` 并记录未通过项 |
| `/healthz` 版本与期望不符 | 检查 `/etc/antifieldcloud/env` 的 `APP_VERSION` 与 `package.json`；回滚后尤其要确认已还原上一 release 版本 |
| Workbench QQ 路径 | Workbench 不提供 QQ Webhook、机器人页或 OpenCode Chat。这些路径不存在。生产 QQ 由 DSH 管理 |
| smoke Access token 无效 | 同时提供 `-AccessClientId/-AccessClientSecret`、确认 token 未过期且策略绑定 `app`；不要使用全局/宽范围 token |
| nftables restart 后封禁丢失 | drop-in 未安装/未 `daemon-reload`/dbfile 不可写；手工 reload 不触发，需 `systemctl restart fail2ban`（§9.7） |
| SSH 仅公钥后无法登录 | 24h 回滚窗口内删除 `/etc/ssh/sshd_config.d/00-antifield-hardening.conf` → `sshd -t` → `systemctl reload ssh`；用已建立会话/物理键鼠操作（§9.7） |
| fail2ban 未封禁/启动失败 | `fail2ban-client -t` 校验配置；`journalctl -u fail2ban -n 50`；确认 nftables 后端与 `sshd` jail 已启用、`bantime=86400`；日志后端（log2ram/journald）可读 |
| nftables 重载后封禁列表清空 | fail2ban 的封禁 set 随 nftables 重建丢失：`systemctl restart fail2ban` 后 `fail2ban-client status sshd` 复核；把该步骤写进 nftables 变更清单 |

## 14. 磁盘清理与保留策略

### 14.1 只读盘点

先用 df/du、release 指针、备份清单和服务配置列出实际占用，不根据示例路径直接删除。公开报告只记计数/大小/别名，实际路径留受限记录。

### 14.2 可清理范围

只按对应脚本保留策略处理：不被 current/previous 保护的 release、完成拉取确认且满足保留条件的应用归档、符合世界归档命名的超额副本，以及过期且无活动引用的临时文件。SQLite 快照须先核对回滚目标；已初始化的 mcbot 状态、DSH 数据和活动 WAL 不属于通用清理对象。

### 14.3 保护对象

未 ack 的 pending、最新 full 与恢复所需 inc、独立密钥包、离线回滚档、current/previous、受限配置和不匹配已知归档命名的文件均保留。密文孤儿只报告，需管理员核对来源。

### 14.4 执行与验证

依据任务授权逐项核对绝对目标、属主、文件类型和恢复源，先 dry-run/清单预览。只使用该类别的固定清理入口，不把跨 shell 拼接或通配递归删除作为通用方案；完成后重新核对空间、指针和备份链。

## 15. 备份与恢复

应用数据、独立密钥包、Minecraft 世界和 PC 异地副本是四条独立链路。生产启用整包 age 与 Google Drive 异地，模板默认关闭；Pi 不持私钥，Web 不解密。当前验收缺口见 ACCEPTANCE。

### 15.1 策略

| 链路 | 频率/触发 | 保留与确认 |
|---|---|---|
| 应用归档 | Windows 每日拉取任务或手动 prepare | pending 至 ack；Pi 已确认 2 份，PC daily 30 天/weekly 56 天；推荐全量周期 7 天 |
| age 密钥包 | 随每日拉取 | Pi KEEP=2，PC 90 天；校验 SHA、agentRuntime/includesDsh 和适用的 mcbot 收录状态 |
| Google Drive 应用密文 | 每日 13:00 | 最新 full、其后 inc 与最近 N 天；成功确认远端三件套后才执行保留清理 |
| Minecraft 世界 | 周日 12:00，Asia/Shanghai，Persistent | Pi/PC 各按最新 4 份策略；PC 校验 SHA 后 ack |
| 隔离恢复演练 | 手动/季度及部署验收 | 报告默认 180 天；应用、引用文件、世界及关键状态分别验证 |

prepare 生成 pending；PC 下载校验后 ack 才推进游标。无确认不删 pending，失败重试相同归档。增量覆盖依据同一 DB 快照和 manifest.files，包含回收站与附件；补回的缺失内容重新纳入覆盖，不能只按 created_at 过滤。无法证明完整链时生成新全量，损坏 pending 先保全并诊断。

应用磁盘预算包含 pending、未清理已确认文件、孤儿与 2 GiB 余量；加密时按 2× 明文估算。世界归档按实际世界体积 1.5× 预检。不匹配命名的文件和无 DB 记录的密文孤儿不自动删除。

### 15.2 应用归档结构与协议

```text
snapshot-<UTC>-full.tar.gz.age
snapshot-<UTC>-full.tar.gz.age.sha256
snapshot-<UTC>-full.tar.gz.age.meta.json
```

密文内 tar 包含 `backups/db-<UTC>.sqlite`、`backups/manifest-<UTC>.json` 和 `files/<xx>/<id>`。每次归档都带一致性数据库快照，full/inc 决定物理内容集合。

- manifest：schema、createdAt、mode、since、database、files、fileCount、totalBytes、skippedMissing、warnings；加密格式另含 encrypted/archiveFormat。
- 外部 sidecar schema 2：name/mode/createdAt/archiveFormat/encrypted/encryptedWith/recipient/plainSha256/plainSize/cipherSha256/cipherSize。明文哈希和大小不得放在归档内部形成自引用；`.sha256` 表示密文。
- DB backup_archives 保存归档状态、来源、manifest、校验与错误；origin=pi 参与 prepare/ack，origin=import 不参与游标。已 ack 且服务端副本清理时为 acked/available=false，不等于 missing。
- 加密顺序：`.plain.tmp` → plain SHA/size → age `.part.age` → 原子 `.age` → 原子 sidecar → 删除临时明文 → DB 登记。加密失败不产生 pending、不降级明文；超过 24h 的临时明文由维护清理。
- 无哈希记录仍支持按大小核对；skippedMissing 是归档观测，不豁免恢复时目标 DB 引用文件的完整性要求。

### 15.3 Pi 端命令

在部署目录以 antifieldcloud 账号执行，配置由受限 env 提供：

```bash
node scripts/backup.mjs --pending
node scripts/backup.mjs --prepare
node scripts/backup.mjs --prepare --full
node scripts/backup.mjs --snapshot-db
```

ack 必须使用实际下载后核对的 name、SHA 和 size，按 CLI 用法传入；不能为了消除 pending 手工伪造确认。Web prepare 超时由 BACKUP_PREPARE_TIMEOUT_SEC 控制，与 PC 硬超时配合。

### 15.4 Windows 每日应用归档任务

用户使用管理员 PowerShell 按受限本机地址/备份根运行：

```powershell
.\scripts\install-backup-task.ps1 -PiHost <直连IP> -PiUser antifield -BackupRoot '<本机备份根>'
```

安装器把脚本复制到 `%LOCALAPPDATA%\AntifieldCloud`，登记任务名 `AntifieldCloud-Backup-Pull` 与 `AntifieldCloud-World-Pull`，保存脚本 SHA/安装标记并收紧 ACL。仓库备份脚本变化后需要重装固定副本。当前标记见 ACCEPTANCE。

应用拉取顺序是查询 pending、按推荐模式 prepare、下载 part、核对密文/sidecar、原子改名、ack；失败不 ack。加密包缺/非法 sidecar 时按项保全并报告，不能删远端。日志与状态在固定本机目录，凭据不写状态。

### 15.5 密钥包与加密

密钥包由 root 的 `backup-secrets.sh` 生成并 age 加密。应用/CLI 只读取公钥；备份整包与 secrets-age 使用独立密钥对，私钥离线至少两份，不放 Pi。启用前由用户在离线环境验证解密能力。

| 内容 | 收录与验证要求 |
|---|---|
| 应用/主机配置 | 受限 env、Cloudflare、Minecraft 和可选主机模板的实际配置；恢复按原属主/权限 |
| DSH | 配置、凭据、Web Cookie 签名凭据、QQ 结构化记忆一致性快照；PC 校验 agentRuntime=dsh/includesDsh=true |
| mcbot | mcbot-state 中目标库一致性快照、任务状态和按维度世界记忆；清单区分 included/not_created/read_failed，逐项 SHA/size |
| DSH 会话冷备 | 部署/回滚窗口使用 dsh-cold-backup.sh 单独保存 Web/QQ 会话历史；不以日常密钥包替代 |

服务启用但已初始化目标库缺失、状态读取失败或哈希错误时密钥包失败。目标快照使用 DELETE journal，不能丢弃源库非空 WAL；恢复时在途目标保持暂停、完成步骤保留。隔离副本验证：

```bash
node scripts/backup-mcbot-state.mjs verify <隔离目录>/mcbot-state
node scripts/backup-mcbot-state.mjs restore <隔离目录>/mcbot-state
```

DSH Web URL 与 SSO socket 必须同时配置或同时留空。都空的离线回滚配置按其运行时要求验证 includesOpencode；不能只填其中一个来绕过密钥包校验。

#### 15.5.1 备份整包加密

设置 `BACKUP_ARCHIVE_ENCRYPTION=true` 与固定公钥文件。公钥单行 age1 格式，root 属主且组/其他不可写；密钥包与备份整包公钥不混用。age 不可用、公钥非法、空间不足或加密失败均关闭 prepare，不回退明文。

验证包含 prepare、PC 拉取、密文及 sidecar 哈希、离线解密和完整链演练。关闭开关不会解密现有 `.age`；开关变更必须在授权范围内，不以关闭加密掩盖失败。

#### 15.5.2 PC 异地副本

Google Drive 使用独立 OAuth、drive.file 与专用目录，rclone 配置只在受限 PC 目录。remote 只接受配置别名，拒绝盘符/本地路径/嵌套子路径；子目录使用 RemotePath，二进制/配置可显式指定。

```powershell
.\scripts\install-backup-task.ps1 -PiHost <直连IP> -BackupRoot '<备份根>' -InstallOffsiteTask -OffsiteRemote <remote别名>
```

任务 `AntifieldCloud-Backup-Offsite` 默认每日 13:00、6h 超时、IgnoreNew。只上传 age 应用归档及 SHA/元数据旁文件；世界归档和独立密钥包不在该云端链。任一上传/确认失败则不执行该轮远端清理，最新 full 及其增量受保护。状态只写别名/计数/时间/脱敏错误，不写 remote 路径、目录 ID 或凭据。隐私说明见 [BACKUP-OAUTH-PRIVACY](BACKUP-OAUTH-PRIVACY.md)。

### 15.6 Minecraft 世界备份

#### 15.6.1 Pi 定时器

antifieldcloud-world.timer 在周日 12:00 Asia/Shanghai 执行，Persistent=true；root 服务持锁、限时，仅固定 `save-off`、`save-all flush`、`save-on`。save-on 在 finally 重试，失败报告明确错误。归档检查 gzip/SHA 和固定命名，保留 4 份，状态为应用只读 JSON。

#### 15.6.2 Windows 世界拉取

World-Pull 与应用拉取由同一安装器登记，File 指向固定副本；BackupRoot 相同，世界副本在 world 子目录。下载到 part，核对远端 SHA，再原子改名和 ack；任何失败都保留远端。PC 保留最新 4 份，所有 ssh/scp 有硬超时。

#### 15.6.3 一致性与空间

备份不重启 Minecraft，依赖服务运行与 RCON 可达；存盘关闭期间必须可靠收口。磁盘预检按实际世界体积，演练解包还须额外临时空间。运行中的生产世界不得作为演练目标。

#### 15.6.4 调度与保留核对

同一世界只使用一条授权的调度链；安装前盘点 cron/timer，防止重复备份，不擅自清理其他项目任务。不匹配 world-UTC 命名的文件不由保留脚本自动删除，须人工核对来源与恢复需要。

### 15.7 隔离恢复演练

只读使用 PC 上的归档链；不修改/删除原归档。私钥由用户离线保管，只传路径。演练将 age 的二进制输出直接写入演练临时目录，校验明文哈希和大小，结束时清理临时明文。解密失败报告记录归档名、错误码和退出码。命令示例：

```powershell
.\scripts\drill.ps1 -BackupRoot '<备份根>' -AgeIdentityPath '<离线私钥文件>' -IncludeWorld -RequireWorld -SkipRemoteStatus
```

schema 期望默认从 tool-versions 读取，隔离目录按链最终 manifest 选择 DB；完整性/外键/schema、全部 kind=file 引用、大小与可用 SHA 必须通过。增量 since 不得晚于已验证水位；重叠允许，水位需继续前进。后续增量补回的内容可用，目标 DB 仍引用的缺失内容必须失败。

世界须实际隔离解包并验证 level.dat；只列 tar 或扫描不能替代该项。报告 JSON/Markdown 使用稳定错误码和文件计数，可指定 ReportRoot；获准时用固定维护入口回写状态。当前通过/待验范围见 ACCEPTANCE。

### 15.8 实际恢复

#### 15.8.1 应用整库离线恢复

先在 PC 构建新的验证输出，目标父目录必须存在，目标目录必须尚不存在：

```powershell
.\scripts\drill.ps1 -BackupRoot '<备份根>' -AgeIdentityPath '<离线私钥文件>' -ExpectedSchemaVersion 22 -RestoreOutputDir '<新的隔离输出目录>' -SkipRemoteStatus
```

只有链、目标 DB 和引用内容全部通过才发布 db.sqlite 与 files。失败不创建目标，原归档保留。不能从叠加目录里按文件名最大值随意挑 DB，也不能把 tar 可解包当完整性通过。

管理员生产恢复顺序：核对目标程序/schema → 停止应用写入 → 保全当前 DB/WAL、文件和配置 → 从已验证输出安装 db.sqlite 与 files 到新的数据目录 → 修正属主/权限 → 检查配置与版本 → 启动应用并验证。失败恢复保全副本；恢复过程中不重启 Minecraft。同 schema 的普通程序回滚按 §11，不覆盖健康现行库。

#### 15.8.2 世界恢复

只有明确授权且有当前世界备份时才停 Minecraft。选择已校验归档，在隔离目录验证 level.dat、世界目录结构和空间；停服后保留现行世界副本，安装已核对世界并修正属主。启动后验证玩家/区块与服务状态，失败恢复保全副本。应用/文档验收使用隔离解包，不触发这条生产流程。

#### 15.8.3 密钥包、DSH 与 mcbot 恢复

在可信 PC 解密并核对 manifest/SHA，按最小范围恢复受限配置，不把临时明文上传到应用。DSH 凭据、Home/账号、QQ 作用域和单一入站分别验证；新 DSH 写入先加密保全。mcbot 状态先 verify，再在副本 restore，确认目标暂停、待恢复任务和维度记忆可读。主机配置恢复按原权限，备份私钥禁止放 Pi。

#### 15.8.4 验证清单

- 应用版本/schema、登录、文件/笔记/分享与设备认证。
- DSH 三路就绪、Web SSO/登出、QQ 单入站与作用域、mcbot 工具撤权/急停；真实平台只执行获准验收。
- mcbot 目标/任务/世界记忆可读，目标不自动执行。
- 告警受控 webhook 和接收端幂等、Windows 拉取/ack、云端密文链、完整隔离演练。
- 逐项记录环境、包哈希、成功/失败/跳过和缺口，不能把恢复前结果写成恢复后通过。

### 15.9 Web 文件级恢复

仅受保护的明文归档可以导入/校验/浏览/计划/执行；名称合法化后、读取或解包前，对 `.age` 返回 409 archive_encrypted。应用不持私钥，不能在线恢复密文。

计划按目标快照和链内实际 tar 内容，从新到旧查找文件，并按实测大小估算；仅选择可恢复 origin=user 文件。真正缺失内容通过 skippedMissing 显示，非空不能视为完整恢复。执行验证归档与文件哈希/大小，配额和 staging 空间，写到新目录/新 id，不覆盖现行内容；整库恢复不在 Web API 中。

### 15.10 故障排查

| 症状 | 核对 |
|---|---|
| pending 堆积 | PC 连通、任务固定副本/标记、校验失败；不删 pending 解除告警 |
| 密钥包失败 | age、公钥权限、DSH 组合配置、mcbot 初始化/清单和读取权限 |
| 演练失败 | report 的稳定错误码、链覆盖、schema 和全部引用文件；保全损坏归档并建立新全量基线 |
| 世界链失败 | RCON、空间、save-on 收口、远端与 PC SHA、实际 level.dat 解包 |
| 异地失败 | remote/受限配置、OAuth、三件套、远端容量；失败不能删除最新全量链 |
| 状态 unknown | 固定状态文件是否存在、普通文件/64 KiB 校验、新鲜度与配置；文件缺失不等于检查通过 |

### 15.11 当前限制

Web 不解密、私钥丢失无法恢复、预部署快照受限明文、崩溃临时明文和密文孤儿均属于当前边界。应用云端链不含世界/独立密钥包，需分别保存和演练。备份成功不等于恢复通过，缺口在 ACCEPTANCE/AUDIT 明确维护。
