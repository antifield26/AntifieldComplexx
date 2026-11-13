# AntifieldComplexx 文档索引

> 当前 v1.2.2 已部署（2026-11-13，运维验收中，尚未发布），schema 21 / mcbot 契约 v2 / DeepSeek Harness 0.2.2-rc.1。当前事项见 [BACKLOG](app/BACKLOG.md)，生产证据见 [ACCEPTANCE](app/ACCEPTANCE.md)。
> 客户端与 schema 21 绑定。当前演练 `20261112T115843Z`（schema 21）。退回 v1.1.1 必须恢复迁移前快照、旧 release、Access 策略与公网界面。
> 项目定位：**个人综合交互平台**——统一账号与入口整合个人数据与分享、Minecraft 与 mcbot、QQ chatbot、DeepSeek Harness AI 工作区、主机监控与备份灾备。

## 应用（apps/workbench，Web 端）

| 文档 | 内容 |
|---|---|
| [PLAN](app/PLAN.md) | 范围、决策、阶段与验收 |
| [ARCHITECTURE](app/ARCHITECTURE.md) | 模块边界、运行模型、数据流 |
| [API](app/API.md) | HTTP 契约（服务端与前端共同遵守） |
| [UI-SPEC](app/UI-SPEC.md) | 界面与交互 |
| [DEPLOY](app/DEPLOY.md) | 部署、升级、回滚与主机配置 |
| [BACKUP](app/BACKUP.md) | 应用归档、世界备份、恢复演练 |
| [SECURITY](app/SECURITY.md) | 安全模型、边界与加固 |
| [CHATBOT](app/CHATBOT.md) | QQ chatbot 子系统（原 bot，schema v18 更名） |
| [ACCEPTANCE](app/ACCEPTANCE.md) | 验收记录（含 v1.1.1 与历史版本结果） |
| [ROADMAP](app/ROADMAP.md) | 版本边界与后续路线 |
| [AUDIT](app/AUDIT.md) | 审计与修复总记录（含 v1.1.1 至 v1.0.5、磁盘审计附录） |
| [BACKLOG](app/BACKLOG.md) | 当前 12 项收口台账，区分分支、生产及未决验证 |

## Minecraft bot（apps/mcbot）

| 文档 | 内容 |
|---|---|
| [README](mcbot/README.md) | mcbot 能力、架构、安全约束与快速开始 |
| [API](mcbot/API.md) | 本机 HTTP/SSE 契约（读/控制 Token、contract v2） |
| [DEPLOY](mcbot/DEPLOY.md) | 部署、bootstrap、回滚 |
| [ROADMAP](mcbot/ROADMAP.md) | mcbot 版本边界与后续规划 |
| [ACCEPTANCE](mcbot/ACCEPTANCE.md) | mcbot 验收记录（含 Agentic 离线/实机流程） |
| [CONSISTENCY-AUDIT](mcbot/CONSISTENCY-AUDIT.md) | v1.0.6 文档声明与代码实现一致性审计矩阵 |

## 历史归档（Legacy）

| 文档 | 内容 |
|---|---|
| [CHANGELOG](legacy/CHANGELOG.md) | v1.0.0 之前全部历史记录（旧名称/旧版本号保留用于追溯） |
| [README](legacy/README.md) | Legacy 归档说明、tag 与迁移背景 |

## 其他

- 根 [README](../README.md)：项目简介与快速入口
- 根 [CHANGELOG](../CHANGELOG.md)：v1.0.0 起的主变更日志
- [AGENTS](../AGENTS.md)：工程约定、命令、安全红线与环境事实
- `deploy/tool-versions.json`：schema / OpenCode / mcbot 期望版本单一来源
