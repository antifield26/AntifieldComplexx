# mcbot

`apps/mcbot` 是 AntifieldComplexx 单仓库中的 Minecraft AI 陪伴 bot。

- 游戏内人格名：`Lofii`（可配置）；服务/仓库/技术标识：`mcbot`
- 运行：Node 26 + mineflayer，systemd 服务 `mcbot.service`，仅监听 `127.0.0.1:3010`
- 文档：见 [`docs/MCBOT.md`](../../docs/MCBOT.md)、[`docs/INDEX.md`](../../docs/INDEX.md)
- 部署：`.\apps\mcbot\scripts\deploy.ps1`；本地检查：`npm run check:mcbot`
