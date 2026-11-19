# AntifieldComplexx 文档索引

操作文档只描述现行行为。版本边界见 [ROADMAP](ROADMAP.md)，交付记录见仓库根 [CHANGELOG](../CHANGELOG.md)。

当前版本 v1.2.5，schema 22，mcbot 契约 v2。DeepSeek Harness 0.2.2-rc.3，QQ 插件 0.5.5。生产指针见 [DEPLOY](DEPLOY.md)。

| 文档 | 内容 |
|---|---|
| [PLAN](PLAN.md) | 当前范围、非目标与回滚 |
| [ARCHITECTURE](ARCHITECTURE.md) | 模块边界与数据流 |
| [API](API.md) | Workbench HTTP 契约与 mcbot 本机契约 |
| [UI-SPEC](UI-SPEC.md) | 界面与交互 |
| [MCBOT](MCBOT.md) | Minecraft Bot 现行能力与安全约束 |
| [DEPLOY](DEPLOY.md) | 部署、升级、回滚、备份与恢复 |
| [备份隐私说明](BACKUP-OAUTH-PRIVACY.md) | 自用 Google Drive 备份的授权范围 |
| [SECURITY](SECURITY.md) | 安全模型与现行控制 |
| [CHATBOT](CHATBOT.md) | QQ 与 DSH 的现行边界 |
| [ACCEPTANCE](ACCEPTANCE.md) | 当前验收状态 |
| [AUDIT](AUDIT.md) | 当前残余与声明矩阵 |
| [ROADMAP](ROADMAP.md) | 按日期排列的版本边界 |

根 [README](../README.md) 是项目入口。[AGENTS](../AGENTS.md) 是工程约定。`deploy/tool-versions.json` 是 schema、OpenCode、mcbot 与 DSH 的期望版本。

工程指令按客户端、服务端、mcbot、脚本、部署/DSH 和文档分层，入口统一在根 AGENTS 的任务导航。修改对应目录前主动读取局部说明。生产指针、安装时间和故障定位维护于 DEPLOY，验收证据维护于 ACCEPTANCE；AGENTS 不重复维护这些现场事实。

`npm run check:agents` 检查根/局部指令体积、项目祖先链预算、根导航、相对 Markdown 链接、字面 npm script 名称及 Node 脚本入口。它不执行文档命令，不检查链接锚点、完整 shell/工作区命令语义、规则含义或生产状态。根文件≤12 KiB，局部≤8 KiB，项目链≤24 KiB；全局指令仍需由本机配置控制。
