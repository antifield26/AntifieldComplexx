# 验收状态

当前版本 v1.2.4。schema 22，契约 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode v2.2.5 只作离线回滚运行时。

本版已于 2026-11-16 部署。Workbench 是 `/opt/antifieldcloud/releases/20261116T135139Z`，commit `3259bb1`，包 SHA-256 `a3466b46af2d2aae4a2262068c88799fbc2f24940e3038f040550d31b044f396`，1,046,012 字节。`/healthz` 为 1.2.4、schema 22，`pendingBackups=0`。迁移前快照是 `/var/lib/antifieldcloud/backups/db-predeploy-20261116T135240676Z.sqlite`，schema 21，SHA-256 `ca3f4565626f288013db296dd88dfabc5a55a6355da904e2e1836b9f108bced2`。恢复 v1.2.3 必须先换回这份快照，再把 Workbench 指回 `20261114T082631Z`。mcbot 是 `/opt/mcbot/releases/20261116T135658Z`，契约 v2，切换时空闲。同契约回滚指回 `20261114T043045Z` 并只重启 mcbot。Minecraft 未由本次部署重启，单元进入 active 的时间是 2026-11-15 23:00:04 CST。DSH 仍是 `/opt/antifield-dsh/releases/20261114T051442Z`。Web 策略已写入该 release，并只重启了 `antifield-dsh-web`。QQ 与 mcbot-agent 没有因这次策略更新重启。模型侧插件管理保持关闭。

PC 上的 smoke 为 31 通过、7 失败、1 警告、0 跳过。7 项失败都是本机假 IP 上的公网 TLS 握手。同一组请求从 Pi 发出：`/healthz` 200，带 Access 服务令牌的 `/api/version` 401，AI 主机 401，站点清单 200，`/sw.js` 与 `/offline.html` 404，无效分享 404，未登录告警 401，安全响应头齐全。警告是演练仍为 schema 21。没有在生产上安装或卸载插件。桌面与手机登录未复验。插件页仍只列出 Web 进程里的内置插件。

演练仍是 `20261113T081625Z`（schema 21，应用与世界隔离恢复）。整包加密与 Google Drive 异地副本保持开启。Windows 计划任务标记 1.2.4，installedAt `2026-11-16T13:59:38.9288470Z`。退出纳管的环境键已清理，清理前有备份。仓库 systemd 单元已安装并与仓库哈希一致，随后只重启了 `antifieldcloud`。本记录晚于运行中的 release `3259bb1`，不在该包内。

同 schema 回滚、跨 schema 快照与发布资产见 [DEPLOY](DEPLOY.md) 与 [CHANGELOG](../CHANGELOG.md)。

