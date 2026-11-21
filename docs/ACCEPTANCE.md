# 验收状态

当前版本 v1.3.0 已正式发布，真实模型隔离验收及 Windows、Android 原位升级已通过。生产树莓派应用使用 v1.2.6。本地 Windows 与受验 Android 设备使用 v1.3.0。Workbench schema 22，mcbot 契约 v2，DSH 0.2.2-rc.3，QQ 插件 0.5.5。版本沿革见 [CHANGELOG](../CHANGELOG.md)。

## 当前运行资产

| 组件 | 证据 |
|---|---|
| Workbench | `/opt/antifieldcloud/releases/20261120T002240Z`，基于 `a22b9a7`；工作区包 1,003,636 字节，SHA-256 `9867df10d0f4c43c307bc7f02c49f8927bb164bbd91c7ddcd7cc46d0cb49d938`。2026-11-21 本机 `/healthz` 为 1.2.6、schema 22。 |
| mcbot | `/opt/mcbot/releases/20261120T002522Z`，基于 `a22b9a7`；工作区包 SHA-256 `85dc8237c6d451c817a7b5101e2247324b58107c2c581a750fcbab74315cb694`。2026-11-21 只读核对：单元 inactive、开机禁用，`127.0.0.1:3010` 未监听。 |
| DSH | `/opt/antifield-dsh/releases/20261120T002111Z`，源提交 `a22b9a7`。`SHA256SUMS` 的 SHA-256 为 `4e384d1ffc88ef119f3154612ea0ff09b90df9c587e608d5e4d508b90e075c4b`。2026-11-21 只读核对三个生产服务均为 active。Windows 归档导出的 QQ 设置文件曾为 CRLF，当前指针指向重新验过完整清单的 LF 目录。 |
| Minecraft 与 OpenCode | 2026-11-21 只读核对：minecraft.service 为 active，主进程 PID 1056，启动于 2026-11-20 23:00:22（北京时间）。OpenCode v2.2.5 作为离线回滚运行时。 |
| 正式发布 | 附注标签 `v1.3.0` 指向 `58894d056bb7d786761251d8ee60bcc130331b97`。2026-11-20 23:24（北京时间）发布并设为 Latest。草稿中的两个现场验收客户端附件和 SHA-256 校验清单已从 GitHub 下载核验，正式发布所列摘要一致。标签客户端源码与通过原位升级的构建一致。[GitHub Release](https://github.com/antifield26/AntifieldComplexx/releases/tag/v1.3.0) |

## 验证结果与缺口

| v1.3.0 发布验收 | 环境与观测 |
|---|---|
| CI | 2026-11-20，提交 `58894d056bb7d786761251d8ee60bcc130331b97` 的常规 CI、Windows x64 和 Android ARM64 原生工作流均通过，两个平台的产物已归档。现场安装包哈希见下方验收项。[常规 CI](https://github.com/antifield26/AntifieldComplexx/actions/runs/44724747802) · [原生 CI](https://github.com/antifield26/AntifieldComplexx/actions/runs/44724747832) |
| 游戏执行器 | 2026-11-20，Pi 隔离 Fabric 26.1.2，Loader 0.20.1，匹配生产模组。两个测试账号分别验证共享箱取出和主人拾取 8 个铁锭。另验证同维度会合与跟丢、扫描与采矿入包、真实冶炼、逐次许可及重放拒绝。测试进程最高一次观测 RSS 221 MiB。 |
| Fabric 刻率 | 隔离 Fabric 控制台返回目标 20.0 刻/秒与平均每刻耗时。RCON 通路由离线夹具验证。 |
| 真实模型 | 2026-11-20，Pi ARM64 回环 Fabric 与独立 DSH 进程验证 `58894d0`。游戏内点名经 DeepSeek 调用工具，从共享箱取出 8 个铁锭并逐件交付，接收方背包和 Bot 账本均为 8。模型曾提交一个无效坐标，重试成功。同行走到距主人 2.48 格，失联后停止。临时服务均已停止，生产 Minecraft 的进程和启动时间复核一致。 |
| Windows x64 原位升级 | 2026-11-20，使用已发布 NSIS 安装包，SHA-256 为 `e3031e61ac5bcdb0f948674044fa35982cfee9bb9da47224d062e71a01b05aaa`。常规尝试遇临时目录和文件写入错误。经用户确认管理员提示后，安装器退出码为 0，注册表和程序版本均为 1.3.0，路径保留，主窗口恢复原已登录会话。 |
| Android ARM64 签名与原位升级 | 2026-11-20，同一证书签署，v2/v3 签名和对齐通过。签名 APK SHA-256 为 `482c9a516c51d9a0d920ee98614d608648a369dfc6e7571280f3c6c19778965b`。真机从 versionCode 1002006 升至 1003000，应用 ID、首次安装时间和数据目录一致，主 Activity 启动成功，用户确认可进入原有页面。 |

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
