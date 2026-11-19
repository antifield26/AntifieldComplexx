# 验收状态

当前版本 v1.2.6（开发候选）。下列发布与生产证据属于 v1.2.5。云端真实取回、Pi 盘点、Windows 原位升级及 Android 真机待验。schema 22，契约 v2。DSH 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode v2.2.5 仅作离线回滚运行时。

v1.2.5 已于 2026-11-18 切换到个人生产环境。真实 QQ 扫码、换绑和解绑候选验收按用户决定跳过。变更经过见 [CHANGELOG](../CHANGELOG.md)。

## 开发候选验证

| 环境 | 2026-11-20 候选证据 |
|---|---|
| GitHub Actions | 候选分支 `codex/v1.2.6-workspace` 的基线 `fe47399` 通过 [常规 CI](https://github.com/antifield26/AntifieldComplexx/actions/runs/44532645959) 和 [Windows、Android 原生构建](https://github.com/antifield26/AntifieldComplexx/actions/runs/44532645918)。后续提交按各自工作流结果验收。 |
| Windows 本地夹具 | 临时目录内用模拟 rclone 和 age 验证云端恢复链、数据库与文件。Edge 连接本机夹具，在 390 像素视口复核首页关注项、全屏检索及跳转到具体备份异常。 |
| 现场验收 | 本次交付限候选包。真实 Drive 恢复、Pi 磁盘采样、Windows 原位升级、Android 真机安装保留为现场验证项。 |

## 当前运行资产

| 项目 | 2026-11-18 至 2026-11-19 实际证据 |
|---|---|
| 正式发布 | `v1.2.5` Tag 指向 `7b8fa703bc190fea2072e85b69c82bc2ee389c31`。2026-11-19 10:43（北京时间）发布，远端附件哈希匹配本地清单。[GitHub Release](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.2.5) |
| Workbench | `/opt/antifieldcloud/releases/20261118T150139Z`，基于 `e0978d6` 的工作区包，1,004,012 字节，SHA-256 `8680065b8bdcf5836506b49c00257412d79cf771aab10408912518851571f60b` |
| mcbot | `/opt/mcbot/releases/20261118T150139Z`，v1.2.5 / 契约 v2。工作区包 SHA-256 `488e460c9e33904df2aeb7960d1981556638484574cfa9d98715b60954701543` |
| DSH | 当前 `/opt/antifield-dsh/releases/20261119T020617Z`，基于 `/opt/antifield-dsh/releases/20261118T150321Z`，比对 37 个基包文件 SHA-256，并独立校验补入的 `session-steps.mjs`，SHA-256 `6eb6e451beddab255d5479e2128ff1fbb3b46773aee973ea0c8acf9cb69c084c`。锁文件 SHA-256 `ff49912803db7f17b2cf966fa20c95dccdd86a35045741bc41a4cfdb4d5704b0`，QQ 设置客户端 SHA-256 `186ac70ec8178d3e983100ffd8d4719c4de64508f3e5187c63a56ceb6d37510d` |
| Minecraft | 切换 mcbot 以及恢复独立 DSH 代理前后均保留同一 Minecraft 主进程 |
| 备份 | age 整包加密和 Google Drive 异地副本启用。2026-11-18 23:31 应用与密钥包拉取成功，23:32 世界拉取成功，23:35 异地同步成功 |

## 验证结果与缺口

| 范围 | 状态 | 证据与边界 |
|---|---|---|
| 发布 CI | 通过 | 两套工作流均使用 Tag 指向的提交，覆盖 DSH 固定运行时、测试与覆盖率、生产依赖边界、依赖审计、密钥扫描、PowerShell 以及两端原生构建。[常规 CI](https://github.com/antifield26/AntifieldComplexx/actions/runs/44445084700) · [原生构建](https://github.com/antifield26/AntifieldComplexx/actions/runs/44445084599) |
| Windows x64 | 本机原位升级并启动 | 正式附件 SHA-256 `44ef9a42ab582c61b124186dc6ba9be819fac333b3fd169b4a11050b917be4aa`。2026-11-19，本机下载核验后由 v1.2.4 原位升级，NSIS 临时文件错误经同一账号管理员授权重试解决。安装记录及二进制均为 v1.2.5，普通权限启动主窗口并显示登录界面。本轮真机验证覆盖安装和启动 |
| Android ARM64 | 签名兼容校验通过 | `versionCode=1002005`，目标 SDK 36，沿用 v1.2.4 证书。正式附件 SHA-256 `60f959039dd073468e2ebfe673f4cd544de80d04341896a67447341c740d94e9`。手机真机安装待验 |
| 公网、树莓派直连与 Windows 本机严格 smoke | 40 通过、0 失败、0 警告 | 2026-11-19。公网应用 HTTP 200，Access 后应用鉴权 HTTP 401，AI 入口 HTTP 401。Workbench v1.2.5、schema 22、`db=ok`、`pendingBackups=0`。三个 DSH 服务就绪，systemd 无失败单元，7 个单元和 3 个固定维护脚本一致。含 Windows 任务副本、最新本地归档及当前 schema 恢复状态 |
| DSH QQ 设置入口 | 生产运行时通过 | 本机 SSO 后启动页注册 QQ 客户端模块，状态接口 200，主站链接匹配，现有 QQ 网关就绪。Workbench 服务账号可读取私有绑定状态 |
| 真实 QQ 绑定、换绑、解绑 | 跳过 | 用户决定跳过候选，生产只核对当前绑定及入口 |
| 新版备份拉取 | 通过 | Windows 复核应用增量、密钥包与当周世界的 SHA-256 均一致，Pi 待确认归档为 0 |
| Windows 备份任务 | 通过 | 2026-11-18 管理员重装，安装标记 v1.2.5，四个脚本副本哈希一致。世界任务固定周日 12:30 |
| Windows 异地副本 | 通过 | 2026-11-18 23:35 回写成功，上传计数 2、失败 0 |
| schema 22 应用与世界隔离恢复 | 通过 | 2026-11-19 10:01（北京时间），Windows 报告 `drills/20261119T020016Z/report.json`。加密链含 1 个全量与 16 个增量，数据库完整性及外键校验通过，3 个引用文件哈希一致，世界已解包并验证 `level.dat`，Pi 回写 `ok=true`、`schemaVersion=22`、`worldExtracted=true` |
| `inspect_chest` 实机路径 | 待验 | 离线夹具覆盖，实机路径无独立通过证据 |

## 当前恢复源

首选同 schema 回滚至 v1.2.4，保留 DB/WAL。部署前的 schema 22 快照 `db-predeploy-20261118T145935414Z.sqlite` 已通过哈希与 SQLite 完整性校验，SHA-256 为 `a13eacc5c17bac577030e5e17b803a082154833d904aa68fd973884c50fe1608`。配置和旧指针的保护目录为 `/var/backups/antifieldcloud/update-125-20261118T150139Z`。更早的 schema 21 回退资源见 [DEPLOY](DEPLOY.md)。

生产工作区包按构建时的基包提交与哈希识别。正式 Tag 标识客户端构建源码，DSH 现场文件另核对各自哈希。
