# Workbench 服务端工程约定

本目录负责应用 HTTP、鉴权、SQLite、文件和上游适配。遵守根 AGENTS；先按改动读取 [API](../../../docs/API.md)、[ARCHITECTURE](../../../docs/ARCHITECTURE.md) 和 [SECURITY](../../../docs/SECURITY.md)。命令从仓库根执行。

## 代码与数据所有权

- `src/main.ts` 负责启动/退出，`config.ts` 校验配置，`db.ts` 集中迁移，`http/routes/` 注册契约。Node 直接运行 TypeScript，相对导入带 `.ts`，不引入服务端打包。
- 迁移只追加。当前支持 schema 查 `db.ts` 与 `deploy/tool-versions.json`；高版本库拒绝启动。Workbench 不包含 QQ 业务表或会话；具体 schema 以迁移结果为准，不添加独立 QQ 子系统。
- 配额统计全部 `kind='file'` 的 size，含回收站与笔记附件，上限 10 GiB；fileCount 只统计 `origin='user'`。`origin='note'` 附件不进入普通列表、搜索和回收站。
- 文件位于 `DATA_DIR/files/<id前两位>/<id>`；先写 tmp，再原子 rename。孤儿回收只删除超期、DB 无行、且符合 id 形状的普通文件。不能把客户端输入当物理路径。
- 分片登记、配额预留、拼接与会话终态遵循现有事务边界；提交前失败保留可重试分片。逐片与整文件哈希都要校验，坏片只使自身失效。
- 分享名额按会话原子预占，两种内容端点共用；同会话多文件/Range 共用名额，HEAD/304/416 不计数。进程异常、发送结果未知时不擅自归还。
- 审计只记元数据，actor≤64、target≤256、detail≤4 KiB；业务提交后的审计失败走健康计数，不回滚业务。

## 鉴权、代理与适配

- Cookie 写接口使用认证和 CSRF，合法设备签名 Bearer 按现有规则豁免；非法 Authorization 不得回退 Cookie。保留签名覆盖范围、nonce 去重、设备吊销与请求体上限。
- Access 放行 API 不代表匿名可用；每条受保护路由仍验证应用认证。公开分享、健康检查和认证入口遵循各自 API 契约，不通过新增 bypass 掩盖应用鉴权错误。
- `src/opencode/` 是 DSH Web 反代的兼容目录名。DSH URL 与 SSO socket 同时配置或同时留空；DSH 上游限制为指定端口的 127.0.0.1 HTTP 根地址。OpenCode 回滚配置仍有兼容读取，不因目录名恢复旧 Chat/HTML shim。
- SSO 一次性票据、HTTP/WS 的 Host/Origin、Authorization 覆盖及登出失效必须共同验证。DSH HTML 原样转发，插件页沿用现有允许列表，不能放开任意上游路径。
- mcbot 上游只走 loopback 根地址，读/控制 Token 分离、禁止跟随重定向；超时和 5xx 映射稳定业务码，URL/Token 大小写不敏感脱敏。响应体流式上限 2 MiB。
- Workbench 只接受 mcbot 契约 v2。应用不提供的任务开始/恢复、目标读写、自主开始、移动、游戏发言及 history 路由返回 404，不访问对应上游。保留只读状态、在线模式、停止、急停与管理员对话。
- 管理员对话要求登录、CSRF 或设备签名、控制 Token 与限流；允许 ASCII `/`，拒绝 C0。审计只记字符数。聊天和 DSH 步骤只留内存，展示文本、工具名与成败、目标/待办动作和短标题，不展示参数、提示词、令牌或记忆正文。
- mcbot 轮询保持单飞和可取消。事件缓存最多 100 条且≤512 KiB；未知契约/无效状态不推进游标。外部 alert 只写 `status='event'`，不得写入 `alert_state`；写失败停游标并幂等重试。
- 外部告警事件与 webhook 投递项同事务提交，游标在成功提交后推进。Webhook 重启续投、同一 Idempotency-Key、最多并发 2、三次尝试及 1/2 秒退避；关闭先停领取再收口在途。不能恢复 QQ 投递。
- Web 不持备份私钥。归档名合法化后、读取/解包前，对 `.age` 返回 `409 archive_encrypted`；恢复目标跳过加密归档。备份状态读取遵守普通文件、大小限制与只读降级规则。

## 验证

- 单项回归可用 Node 的 `--test` 参数指定相关 `apps/workbench/server/test/` 文件；集成夹具使用 `app.inject` 或临时 loopback 假服务，不连接真实平台。
- 改路由同步 API 和路由回归；改数据链路覆盖失败/重试及事务终态。备份与恢复改动还须读取 [脚本约定](../../../scripts/AGENTS.md) 和 [DEPLOY](../../../docs/DEPLOY.md) 的备份与恢复章节。
- 最终运行 `npm run check`、`npm run build` 和 `node scripts/check-version.mjs --quiet`。性能、真实平台与生产验收的证据不能用夹具结果替代。
