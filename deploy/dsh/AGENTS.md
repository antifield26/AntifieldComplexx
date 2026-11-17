# DSH 运行时与插件工程约定

本目录维护独立 DSH 依赖、启动包装、SSO 换票和 QQ/mcbot 插件边界。遵守根与 [部署约定](../AGENTS.md)，先读 [DEPLOY](../../docs/DEPLOY.md)、[CHATBOT](../../docs/CHATBOT.md)、[MCBOT](../../docs/MCBOT.md)。

## 隔离与权限

- Web、QQ、mcbot Agent 三个独立服务，使用独立账号、Home、工作目录、会话和凭据。Web 的 QQ/Minecraft 条目只显示状态，不启动第二个 QQ 入站或装入动作工具；QQ 每 AppID 只允许一条入站链路。
- 模型侧 plugin-manager 保持关闭，不挂 goal-round-driver。普通聊天、意图解析与路点建议不装动作工具；Minecraft Agent 不启用 shell、文件系统或插件管理。
- Web 命令仅在专用工作目录与 Bubblewrap/审批策略内运行，不扩大挂载或关闭隔离以掩盖依赖路径错误。
- 启动令牌只在进程内和受限 Unix socket 完成原生 Cookie 交换；不进入 URL、日志或错误响应。保留 SSO User-Agent 一致性、Origin/Host 校验、登出失效与在途连接清理。
- QQ 白名单、群 @Bot、命令分发前拦截群斜杠命令、平台确认身份与记忆作用域都要保留。图片下载限制来源、重定向、大小和临时文件寿命；关闭本地文件/交付物外发。
- mcbot 插件只把工具提交给私有 Unix socket，业务验证仍由 mcbot 执行；不得以插件逻辑绕过任务白名单、安全阈值、执行 ID、撤权或工具预算。

## 依赖、补丁与运行记录

- DSH/SDK/QQ 版本只从 `deploy/tool-versions.json` 及本目录 package/lock 读取。独立锁定依赖与 integrity，针对固定组合保留定向兼容规则和可审计腾讯插件补丁，不使用全局忽略 peer 检查代替验收。
- 插件查询使用系统安装的 pnpm-dsh 包装，仅 `view` 去除 npm 不接受的 fetch-retries 参数，其他调用透传 pnpm。可执行文件不能指向被 ProtectHome 拦截的主目录。
- 不扩展 Workbench 插件页代理允许列表来开放上传、设置写入或凭据；只显示条目不得禁用/卸载。DSH UI 管理与模型工具权限是不同边界。
- 不在活动 release 静默改程序；获准现场补丁按部署约定记录基包、文件哈希和回滚。生产与 Tag 不同必须如实标注。
- 日常密钥包覆盖配置、凭据、QQ 结构化记忆；部署/退役冷备另外覆盖 Web/QQ 会话历史。回滚前加密保全新 DSH 写入。

## 验证

- `scripts/test/dsh-*.test.mjs` 验证包装与策略，随根 `npm test` 执行；涉及 mcbot 同时跑 `npm run check:mcbot`。
- 固定版本实际加载、Cordis/Agent/Session/工具注册和 ARM64 权限由隔离候选/CI runtime 验证。任何一项失败不得生产切换；mock 全绿不代表真实 QQ、模型或 SSO 已通过。
