# 验收状态

当前版本 v1.2.3。schema 21，契约 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode v2.2.5 只作离线回滚运行时。

运行中的 Workbench 是 `/opt/antifieldcloud/releases/20261114T082631Z`。mcbot 是 `/opt/mcbot/releases/20261114T043045Z`。DSH 是 `/opt/antifield-dsh/releases/20261114T051442Z`。该 Workbench 包在发布记录之外包含插件列表代理。部署内 smoke 为 28／0／0／0。`/healthz` 为 1.2.3、schema 21。完整 Access smoke 39／0／0／0 属于同日较早的发布切换。切换到当前 Workbench 之后，日志里还没有 `listBundles` 或 `listPlugins`。真实插件安装与卸载尚未做。双端登录在当前包上未复验。

演练仍是 `20261113T081625Z`（schema 21，应用与世界隔离恢复）。整包加密与 Google Drive 异地副本保持开启。Windows 计划任务标记 1.2.3，installedAt `2026-11-14T05:26:19.1249844Z`。

同 schema 回滚、跨 schema 快照与发布资产见 [DEPLOY](DEPLOY.md) 与 [CHANGELOG](../CHANGELOG.md)。

