# 当前范围

版本沿革见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。本文只记录现在要保持的范围。

## 范围

Minecraft Bot 页只有三块：Bot 状态（连接、健康、任务、在线模式、急停）、会话、事件记录。会话展示内存中的 DSH 步骤：用户文本、助手文本、工具名与成败、目标或待办的动作和短标题。不展示工具参数、令牌、提示词或世界记忆正文，也不写入数据库。模型仍按这句话决定是否调用现有 13 个 mcbot 工具，以及 DSH 已有的 goal 与 todo。执行器、工具名和 11 项任务白名单保持不变。不挂 goal-round-driver。游戏内口令保留。急停不经过模型，并清空该时间线。空闲的 `no_active_task` 算成功。

应用不再提供任务开始、目标写、目标读取、自主开始、移动、游戏发言或历史代理。在线模式、只读状态、停止任务、停止自主会话和急停保留。服务器页与白名单保留。分页标签是「Minecraft Bot」。路由 `/minecraft` 与 `?tab=mcbot`、`#mcbot` 保留。侧栏仍是「Minecraft」／「MC」。

Workbench 不再提供旧 QQ 收发、发布、OpenCode Chat 或机器人管理页。生产 QQ 由 DSH 管理。OpenCode HTML 兼容层已删除。DSH Web 反代、Origin 校验和插件页代理保留，HTML 原样转发。PWA 安装与离线壳已删除，图标保留。

DSH Web 启用插件页 `ui-plugin-manager` 与清单插件 `plugin-package-inventory-deepseek`。页面经 `/api/pluginManager/`、`/api/pluginInventory/`、`/api/remote.mux` 与带连字符的 `/api/plugin-manager/detail-file` 查看、安装和卸载。上传、设置写入和凭据写入仍拒绝，描述接口除外。原始路径里的 `%` 拒绝。模型侧 `tool-plugin-manager` 保持关闭。Minecraft Agent 的最小策略不因插件页放宽。插件页列出 QQ 与 Minecraft Bot 的只显示条目。这两项分别由各自的 Agent 运行。Web 进程不启动第二个 QQ 机器人，也不装入 Minecraft Bot 工具。插件查询使用 `/usr/local/bin/pnpm-dsh`。2026-11-17 已在生产完成一次安装和卸载。

schema 22。契约保持 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。本版已于 2026-11-16 部署。

## 回滚

运行中的 Workbench 是 `20261116T135139Z`（v1.2.4，schema 22），mcbot 是 `20261116T135658Z`。恢复 v1.2.3 必须先换回迁移前快照 `db-predeploy-20261116T135240676Z.sqlite`，再把 Workbench 指回 `20261114T082631Z` 并只重启应用。不能只切换 release。再退把 Workbench 指回 `20261114T042643Z`、DSH 指回 `20261114T043420Z`。v1.2.2 使用 Workbench `20261113T072133Z`、mcbot `20261113T072417Z`、DSH `20261113T080907Z`。跨 schema 退回 v1.1.1 必须恢复 schema 20 快照 `db-predeploy-20261111T104848131Z.sqlite`、当时的 release、Access 策略与公网界面。步骤见 [DEPLOY](DEPLOY.md)。

