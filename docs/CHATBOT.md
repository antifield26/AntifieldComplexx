# QQ 与聊天机器人

生产 QQ 由 DeepSeek Harness QQ Agent 处理白名单私聊、群 @ 和图片。Workbench 不再提供收发、发布、OpenCode Chat 或机器人管理页。schema 22 已删除旧 QQ 表。告警只走 webhook。

离线回滚运行时的兼容性基于 OpenCode v2.2.5。该运行时不经过 Workbench 的旧 QQ 管线。自主会话与管理员对话也不回退到 OpenCode。

DSH 0.2.2-rc.3，QQ 插件 0.5.5。凭据、白名单和会话记忆由 DSH 自己保管。Workbench 不读取 `CHATBOT_*`、`DSH_QQ_MANAGED` 或 `OPENCODE_HTML_MODE`。生产环境里的残留键用 `bootstrap-env.sh --force --prune-unknown` 清理，先备份 env。

企业微信告警是独立 webhook，不属于 QQ。
