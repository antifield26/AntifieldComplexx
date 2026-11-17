# 未完成事项

已交付的版本边界见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](../CHANGELOG.md)。这里只列尚未关闭的事项。

| ID | 事项 | 状态 |
|---|---|---|
| PLUGIN-01 | 在生产 DSH Web 上实际安装或卸载一个插件 | 查询包装已生效，安装与卸载仍未做。安装框执行 `pnpm view`，Web 策略使用 `/usr/local/bin/pnpm-dsh`，只去掉 npm 12 不接受的 fetch-retries。主机 npm 12.2.2 与 pnpm 10.34.9 在 `/usr/local/bin`。指向主目录的 npm 仍会被 ProtectHome 拒绝。2026-11-17 隔离查询在带上该参数时返回包名和版本。模型侧插件管理工具保持关闭 |

夹具通过不等于真机或生产通过。

