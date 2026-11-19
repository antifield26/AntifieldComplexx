# QQ 与聊天机器人

生产 QQ 由 DeepSeek Harness 的独立 QQ Agent 处理。DSH 0.2.2-rc.3，官方插件 `@tencent-connect/dsh-qqbot` 0.5.5；包版本与 integrity 由独立锁文件固定。

## 接入与隔离

- 每个 AppID 只允许一条入站链路。私聊与群聊均配置白名单，群聊要求 @Bot；群斜杠命令在命令分发前拦截。
- QQ 绑定记录由独立服务以 0600 保存，模型凭据由 systemd 注入。账号、DSH Home、工作目录与 Web/mcbot Agent 隔离。Workbench 只转发已认证的绑定操作，不持久化平台凭据、收发队列、发布任务或 Chat 会话。
- 角色与结构化记忆属于独立 QQ 数据仓。私聊按 AppID/用户隔离，群聊按 AppID/群/成员隔离，使用平台确认身份。无法确认归属的内容只留受限加密档，不进入活动记忆。
- 图片理解限制来源、重定向、大小与临时文件寿命；本地文件及交付物外发关闭。日志不记录平台正文或凭据。
- 记忆变更候选由管理员本机审核；确认清除时撤销可确认归属的记忆及待审项并轮换相关会话。

## Workbench 边界

Workbench 的 QQ Webhook、发布和 OpenCode Chat 路径不存在，schema 22 不含 QQ 业务表。DSH 设置中的「QQ 机器人」显示独立服务状态，并打开主站绑定页。扫码、手填、更换和解绑要求主站密码与 TOTP 再认证，网关由独立 QQ 服务串行切换。不同 AppID 需要明确确认私聊和群白名单，解绑后历史仍按原 AppID 隔离。平台密钥吊销由用户在 QQ 开放平台完成。

Workbench 告警只走 webhook，企业微信接收属于该独立投递通道，不是 QQ 入队。应用不读取 `CHATBOT_*`、`DSH_QQ_MANAGED` 或 `OPENCODE_HTML_MODE`。

运行、备份、恢复和受控环境配置清理见 [DEPLOY](DEPLOY.md)；当前验收状态见 [ACCEPTANCE](ACCEPTANCE.md)。
