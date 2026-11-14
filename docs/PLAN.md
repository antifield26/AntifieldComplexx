# 当前范围

版本沿革见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。本文只记录现在要保持的范围。

## 范围

Minecraft Bot 的面板行动入口是管理员对话。模型按这句话决定是否调用现有 13 个 mcbot 工具，以及 DSH 已有的 goal 与 todo。执行器、工具名和 11 项任务白名单保持不变。不挂 goal-round-driver。游戏内口令保留。急停不经过模型。空闲的 `no_active_task` 算成功。对话正文不进数据库。

应用上的任务开始、目标写、自主开始、移动和游戏发言返回 409，且不调用上游。在线模式、只读状态、停止任务、停止自主会话和急停保留。分页标签是「Minecraft Bot」。路由 `/minecraft` 与 `?tab=mcbot`、`#mcbot` 保留。侧栏仍是「Minecraft」／「MC」。

DSH Web 启用插件页 `ui-plugin-manager` 与清单插件 `plugin-package-inventory-deepseek`。页面经 `/api/pluginManager/`、`/api/pluginInventory/`、`/api/remote.mux` 与带连字符的 `/api/plugin-manager/detail-file` 查看、安装和卸载。上传、设置写入和凭据写入仍拒绝，描述接口除外。原始路径里的 `%` 拒绝。模型侧 `tool-plugin-manager` 保持关闭。Minecraft Agent 的最小策略不因插件页放宽。

不迁移 schema。契约保持 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。

## 回滚

运行中的 Workbench 是 `20261114T082631Z`。同 schema 回滚先把 Workbench 指回 `20261114T051811Z` 并只重启应用，保留现行数据库及 WAL。再退把 Workbench 指回 `20261114T042643Z`、DSH 指回 `20261114T043420Z`。v1.2.2 使用 Workbench `20261113T072133Z`、mcbot `20261113T072417Z`、DSH `20261113T080907Z`。跨 schema 退回 v1.1.1 必须恢复 schema 20 快照 `db-predeploy-20261111T104848131Z.sqlite`、当时的 release、Access 策略与公网界面。步骤见 [DEPLOY](DEPLOY.md)。

## 未完成

见 [BACKLOG](BACKLOG.md)。真实插件安装尚未做。当前 Workbench 切换后尚未观察到插件列表读取。

