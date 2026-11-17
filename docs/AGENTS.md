# 文档与工程指令维护约定

本目录维护契约、操作手册、范围与验收证据；也用于根 README、CHANGELOG、AGENTS 的文档任务。遵守根 AGENTS，先读 [INDEX](INDEX.md)。

## 信息所有权

- 除根 CHANGELOG 与 ROADMAP 外，所有文档只描述现状，不包含版本引入时间、变更前后对照或发布经过。当前回滚目标、快照标识、证据时间与协议示例可以保留；ACCEPTANCE 使用当前状态表，不维护逐次执行日志。
- API 拥有 HTTP 契约；UI-SPEC 拥有交互；ARCHITECTURE 拥有模块关系；SECURITY 拥有信任边界；MCBOT/CHATBOT 拥有当前能力；DEPLOY 拥有操作与回滚步骤。
- PLAN 写当前范围，ROADMAP/CHANGELOG 写版本边界与历史。ACCEPTANCE 记录带日期、环境、提交/包哈希的观测；AUDIT 保留残余、复现/验证方法和缺口。不要在多处复制整份生产记录。
- 版本事实从 package、锁文件、迁移、契约常量和 tool-versions 交叉验证。文档与代码冲突时报告差异并核对实现；文档中的“通过/一致”不能自行证明行为。
- AGENTS 只放稳定约束、局部边界、读取入口和验证要求；运行时指针、安装时间、完整环境键默认值放所属当前文档，故障经过放 CHANGELOG/ROADMAP。当前版本范围与长期安全不变量分开表述。
- 实际地址/凭据位置只放 gitignored 本机记录；公开文档用占位值，不放个人数据或秘密。移动文档时更新链接、索引和检查脚本，避免引用不存在的旧路径。

## 证据与验证

- 未实际执行的检查不能写已通过。区分夹具、CI、候选环境、生产和用户真机结果；保留失败、跳过与待验项，注明检查覆盖范围。
- 对自动检查只声明其实际覆盖：常量/文案检查不等于 HTTP 行为验证，HTTP 夹具不等于真实平台验收。部署基包、Tag 与现场覆盖补丁分开记录。
- 仅文档/指令改动运行 `npm run check:agents`、`npm run check:docs`、`npm run check:naming`、`node scripts/check-version.mjs --quiet`、`git diff --check`。改检查脚本逻辑还需对应夹具及根文件要求的全量门禁。
- 局部 AGENTS 必须从根导航可达；命令说明默认从仓库根执行，文档链接相对所属文件。根≤12 KiB、局部≤8 KiB、项目指令链≤24 KiB，检查保留全局加载余量。
