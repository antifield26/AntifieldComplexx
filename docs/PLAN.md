# 当前范围

本文描述当前产品范围；版本变更仅见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。

## 平台

当前产品 v1.2.6，schema 22，mcbot 契约 v2；DSH 0.2.2-rc.3，QQ 插件 0.5.5。版本期望以 `deploy/tool-versions.json` 为准。

- Windows、Android 与 Web 共用账号与业务接口，原生请求使用设备签名。文件、知识库、分享、主机指标、告警及灾备能力按 API/UI-SPEC 提供。
- Minecraft Bot 面板由状态、管理员会话和事件组成。会话显示内存中的文本、工具名/成败、目标或待办的动作和短标题；正文与步骤不写应用 DB，不显示工具参数、凭据、提示词或世界记忆正文。
- 管理员明确指令由模型决定是否调用 13 个 mcbot 工具，以及 DSH 的 goal/todo；任务白名单 11 项。游戏内口令可用。急停直接撤权并清空时间线，不经过模型；空闲的 `no_active_task` 算成功。
- 应用提供在线模式、只读状态、停止任务、停止自主会话和急停；任务开始、目标读写、自主开始、移动、游戏发言和历史代理路径不存在。
- QQ 由独立 DSH QQ Agent 管理；Workbench 不承担 QQ 收发、发布或管理，也不提供 OpenCode Chat。告警投递仅 webhook。
- AI 工作区使用 DSH Web 反代、Host/Origin 校验和一次性 SSO，HTML 原样转发。客户端具有隔离 AI 容器。站点提供图标与清单，不提供 PWA 安装或离线壳。

## DSH 插件页

已登录管理员可在 Web 插件页经受控代理查看、安装和卸载插件。允许 `/api/pluginManager/`、`/api/pluginInventory/`、`/api/remote.mux` 与 `/api/plugin-manager/detail-file`；会话上传、设置写入和凭据写入拒绝，描述接口按代理允许列表处理，原始路径中的 `%` 拒绝。

QQ 与 Minecraft 条目只显示独立服务，不允许禁用/卸载；Web 进程不启动第二条 QQ 入站，也不装入 Minecraft 动作工具。查询使用 `/usr/local/bin/pnpm-dsh`。模型侧 `tool-plugin-manager` 和 goal-round-driver 不启用，Minecraft Agent 保持最小策略。

「设置 → QQ 机器人」展示独立服务的状态和主站入口。绑定、换号与解绑通过主站再认证和 QQ 私有 socket 执行。

## 回滚与验收

同 schema 回滚恢复 release 指针与配置，保留现行 DB/WAL。回滚目标若只支持 schema 21，必须先保全现行 schema 22 数据并使用匹配的一致性快照，不能只切指针。当前可用指针、快照和操作见 [DEPLOY](DEPLOY.md)；当前验证结果与缺口见 [ACCEPTANCE](ACCEPTANCE.md)。

工作台提供跨文件、笔记、书签检索、备份证据与磁盘分类预览。Google Drive 恢复由 Windows 使用离线私钥手动验证。
