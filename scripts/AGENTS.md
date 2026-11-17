# 脚本与运维工具工程约定

本目录负责可重试的部署、备份、演练、版本与工程检查。遵守根 AGENTS；操作流程读 [DEPLOY](../docs/DEPLOY.md)，已验证的状态读 [ACCEPTANCE](../docs/ACCEPTANCE.md)。命令默认从仓库根执行。

## 备份与恢复

- 应用归档两阶段 pending/ack，未确认不删。加密启用时 age 缺失、公钥非法、加密失败或空间不足均使 prepare 失败，不产生 pending、不降级明文。
- Pi 只读取独立 backup age 公钥：root 属主、组/其他不可写、单行 age1 格式。私钥离线至少两份，独立于 secrets-age；应用与 Pi CLI 不读取私钥。
- 空间按 2× 明文预算。明文只短暂使用 `*.plain.tmp`，密文与 sidecar 落盘后立即删除；归档内 manifest 不自引用，plainSha256/plainSize 放外部 sidecar 与 DB manifest_json，`.sha256` 表示密文哈希。
- PC 解密先校验密文和 sidecar，再校验明文；drill 按 manifest 验证增量覆盖水位，并对账目标 DB 全部文件，含回收站和附件。无哈希记录校验大小，DB 仍引用的缺失内容必须失败。
- 世界演练用临时目录隔离解包并校验 level.dat，不通过停服或替换生产世界完成验收。世界备份仅固定 save-off/save-all flush/save-on，save-on 在 finally 重试；失败要写明确状态。
- 异地只上传 `.age`，拒绝明文；链感知保留且不能删最新 full。状态只写别名、计数、时间，不写真实远端路径/URL/凭据；未配置不触发超期告警。
- 密钥包包含适用的 DSH 配置/凭据/QQ 记忆与 mcbot 一致性目标库、任务、世界记忆；区别已收录、尚未产生和读取失败。启用服务但关键初始化状态缺失或校验失败时，密钥包失败。
- 读写状态文件使用固定路径、普通文件检查、64 KiB 上限与原子替换；应用只读。密钥包和冷备保持 age 加密，临时明文验收后清理。

## 部署与主机边界

- 发布包使用明确清单，排除工作区凭据、数据和 node_modules；分别核对 Workbench/mcbot 的版本与 SHA-256。DSH 独立锁文件可入包，目标端按锁安装。
- 部署前校验一致性快照、schema、当前指针与配置；健康检查核对应用版本、schema 和运行时就绪。同 schema 回滚只恢复指针和配置，保留 DB/WAL；跨 schema 回退先保全现行库并验证恢复源 SHA、SQLite 完整性和 schema。
- 维护 root 能力只经 `antifield-maint` 固定动词；不扩大免密 sudo 为 shell/node/npm/tee 或通配路径。管理员交互密码不放脚本、环境或聊天。
- Windows 文件操作使用单一 PowerShell 语义与 `-LiteralPath`；递归删除/移动前验证绝对目标位于明确范围。启动后台程序默认隐藏，不拼接跨 shell 删除命令。
- Windows 备份脚本更新后需重新安装任务，刷新固定脚本副本、SHA 与安装标记；此步骤由用户管理员执行，除非当前任务已明确授权代办。任务名与本机运行时目录保持兼容。
- `bootstrap-env.sh --force --prune-unknown` 前备份配置；新增环境键同步模板、解析器与纳管清单。实际地址、remote、凭据按需从受限配置读取，不输出值。

## 检查脚本与测试

- 检查应只读、可重入，失败返回非零和稳定错误码；不可用字符串存在检查冒充运行时/生产验证。输出清楚说明覆盖范围。
- 指令文件变更运行 `npm run check:agents`；版本事实用 `node scripts/check-version.mjs --quiet`；mcbot 文档常量用 `npm run check:docs`。不要求 AGENTS 抄写发布版本。
- 新脚本逻辑用 `scripts/test/*.test.mjs` 的临时目录、SQLite/tar/age/HTTP 夹具覆盖成功和失败；允许 loopback 假服务，不访问真实 Pi、云盘或平台。测试随根 `npm test` 收集。
- systemd/Linux 专属行为由 Linux CI 验证；Windows 明确 skip 原因。部署/备份脚本改动同步 DEPLOY 的回滚与「15. 备份与恢复」。
