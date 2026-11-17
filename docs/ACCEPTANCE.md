# 验收状态

当前版本 v1.2.4。schema 22，契约 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode v2.2.5 仅作离线回滚运行时。

状态依据截至 2026-11-17 的有效证据，本文不代表实时健康探测。变更经过与逐次发布记录见 [CHANGELOG](../CHANGELOG.md)。

## 当前运行资产

| 项目 | 当前状态/证据 |
|---|---|
| Workbench | `/opt/antifieldcloud/releases/20261116T135139Z`，基包 commit `3259bb1`，1,046,012 字节，SHA-256 `a3466b46af2d2aae4a2262068c88799fbc2f24940e3038f040550d31b044f396` |
| 应用健康证据 | `/healthz`：1.2.4 / schema 22；`pendingBackups=0` |
| mcbot | `/opt/mcbot/releases/20261116T135658Z`，契约 v2 |
| DSH | `/opt/antifield-dsh/releases/20261114T051442Z`；Web 文件组合含 pnpm-dsh、两个只显示插件及 Web 策略；覆盖文件的逐项哈希待核验 |
| Minecraft | 独立服务；单元 active 时间 2026-11-16 23:00:06 CST，不作为应用发布的重启对象 |
| systemd/环境 | 应用单元与仓库哈希一致；应用环境纳管键按当前配置规则提供 |
| Windows 安装资产 | `AntifieldComplexx_1.2.4_x64-setup.exe`，3,368,949 字节；完整校验见 Release 的 SHA256SUMS |
| Android 安装资产 | `AntifieldComplexx_1.2.4_arm64.apk`，16,877,993 字节，使用本机兼容 debug 签名；该包真机验收待完成 |
| Windows 任务 | 安装标记 1.2.4，`installedAt=2026-11-16T13:59:38.9288470Z`；异地任务每日 13:00 |
| 备份 | 整包 age 加密与 Google Drive 异地副本开启；应用/世界隔离演练证据仅覆盖 schema 21，标识 `20261113T081625Z` |

## 验证结果与缺口

| 验证范围 | 状态 | 边界/待办 |
|---|---|---|
| PC 完整 smoke | 未全通过：31 PASS / 7 FAIL / 1 WARN / 0 SKIP | FAIL 为本机假 IP 上的公网 TLS 握手；WARN 为演练 schema 不匹配 |
| Pi 来源的接口探测 | 通过 | healthz 200；带 Access 服务令牌的 `/api/version` 401、AI 主机 401；清单 200，SW/离线壳 404，无效分享 404，匿名告警 401；安全响应头齐全 |
| 插件页查看、安装、卸载 | 通过，用户确认 | QQ/Minecraft 为只显示条目；模型侧插件管理关闭 |
| Windows/Android 当前发布包登录 | 待验 | 不能用其他安装包的结果代替 |
| schema 22 应用与世界隔离恢复 | 待验 | 需按当前期望 schema 重跑，并验证恢复出的 level.dat |
| `inspect_chest` 实机路径 | 待验 | 离线夹具覆盖，实机路径无独立通过证据 |

## 当前恢复源

回滚目标 v1.2.3 使用 schema 21 快照 `/var/lib/antifieldcloud/backups/db-predeploy-20261116T135240676Z.sqlite`，SHA-256 `ca3f4565626f288013db296dd88dfabc5a55a6355da904e2e1836b9f108bced2`。恢复前须保全 schema 22 现行数据并核验源；同 schema 回滚保留 DB/WAL。指针与操作见 [DEPLOY](DEPLOY.md)。

应用基包、DSH 现场文件组合与仓库 Tag 分别识别；本文件作为状态说明，不属于运行基包的版本证明。
