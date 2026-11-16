# 未完成事项

已交付的版本边界见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。这里只列尚未关闭的事项。

| ID | 事项 | 状态 |
|---|---|---|
| PLUGIN-01 | 在生产 DSH Web 上实际安装或卸载一个插件 | 查询阻塞已排除，安装与卸载仍未做。2026-11-16 安装框执行 `pnpm view`，该命令再调用 `npm`。当时没有 pnpm，且 `npm` 指向主目录，Web 服务的 ProtectHome 无法执行它，界面显示「无法获取插件信息」。注册表可连通。主机现已有 `/usr/local/bin/npm` 12.2.2 与 `/usr/local/bin/pnpm` 10.34.9。隔离条件下查询能返回包名和版本。Web 单元未重启。策略里的绝对路径在下次启动时生效。模型侧插件管理工具保持关闭 |
| PLUGIN-02 | 远程插件页列出 QQ 与 Minecraft Bot 插件 | 已核对，不装入 Web 进程。插件页和「设置 → 内置插件」只读取 DSH Web 进程。QQ 插件由 `antifield-dsh-qq` 以 overlay `im-qqbot` 载入，Minecraft Bot 工具由 `antifield-dsh-mcbot-agent` 以 overlay `dsh-mcbot` 载入。两项都不在 Web 进程，页面不会列出它们 |

夹具通过不等于真机或生产通过。

