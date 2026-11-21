# AntifieldComplexx · 个人综合交互平台

面向 Raspberry Pi 5（8 GB，Debian 13）的个人综合交互平台，以统一账号和单一入口整合个人数据、Minecraft、AI 工作区、QQ Bot、主机监控及备份灾备。

> 状态：v1.3.0。schema **v22**，mcbot 契约 v2。Web、QQ 与 mcbot Agent 使用 DeepSeek Harness 0.2.2-rc.3，QQ 插件 0.5.5。OpenCode **v2.2.5** 仅用于离线回滚。
>
> 当前部署与验收缺口见 [ACCEPTANCE](docs/ACCEPTANCE.md)，操作与回滚见 [DEPLOY](docs/DEPLOY.md)，版本变更仅在 [CHANGELOG](CHANGELOG.md) 与 [ROADMAP](docs/ROADMAP.md) 维护。

## 能力

| 模块 | 当前功能 |
|---|---|
| 账号与客户端 | 单管理员密码/TOTP、恢复码、会话管理、设备登记与 Ed25519 请求签名；Windows/Android Tauri 客户端和 Web 界面 |
| 云盘 | 不可变文件、逻辑目录、搜索、回收站、白名单预览、Range 下载、分片上传与断点重传 |
| 知识库 | Markdown 笔记、书签、标签、FTS5 搜索、附件和版本历史 |
| 分享 | 单文件/多文件、密码、过期、会话级下载次数、吊销；公开页按文件下载 |
| Minecraft | 服务器只读状态、TPS、玩家和白名单管理 |
| Minecraft Bot | 连接/健康/任务状态、在线模式、管理员对话、停止、急停、事件与告警；模型按显式指令调用受控工具 |
| AI 工作区 | `ai.<domain>` 的 DSH Web，Workbench 单点登录、流式响应、隔离工作目录及插件页 |
| QQ Bot | 独立 DSH QQ Agent 与官方插件处理白名单私聊、群 @Bot、图片理解及独立角色/结构化记忆 |
| 可观测性 | 主机指标、服务与备份状态、审计、条件告警和持久化 webhook 投递箱 |
| 灾备 | 应用全量/增量归档、age 密钥包、Minecraft 世界一致性备份、PC 拉取、隔离恢复演练及 Google Drive 密文异地副本 |

## Minecraft Bot 与 AI 边界

- Minecraft 页提供「服务器／Minecraft Bot」标签，支持 `?tab=mcbot` 与 `#mcbot` 深链。Bot 面板由状态、会话和事件记录组成。
- 管理员对话是面板的行动入口；模型可使用 14 个 mcbot 工具和 DSH 的 goal/todo。任务白名单含钓鱼、种田、砍树、挖矿、天然林、睡觉、巡逻、守卫、护送、探索和安全区清理。
- 面板提供在线模式、停止和急停；任务开始、目标读写、自主开始、移动、游戏发言和历史代理路径不存在。游戏内口令与 mcbot 私有控制入口按各自权限工作。
- 急停直接撤销运行权限并停止模型、运动和任务，不调用模型。会话正文与步骤仅在内存，展示工具名与成败，不展示工具参数、提示词、凭据或世界记忆正文。
- 寻路包含 pathfinder、确定性规划、受控执行与路点建议，不挖掘、不放置、不跑酷。资源记忆按维度隔离，只自动记录实际观察并复核的资源点；到场失效时回退扫描。
- mcbot 仅监听 loopback，Workbench 用分离的读/控制 Token 代理；浏览器不直连。状态与事件按轮询展示，不可达时保留缓存和可见错误。事件告警只记为 `status='event'`，不参与条件告警的活跃/恢复状态机。
- Web、QQ、mcbot Agent 使用独立账号、Home、工作目录和凭据。Web 插件页中的 QQ/Minecraft 条目只负责显示，不在 Web 进程启动这些服务。模型侧插件管理工具保持关闭。

详细能力、工具和阈值见 [MCBOT](docs/MCBOT.md)、[CHATBOT](docs/CHATBOT.md) 与 [API](docs/API.md)。

## 数据与安全

- 服务端是 Node 26 原生 TypeScript + Fastify，SQLite WAL/FTS5；前端为 React/Vite，原生壳为 Tauri。Pi 使用 systemd，不使用 Docker。
- 应用密码使用 scrypt，支持 TOTP 与恢复码；Cookie 写请求验证 CSRF，合法设备签名 Bearer 按设备契约认证。设备私钥由原生受控接口管理。
- 文件通过 DB id 访问，内容不可变。配额 10 GiB，包含回收站和笔记附件；普通上传上限 100 MiB，分片上传上限 5 GiB。笔记附件与普通文件按 origin 隔离。
- SVG/HTML/XML 强制下载；文本预览上限 1 MiB。分享 token 只存 SHA-256，次数按会话原子预占，多文件和 Range 共用名额。
- AI 上游固定 loopback，HTTP/WS 校验 Host/Origin；远端 AI 窗口不能使用设备命令。Cloudflare Access 保护页面，`/api` 到达应用后仍验证应用认证。
- 应用 Minecraft API 只提供状态和白名单，不提供任意 RCON、启停、封禁或 OP。世界备份通过 root 受限脚本执行固定存盘动词。
- 密钥、正文和工具参数不进入日志、审计或前端 bundle。审计失败诊断经 `/api/version.audit` 可见，业务提交后的审计失败不回滚业务。
- 生产启用独立 age 整包加密与 Google Drive 异地副本，模板默认关闭。Pi 只持公钥，私钥离线至少两份；加密失败关闭，Web 不持私钥且对 `.age` 返回 409。异地只上传密文及校验旁文件。

安全模型与当前限制见 [SECURITY](docs/SECURITY.md) 和 [AUDIT](docs/AUDIT.md)。

## 开发与验证

```bash
npm ci
npm run dev              # Fastify，默认 127.0.0.1:3000
npm run dev:web          # Vite，/api 代理到本地 Fastify
npm run check            # 类型、lint、服务端/脚本/前端/mcbot、命名、指令和文档门禁
npm run build            # 前端生产产物，含入口体积门禁
node scripts/check-version.mjs --quiet
```

- 定向验证：`npm run test:web`、`npm run check:mcbot`、`npm run check:agents`、`npm run check:docs`、`npm run check:client`。
- 覆盖率：`npm run test:coverage`、`npm run test:web:coverage`，以及 mcbot 工作区的覆盖率命令。
- 原生构建：`npm run build:client:windows`、`npm run build:client:android`。工具链、公开源注入与签名要求见 DEPLOY。
- 自动化测试使用临时目录和 loopback 假平台，不访问真实 Minecraft、QQ、模型或生产。CI 还验证覆盖率、依赖边界、密钥扫描和适用原生构建。

## 目录与文档

```text
apps/client/             React 界面、Tauri 与原生源码
apps/workbench/server/   Fastify、SQLite、认证、文件、分享、告警和上游适配
apps/workbench/web/dist/ 前端构建产物
apps/mcbot/              Minecraft Bot 动作、任务、安全、记忆与 Agent 会话
scripts/                 部署、备份、拉取、恢复演练与检查
scripts/test/            运维工具的离线夹具
deploy/                  systemd、主机模板、环境模板与独立 DSH 运行时
docs/                    当前契约、界面、架构、安全、运维及验收状态
```

工程约定与局部指令入口见 [AGENTS](AGENTS.md)，完整文档导航见 [INDEX](docs/INDEX.md)。运行时 `antifieldcloud` 路径、服务名、任务名与协议标识保持兼容。

## 当前限制

- 单管理员、单应用进程、单 mcbot 上游；内存限流在重启后清零，同步维护可短暂阻塞请求。
- Cloudflare 终止 TLS；单 SD 卡与 SQLite `synchronous=NORMAL` 无法保证突然断电时的最后一段写入。
- 分享不提供目录打包、服务端 zip 或公开笔记；客户端仍受边缘单请求大小和时长限制。
- 聊天、事件和 DSH 步骤仅存在内存，重启会清空。状态最多滞后一个轮询周期。
- 世界归档和独立密钥包由 PC 拉取；Google Drive 链只覆盖应用密文。恢复演练手动/季度执行，当前待验项见 ACCEPTANCE。
- 加密私钥丢失后无法恢复密文；预部署 SQLite 快照为受限明文。崩溃可能留下需清理的临时明文或待核对的密文孤儿。

## License

MIT © 2026 Antifield。见 [LICENSE](LICENSE)。公开仓库只使用示例域名、TEST-NET 网段和占位路径；实际部署值只放 gitignored 的 `.local` 或受限主机配置。
