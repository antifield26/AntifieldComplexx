# 部署配置工程约定

本目录维护运行时模板和最小权限配置。遵守根 AGENTS；先读 [DEPLOY](../docs/DEPLOY.md) 与 [SECURITY](../docs/SECURITY.md)。涉及 DSH 时还须读取 [DSH 局部约定](dsh/AGENTS.md)，涉及脚本时读取 [脚本约定](../scripts/AGENTS.md)。

## 稳定边界

- Pi 原生 systemd，不用 Docker。产品名可改显示，`antifieldcloud` 服务账号、路径、单元、Windows 任务与协议标识保持兼容。
- 模板使用 TEST-NET/`<domain>` 占位。只在获准部署中按 `.local/DEPLOYMENT.md` 应用实际值，不把受限配置复制到仓库。
- 服务账号不授予交互登录或广泛 sudo；只给所需路径写权限。保留现有 CapabilityBoundingSet、ProtectSystem/Home、设备与地址族限制，不通过关闭整套加固修正路径问题。
- mcbot 和 DSH 上游只监听 loopback，SSO 与工具使用私有 Unix socket。Web/QQ/mcbot 的账号、Home、目录和凭据隔离。
- 不改既有 Minecraft/frpc/SSH 配置，不重启 Minecraft；获准例外必须有备份。SSH/防火墙变更先核对来源允许集合，保留已建立连接或物理回滚通道。手工 nftables reload 后须按 DEPLOY 恢复 fail2ban set。
- Cloudflare/QQ 后台变更由用户完成；可校验应用所需路径与认证边界，不自行扩大 Access bypass。页面与 AI 保留 Access，API 到达应用后仍执行应用认证。
- 世界备份是唯一可执行固定 RCON 存盘动词的 root 服务；只通过 timer/受限维护入口触发，不向应用 API 暴露。

## 当前范围与操作证据

- 版本从 [tool-versions](tool-versions.json) 读取并与包/契约/迁移交叉校验；生产 release、快照、安装时间和验收结果分别维护于 DEPLOY/ACCEPTANCE，不写进 AGENTS。
- 配置变更必须说明影响的服务、健康条件与回滚。不要把仓库模板存在或 systemd 文本检查通过当作已安装生效。
- 切换前保存并验证数据库和配置；同 schema 回滚保留现行库与 WAL。跨 schema 回退严格使用匹配快照，不只切指针。
- DSH 程序更新使用新 release 和原子 current 切换。现场覆盖补丁须记录基包、文件清单及哈希、回滚副本和重启范围，不能宣称与同名 Tag 完全一致。
- 应用、mcbot、DSH 分别验证；无需重启的服务保持运行。密钥、模型正文与会话数据不进入日志、包或公开验收记录。

## 验证

- 本地脚本与配置测试仅使用夹具；安装、ARM64、权限矩阵及外部平台的负路径在隔离候选中验证。
- 生产操作前重新核对运行中的版本、schema、指针和备份，不能仅依赖文档日期。生产只执行当前任务批准的验收，不制造故障。
