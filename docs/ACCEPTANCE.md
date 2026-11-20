# 验收状态

当前版本 v1.2.6，已部署至生产树莓派与本机 Windows。Workbench schema 22，mcbot 契约 v2，DSH 0.2.2-rc.3，QQ 插件 0.5.5。正式发布与版本沿革见 [CHANGELOG](../CHANGELOG.md)。

## 当前运行资产

| 组件 | 证据 |
|---|---|
| Workbench | `/opt/antifieldcloud/releases/20261120T002240Z`，基于 `a22b9a7`；工作区包 1,003,636 字节，SHA-256 `9867df10d0f4c43c307bc7f02c49f8927bb164bbd91c7ddcd7cc46d0cb49d938`。 |
| mcbot | `/opt/mcbot/releases/20261120T002522Z`，基于 `a22b9a7`；工作区包 SHA-256 `85dc8237c6d451c817a7b5101e2247324b58107c2c581a750fcbab74315cb694`。 |
| DSH | `/opt/antifield-dsh/releases/20261120T002111Z`，源提交 `a22b9a7`。`SHA256SUMS` 的 SHA-256 为 `4e384d1ffc88ef119f3154612ea0ff09b90df9c587e608d5e4d508b90e075c4b`。三个生产服务就绪。Windows 归档导出的 QQ 设置文件曾为 CRLF，当前指针指向重新验过完整清单的 LF 目录。 |
| Minecraft 与 OpenCode | 部署前后 Minecraft 主进程 PID 均为 1051。OpenCode v2.2.5 作为离线回滚运行时。 |
| 正式发布 | 最新正式 Tag 为 `v1.2.6`，指向 `8d7c1877005d07be295a1bba364e4f00452256aa`。2026-11-20 08:51（北京时间）发布，两个客户端附件和 SHA-256 清单均已从 GitHub 下载核验。客户端产物来自 `a22b9a7`，至发布标签仅追加恢复脚本和回归测试变更。[GitHub Release](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.2.6) |

## 验证结果与缺口

| 范围 | 状态 | 证据 |
|---|---|---|
| v1.2.6 CI | 通过 | 标签对应提交 `8d7c187`，常规和 Windows、Android 原生工作流全部通过。随附客户端产物使用 `a22b9a7` 的构建，其中 Windows 与实机验收的安装包一致。[常规 CI](https://github.com/antifield26/AntifieldComplexx/actions/runs/44647868504) · [原生构建](https://github.com/antifield26/AntifieldComplexx/actions/runs/44647868501) · [客户端附件构建](https://github.com/antifield26/AntifieldComplexx/actions/runs/44641724136) |
| 生产部署与完整 smoke | 40 通过，0 失败，0 警告 | 2026-11-20 08:43（北京时间）。含公网 HTTP、Access 后应用鉴权、Workbench schema 22、mcbot 契约 v2、三个 DSH 服务、35 个 DSH 实际文件的哈希、新版 Windows 计划任务、新归档和实际恢复回写。 |
| DSH ARM64 隔离候选 | 通过 | 2026-11-20 在生产 Pi 的普通账号临时目录装配固定依赖。Web 换票、QQ 设置客户端加载、假网关、mcbot 13 个工具及缺少 `session-steps.mjs` 时拒绝启动均通过。 |
| Pi 盘点与 API 鉴权 | 通过 | 2026-11-20 08:20（北京时间）首次快照完整，含五类占用，每日 timer 已启用。未登录请求盘点和搜索 API 均返回 401。 |
| QQ 真实绑定、换绑、解绑 | 跳过 | 生产三路运行时就绪，真实 QQ 绑定操作按既有验收决定跳过。 |
| 应用备份及隔离恢复 | 通过 | Windows 报告 `20261120T004050Z` 覆盖一个加密全量和 19 个增量。SQLite schema 22、完整性、外键和 3 个引用文件对账通过，世界已隔离解包并校验 `level.dat`。恢复水位 `2026-11-20T00:35:01.3920000Z` 与 Pi 回写一致。 |
| 异地备份与恢复 | 上传状态通过，真实取回待验 | 已设置 `BACKUP_OFFSITE_EXPECTED=true`。v1.2.6 的云端应用归档取回和解密通过隔离夹具验证；Windows 真实 Drive 演练待完成。 |
| Windows x64 | 原位升级、启动通过 | 2026-11-20，本机已由 v1.2.5 升级。安装登记和已安装程序均为 1.2.6，普通权限启动后正常创建主窗口。安装包 SHA-256 为 `9e074998047a9002a1dc56934f5bd0f1c53b0ca9e13c25838db8c37c9941a3cc`。 |
| Windows 备份任务 | 已更新 | 2026-11-20，三个任务沿用原配置，安装标记为 v1.2.6，四个固定脚本 SHA-256 与仓库一致。应用与世界拉取任务实际退出码均为 0，Pi 的应用归档、世界和密钥包状态成功。本地新增密文 `snapshot-20261120T003501392Z-inc.tar.gz.age` 旁文件齐全且 SHA-256 匹配。 |
| Android ARM64 | 同签名校验通过，真机待验 | `versionCode=1002006`，目标 SDK 36，沿用 v1.2.5 证书。签名后的 APK SHA-256 为 `db6890ae2749dbc52a9220dc6d9fd0fe934a2611d8af977494355fb0720f71a0`。 |
| `inspect_chest` 实机路径 | 待验 | 离线夹具覆盖，实机路径无独立通过证据。 |

## 当前恢复源

Workbench 首选同 schema 回滚至 v1.2.5，保留在用 DB/WAL。本次部署快照 `db-predeploy-20261120T002353606Z.sqlite` 已核验 SQLite 完整性、schema 22 和 SHA-256 `47a1bbef8a111bb4b850a7054749e82582e964f5c2c334d41b9ef58e2d5951b5`。DSH 冷备 `dsh-20261120T002008799679508Z.tar.age` 已生成，密文 SHA-256 旁文件校验通过。组件回滚指针及配置位置见 [DEPLOY](DEPLOY.md)。
