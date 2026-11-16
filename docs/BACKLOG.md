# 未完成事项

已交付的版本边界见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。这里只列尚未关闭的事项。

| ID | 事项 | 状态 |
|---|---|---|
| PLUGIN-01 | 在生产 DSH Web 上实际安装或卸载一个插件 | 查询阻塞已排除，安装与卸载仍未做。安装框执行 `pnpm view`，该命令再调用 `npm`。主机使用 `/usr/local/bin/npm` 12.2.2 与 `/usr/local/bin/pnpm` 10.34.9。指向主目录的 npm 仍会被 ProtectHome 拒绝。隔离条件下查询能返回包名和版本。仓库策略已写入正在运行的 DSH release，并已重启 `antifield-dsh-web`。模型侧插件管理工具保持关闭 |
| PLUGIN-02 | 远程插件页列出 QQ 与 Minecraft Bot 插件 | 已核对，不装入 Web 进程。插件页和「设置 → 内置插件」只读取 DSH Web 进程。QQ 插件由 `antifield-dsh-qq` 以 overlay `im-qqbot` 载入，Minecraft Bot 工具由 `antifield-dsh-mcbot-agent` 以 overlay `dsh-mcbot` 载入。两项都不在 Web 进程，页面不会列出它们 |

夹具通过不等于真机或生产通过。

