# 备份工具的公开说明页

本目录仅包含 Google OAuth 使用的公开首页、隐私说明和静态响应头，不读取配置、凭据或业务数据。部署到独立的公开站点，不复用受保护的应用与 AI 反代入口。

- 上传清单固定为 `index.html`、`privacy.html`、`_headers`、`.nojekyll`；不得把工作区、环境文件或备份目录整体上传。
- 账号持有人需要的 Google 网站验证标记，仅加到受限本机构建副本，不写入仓库；验证成功后按 Google 要求保留站点中的标记。
- `privacy.html` 与 `docs/app/BACKUP-OAUTH-PRIVACY.md` 一起维护；首页始终链接同一站点的 `/privacy.html`。
- 发布前核对根域名没有既有网站记录，记录 DNS 与 Pages 部署；回退只处理该站点或根域名新增记录，不改动应用、AI、Minecraft 等子域名。
- 说明页只有静态 HTML／CSS，不包含模型、登录、文件上传、云盘访问、统计脚本或 Cookie。Cloudflare 免费静态托管的配额和当前状态以平台为准。

托管层可能保留 Cloudflare 安全检测脚本；不为说明页添加统计代码。若区级 RUM 自动注入已开启，使用仅匹配说明页主机名的 `disable_rum=true` 配置规则，不改动全区或其他子域名的统计及安全设置。
