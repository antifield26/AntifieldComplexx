# v1.1.0 Agent Harness 候选切换手册

当前生产基线为 v1.0.13、schema 20、mcbot 契约 v2。切换按 Web、QQ、mcbot 顺序执行。OpenCode 2.2.5 是该窗口的回滚运行时。

Web 的 `workspace_read` 与 `workspace_command` 通过 Bubblewrap 执行。子进程只挂载专用工作区和系统运行库，清空宿主环境并隔离网络。命令逐次走 DSH 审批。文件浏览、终端和动态宿主运行入口关闭。Workbench 代理保留浏览器初始化需要的设置和凭据描述接口，拒绝原生文件上传、配置写入和插件管理请求。切换前实测越界读取和审批拒绝。

## 安装与预检

- 在 CI 使用 `deploy/dsh/package-lock.json` 独立安装。固定 DSH 和 SDK 为 `0.2.2-rc.1`，腾讯 QQ 插件为 `0.5.5`。腾讯 peer 只覆盖它声明的四个 DSH 包。传递依赖 `undici` 和 `zod` 固定为通过高危审计的版本。腾讯补丁在修改前校验 npm 包文件 SHA-256。
- ARM64 Pi 检查磁盘、内存余量及 Node 26。用 `sudo bash deploy/dsh/stage.sh` 安装候选。该命令安装三个 systemd 单元、专用账号和 socket 目录。首次安装创建候选 `current`。后续更新由管理员在检查新 release 后原子切换该链接。
- 管理员在 `/etc/antifieldcloud/dsh` 写入 0600 root 配置。三个模型凭据文件为 `web-deepseek-key`、`qq-deepseek-key`、`mcbot-agent-deepseek-key`。另准备 `qq-app-id`、`qq-app-secret`、`qq-access.json`（`direct` 与 `groups` 两个非空 OpenID 列表）、`web.env`（`DSH_WEB_ORIGIN=https://ai.<domain>`）。密钥由 systemd `LoadCredential` 注入。保持 Cloudflare Access。
- Web 采用 DeepSeek 账号时，管理员在 PC 运行 `pwsh -File scripts/dsh-account-login.ps1`，打开 SSH 会话显示的本机地址完成授权，再退出临时会话。确认专用 profile 已保存账号授权，在 `web.env` 设置 `DSH_WEB_AUTH=account`，并将 `deploy/dsh/web-account.conf` 安装为 Web 单元的 drop-in。此模式在加密包中校验原生账号授权文件。QQ 和 mcbot 仍用各自的 API 凭据。
- 在独立候选环境验证锁文件、模型、QQ 白名单、工具矩阵和三路并行资源占用。每次更新锁文件后重跑。保存 schema 20 数据库快照、mcbot 数据和备份任务安装信息，并校验校验和。记录旧 Workbench QQ `chatbot_deliveries`、`chatbot_publish_jobs` 中待处理或未完成的状态与计数。回滚前核对这些任务是否已通过其他途径发送。
- 企业微信告警在目标内部群创建群机器人，把 Webhook 放入本机受限配置并写入生产环境 `ALERT_WEBHOOK_URL`，将 `ALERT_WEBHOOK_TYPE` 设为 `wecom`。地址本身是凭据。Workbench 发送纯文本并以企业微信业务码 `errcode=0` 确认投递。超时或失败仍由现有投递箱重试。企业微信群机器人未提供投递键去重，远端已收而本地超时的窗口可能出现重复。
- 使用 `scripts/dsh-cold-backup.sh opencode` 加密保存停用状态的 OpenCode 安装、unit、配置与数据库。保持 Workbench 与 Minecraft 在线。把归档和 SHA-256 移到 PC 独立保留区，并用离线私钥在隔离目录验证解密、数据一致性及 2.2.5 启动。随后按当前服务窗口恢复 OpenCode，直到所有 DSH 路径通过。

## 切换与验收

1. **Web** 启动 `antifield-dsh-web.service`。将 `deploy/dsh/workbench-link.conf` 安装为 Workbench 的 `10-dsh.conf` drop-in。Workbench 配置 `DSH_WEB_URL=http://127.0.0.1:3080` 和 `DSH_WEB_SSO_SOCKET=/run/antifield-dsh-web-link/sso.sock` 后重载 systemd、启动候选 Workbench。实测 SSO、刷新、流式回答、停止、登出后断开及非法 Origin，检查浏览器和日志中没有启动令牌。工具权限矩阵应覆盖专用工作目录外的读写、执行、上传和终端 API。
2. **QQ** 从一致性快照执行 `qq-memory-cli.mjs <QQ 数据库绝对路径> import <源库绝对路径> <AppID 文件绝对路径>`。使用受限的临时副本，并确保导入产物归 `antifield-dsh-qq` 所有、权限 0600。只确认得出归属的记录会导入，旧数据库留在加密档。受控 Webhook 必须收到新告警并实测失败重试。管理员在 QQ 平台关闭旧入站订阅，并将 Workbench `DSH_QQ_MANAGED=true`。确认旧入口不再接收，再启动唯一的 QQ Agent。实测白名单内外的私聊、群聊 @、群斜杠命令拦截、图片、记忆审核和私聊清除。
3. **mcbot** 启动 `antifield-dsh-mcbot-agent.service`。安装 `deploy/dsh/mcbot-link.conf` 为 mcbot 的 `10-dsh.conf` drop-in，配置 `DSH_AGENT_SOCKET=/run/antifield-dsh-agent-link/agent.sock`、`DSH_MCBOT_TOOL_SOCKET=/run/antifield-dsh-tools-link/tools.sock`，重载 systemd 后启动 mcbot 候选。Minecraft 持续运行。测试普通对话和路线建议无动作工具。主人启动后测试观察、任务边界、急停、旧 Bearer、再次启动、世界记忆复用。确认旧 MCP 路由关闭。
4. **停用与清理** 保存 `scripts/dsh-cold-backup.sh dsh` 的冷备及校验和，验证 Web 和 QQ 会话历史能在隔离目录恢复。停用 OpenCode 后，使用 `scripts/smoke.ps1 -ExpectedDshVersion 0.2.2-rc.1 -ExpectedDshQqVersion 0.5.5 -RequireOpenCodeStopped` 并带现有 Access 验收参数，重跑 Webhook、Windows 拉取和隔离恢复。通过后，确认归属再卸载 OpenCode 单元、二进制、活动数据和旧 MCP 依赖，复核端口、DSH 三路状态及备份。验收证据入库后发布 Tag 和 Release。

## 回滚

先排空和停止 DSH 服务，再为新会话与结构化记忆保存加密冷备。切回旧 Web 与 mcbot release、旧配置和 Windows 任务。移除 DSH 专用 drop-in 前确认旧账号权限，恢复 QQ 唯一入站订阅。OpenCode 已卸载时，从 PC 验证过的离线档恢复 2.2.5 并做单独运行时校验。Workbench 优先保留现行 schema 20 数据库，只有数据库损坏才恢复部署前快照。新状态保留在加密档中，由管理员分别核对。
