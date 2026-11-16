# 界面规范

产品名是 AntifieldComplexx，中文界面。Android AI 为独立隔离页面，返回条避开状态栏和刘海，远端没有设备能力。

Minecraft Bot 页只有三块：Bot 状态、会话、事件记录。任务、移动和游戏内发言由会话里的模型或游戏内口令发起。页面不提供目标草案。

- 单一暗色青色品牌，深浅分层、青蓝光感、短 opacity／transform 过渡，遵守减少动画设置。
- Windows 自绘标题栏提供拖动、最大化、最小化、还原与关闭，原生权限限定本地 main。
- Android 底部首页／文件／MC／更多，更多集中知识库、分享、回收站、活动与设置。适配安全区、键盘及至少 44px 触控区域。
- Android 使用产品 AC 自适应图标；固定顶栏／底栏不参与 WebView 容器拉伸，保留内容惯性滚动。
- 首页优先常用入口、异常和关键状态，趋势与详情下移；未知服务及高负载明确提示。
- 会话时间线展示用户文本、助手文本、工具成败，以及目标或待办的动作和短标题。进行中每 1 秒轮询，空闲每 5 秒。迟到轮询不能覆盖新状态。
- 分块加载保留导航；断网保留旧画面，恢复只刷新读取，写操作不自动重发。
- 普通页面、视图和排序按账号／来源记忆，筛选与滚动仅内存；退出／吊销清理，未保存内容离开须确认。
- 原生文件走签名桥并可取消，关闭预览撤销句柄。Android AI 为独立隔离页面，返回条避开状态栏和刘海，远端无设备能力。

首页 AI 工作区使用统一登录入口。服务卡展示已配置的 DSH 服务和就绪状态。设置页列出本账号设备。公网界面默认开启。关闭后，公网管理页显示「请使用客户端」，分享页由服务端渲染。loopback 仍打开完整界面。

## 1. 定位与基调

- 产品名：**AntifieldComplexx · 个人综合交互平台**；中文界面；暗色科技感。
- 关键词：安静、克制、信息密度适中、像可靠的个人基础设施，而不是花哨仪表盘。
- 参考感觉：Linear / Vercel 的暗色面板 + 家用 NAS 的亲和力；不使用外部字体、图片或 CDN。
- 目标设备：PC 浏览器（主）、手机（390 px 宽可用）、Pi 本机 Chromium。

## 2. 视觉系统

CSS 变量（`web/src/styles/tokens.css`）：

```css
:root {
  --bg: #0a0e14;
  --bg-elevated: #0f151d;
  --surface: #121a24;
  --surface-hover: #17212d;
  --border: #1f2b3a;
  --border-strong: #2b3b4f;
  --text: #e6edf3;
  --text-muted: #93a4b8;
  --text-dim: #6b7d92;
  --accent: #22d3ee;
  --accent-strong: #06b6d4;
  --accent-soft: rgba(34, 211, 238, 0.12);
  --success: #34d399;
  --warning: #fbbf24;
  --danger: #f87171;
  --radius: 14px;
  --radius-sm: 9px;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  --font: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace;
}
```

- 背景 `--bg`；卡片 `--surface` + 1px `--border`；强调色 cyan 仅用于主按钮、选中态、进度、关键数字。
- 圆角 14/9；卡片内边距 20；桌面内容最大宽度 1320；栅格间距 16/20。
- 字号：正文 14；辅助 12.5；标题 20/16；大数字 28–34（等宽数字）。
- 图标：`lucide-react`，18–20 px，颜色随文本；不使用彩色 emoji。
- 动效：150–200 ms ease；只做 opacity/transform；尊重 `prefers-reduced-motion`。
- Logo：方形渐变（cyan→blue）+ `AC` 字母；登录页与侧栏使用。

## 3. 布局

**桌面（≥ 1024 px）**
- 左侧固定侧栏 232 px：Logo/产品名；导航（工作台、文件、回收站、知识库、分享、Minecraft、机器人、活动）；底部用户菜单（用户名、设置、退出）。
- 主区：顶部页头（标题 + 右侧操作），内容区滚动。
- 最大宽度 1320，居中，左右 28 px。

**平板/手机（< 900 px）**
- 顶部栏：Logo + 当前页标题 + 用户菜单；抽屉式导航。
- 底部固定 Tab（工作台/文件/Minecraft/更多）可选；保证安全区 padding。
- 表格转卡片列表；操作按钮收进 `…` 菜单；上传按钮悬浮（FAB）或工具栏主按钮。

## 4. 页面

### 4.1 登录 `/login`

- 居中卡片（最大 420 px），暗色，顶部 Logo + “AntifieldComplexx · 个人综合交互平台”。
- 两步：
  1. 用户名（默认预填 `antifield`，可改）+ 密码；主按钮“下一步”。
  2. 6 位 TOTP 输入（大号等宽、自动聚焦）；主按钮“登录”；次链接“使用恢复码”。
- 恢复码模式：输入恢复码；链接“返回验证码”。
- 错误：卡片内红色提示；429 显示“尝试过多，请 X 分钟后再试”；401 统一“用户名或密码错误 / 验证码无效”。
- 成功：站内 `next` 直接跳转；ai 外部 `next` 先经 `/api/auth/ai-ticket?next=...` 由服务端 302 到 ai `/__af/sso/<ticket>`，ai 代理设置 host-only 会话 Cookie 后再进入目标路径；不得直接 `window.location.assign(ai URL)`（否则无 ai 会话而循环跳登录）。
- 底部小字：“仅限本人使用 · 所有操作均记录审计”。

### 4.2 工作台 `/`

- 页头：“工作台”，右侧显示当前时间/刷新按钮；数据 10 s 轮询（页面隐藏时暂停）。
- 顶部 4 个指标卡（2×2 移动端）：
  1. 主机：CPU %、负载、温度、内存条；温度 > 75 ℃ 变黄，> 85 ℃ 变红。
  2. 存储：配额已用/总量、进度条、文件数、回收站占用；> 90% 黄色。
  3. Minecraft：在线/离线徽章、版本、在线/上限、TPS、白名单数；离线或 RCON 降级时显示原因。
  4. 备份：最近拉取时间、大小、状态；> 48 h 红色“备份已过期”。
- 第二行：
  - Minecraft 详情卡：玩家名列表（空态“暂无玩家在线”）、TPS、服务状态、公共地址复制按钮、“管理白名单”链接。
  - 快捷入口卡：AI 工作区（`https://ai.example.com`）、RPi Connect、Minecraft 地址（复制）、云盘（本页）。客户端把 AI 工作区打开在单独窗口，地址是一次性登录链接。
  - 服务状态卡：minecraft/cloudflared/opencode 三个圆点 + 状态文字；`MCBOT_ENABLED=true` 时再加 mcbot，标签为 `mcbot`。
- 第三行：最近活动（审计 8 条，图标 + 动作 + 目标 + 相对时间）。
- 趋势区（四张 CPU/内存/温度/磁盘 SVG 趋势卡）与“备份状态”卡（应用归档/密钥包/世界备份/演练）见 §14。
- 所有卡片有 loading 骨架；错误时卡片内“加载失败 + 重试”。

### 4.3 文件 `/files`

- 页头：“文件”；右侧“上传文件”（主按钮）+ “新建文件夹”。
- 顶部：面包屑（可点击）；搜索框（300 ms 防抖，结果模式显示“搜索结果 / 清除”）；视图切换（列表/网格）。
- 配额条：已用/10 GiB + 回收站占用；接近上限变黄/红。
- 列表列：名称（图标+名称+预览标记）、大小、修改时间、操作（预览/下载/重命名/移动/删除）。
- 网格：文件卡片，图片显示缩略图（`/content?inline=1`），其他显示类型图标。
- 拖拽：整页 dropzone 高亮“松开上传到当前目录”；多文件；上传面板显示每个文件进度（分片上传为整文件总进度）/成功/失败/重试，
  已取消任务可“放弃并清理”（DELETE 服务端分片会话并清除本地断点）。
- 多选分享（复选框/全选/清除 + 浮动操作条）见 §14。
- 新建文件夹：内联输入或 Modal；重命名 Modal；移动 Modal（目录树选择）。
- 删除确认 Modal（目录提示递归）；成功 Toast。
- 空态：图标 + “这个文件夹还是空的” + 上传按钮。
- 预览：
  - 图片：Modal 大图，Esc 关闭，下载按钮。
  - PDF：Modal 内 iframe（`/content?inline=1`），高度 80vh。
  - 文本/Markdown/代码：Modal 内等宽滚动区域；Markdown 用 marked + DOMPurify 渲染；显示“已截断”提示；复制/下载。
  - 不支持：显示文件信息 + 下载按钮。
- 错误：401 跳登录；409/413/429/507 用 Toast 说明。

### 4.4 回收站 `/trash`

- 页头：“回收站”；右侧“清空回收站”（危险按钮 + 二次确认）。
- 列表：名称、原路径、大小、删除时间、操作（恢复/彻底删除）。
- 说明文字：“回收站中的文件仍占用配额；30 天后自动清理。”
- 空态：“回收站是空的”。

### 4.5 Minecraft `/minecraft`（服务器 / Minecraft Bot 双标签）

- 页头与内容由当前标签决定：服务器标签标题“Minecraft”、副标题“服务器只读状态与白名单管理”；Minecraft Bot 标签标题“Minecraft Bot”、副标题“Bot 状态、会话与事件记录”。
- **标签栏**（仅 `/api/version.mcbotEnabled=true` 时显示）：`role=tablist` + 两个 `role=tab` 按钮（“服务器”“Minecraft Bot”），`aria-selected`/`aria-controls`/`tabIndex` 随激活标签变化，面板 `role=tabpanel` 与 `aria-labelledby` 联动；左右方向键循环、Home/End 跳转，焦点随选中移动；`?tab=mcbot` 或 `#mcbot` 深链进入 Minecraft Bot 标签，切回服务器清理由该标签写入的 `?tab=mcbot` 与 `#mcbot`。路由仍是 `/minecraft`。侧栏桌面为“Minecraft”，紧凑为“MC”。
- mcbot 未启用（`mcbotEnabled=false` 或旧服务端不下发）时不渲染标签栏，直接展示服务器内容，页面行为与旧版一致。
- **服务器标签**（原 `/minecraft` 内容）：
  - 顶部状态卡：在线/离线、版本、MOTD、在线人数、TPS、服务状态、公共地址（复制）；RCON 降级时黄色提示。
  - 玩家列表：在线玩家名（头像用首字母圆形）。
  - 白名单管理：输入玩家名 + “添加”；校验 `^[A-Za-z0-9_]{3,16}$`；成功后列表刷新 + Toast；表格列玩家名、添加时间（若可得）、移除按钮（确认）；说明“白名单修改立即生效；不支持启停服务器或任意命令。”
  - 只读提示：本页不提供服务器启停/控制台。
- **mcbot 标签**：见 §17。

### 4.6 活动 `/activity`

- 页头：“活动”；筛选：动作下拉（全部/登录/文件/白名单等）、关键词搜索（动作/目标/IP，300 ms 防抖）、时间范围下拉、清除筛选；
  表格：时间、动作（中文）、目标、IP、详情。
- 分页 50；空态区分“暂无记录”与“无匹配结果（可清除筛选）”；筛选由服务端执行（`action/q/from`）。

### 4.7 设置 `/settings`

- 已登录设备：展示名称、平台、在线与是否为当前设备。可以改名和吊销。吊销当前设备后本机退出。浏览器会话可以查看和吊销；心跳仍要求设备会话。
- 账号：用户名（只读）、修改密码（当前/新/确认）、重新生成恢复码（需密码，结果仅展示一次，提供复制/下载）。
- 会话：当前会话信息；`退出全部会话`（危险确认）。
- 关于：版本、部署环境（Pi 5 / Debian 13）、链接到文档（仓库内路径不可点则显示文本）。
- 安全说明：TOTP、备份含敏感数据、Cloudflare 可见明文。

## 5. 组件与状态

- `Button`（primary/secondary/ghost/danger，loading/disabled）
- `Card`（title/actions/body，loading skeleton）
- `Stat`（label/value/unit/hint/tone）
- `Badge`（success/warning/danger/muted）
- `Modal`（焦点陷阱、Esc、遮罩）
- `Toast`（成功/错误/信息，4 s 自动消失，可手动关闭）
- `ConfirmDialog`
- `EmptyState`
- `ProgressBar`（上传/配额）
- `Table`（移动端卡片化）
- `Skeleton`
- `CopyButton`（复制成功反馈）
- `FileIcon`（按 mime 扩展名）
- `RelativeTime`（“3 分钟前”，title 显示绝对时间）
- 所有异步操作有 loading；按钮提交期间禁用；网络错误统一 Toast。

## 6. 文案与本地化

- 全部中文；技术名词保留英文（TOTP、RCON、TPS、SHA-256、opencode）。
- 语气简洁、陈述式；不卖萌、不感叹号堆叠。
- 时间：`Asia/Shanghai`，绝对时间 `YYYY-MM-DD HH:mm`；相对时间用于列表。
- 空态/错误文案必须给出下一步动作（重试/返回/上传）。

## 7. 可访问性

- 键盘可达；Modal 焦点陷阱；Esc 关闭。
- 对比度 ≥ WCAG AA；焦点环 `outline: 2px solid var(--accent)`。
- 图标按钮有 `aria-label`；表单 label 关联；错误用 `role="alert"`。
- 不用颜色作为唯一状态信号（徽章带文字）。

## 8. 前端工程

- React 19 + TypeScript + Vite；`react-router-dom` 路由；无 UI 框架、无 Tailwind；手写 CSS（tokens + 页面/组件样式）。
- 图标 `lucide-react`；Markdown `marked` + `dompurify`。
- API 客户端：`fetch` + `credentials: 'include'`；自动附带 `X-CSRF-Token`；`401` 统一跳登录；`/api/auth/me` 启动时恢复会话。
- 上传：`XMLHttpRequest` 以获得进度；并发 2；失败可重试。
- 目录结构：
  ```text
  web/src/
    main.tsx  App.tsx  api/client.ts  api/types.ts
    auth/AuthContext.tsx
    components/  pages/  styles/
  ```
- 构建必须通过 `tsc -p web/tsconfig.json` 与 `npm run build`；产物 `web/dist`。
- 不引入运行时外部资源（字体/图标 CDN/图片）。

## 9. 验收（界面）

- 390 px 与 1440 px 下无横向滚动；导航可用。
- 登录两步、错误提示、恢复码可用。
- 上传进度（含分片整文件总进度/放弃并清理）、预览三种类型、搜索、多选分享、回收站恢复可完成。
- Dashboard 数据/降级状态/刷新正常；趋势卡范围切换与空数据降级正常；备份状态卡四类状态可读；白名单增删有反馈。
- 笔记附件上传/删除/插入、版本查看/恢复可用；Activity 关键词/时间范围筛选与 Alerts 筛选分页可用（详见 §14）。
- Bot 页：未启用时配置指引、启用后六分区（概览/配置/目标/投递与发布/角色与记忆/诊断）可键盘切换；AppSecret 不回显；目标含 `allowChat` 与最近入站目标登记；
  发布表单含 TOTP + `PUBLISH` 且仅文本（QQ 单条 ≤2000；超过返回 400 `publish_text_too_long`，不静默截断、不服务端分段）；配置页“检查连接”展示 QQ access_token 自检结果（详见 §15）。
- `/minecraft`：启用 mcbot 时双标签可键盘切换、`?tab=mcbot`/`#mcbot` 深链生效；服务器标签保持原状态/白名单功能；mcbot 面板状态/任务/移动/聊天/事件/历史可用，开始/停止/恢复/发送有二次确认，禁用/不可达/过期/只读分别降级，不展示 Token/地址（详见 §17）。
- 键盘可完成登录、打开弹窗、关闭弹窗。

## 10. 知识库与文件界面

### 知识库 `/knowledge`

- 主导航提供“知识库”；顶部 Tabs“笔记/书签”；搜索框 + 标签筛选 + 置顶/分页。
- 笔记：左侧列表面板，右侧标题 + Markdown 编辑/预览切换 + 标签 + 置顶 + 保存/删除；移动端上下堆叠。
- 书签：卡片/列表；新建/编辑弹窗含 URL/标题/描述/标签/置顶；外链新窗口打开并带 noopener。
- 空态/骨架/错误重试；Markdown 只读预览，禁止 style/script/iframe。

### 文件分享

- Files 行操作“分享”打开 ShareDialog：密码（可选，新建至少 8 位）、有效期（默认 7 天/最长 30 天）、最大下载次数（留空=不限）、备注。
- 支持多文件分享（1–50 个，多选后“分享所选”，展示文件数/总大小），交互见 §14；单文件行内“分享”保留。
- 创建成功只展示一次链接 + 复制按钮；关闭前提示“链接只显示一次”。
- `/shares` 管理页：文件名/条目数、状态、过期/次数、创建时间、吊销；不展示 token。
- `/s/:token` 公开页：独立布局、无登录导航、noindex；文件名/大小/条目数/过期/次数/密码输入/下载；
  多文件时解锁后展示文件清单并逐项下载（不生成 zip）；410 显示具体失效原因，404 显示不存在。
- 下载次数按分享会话计一次（页面标注说明）。

### 手机

- 不提供 PWA 安装、更新提示或离线壳。站点图标保留。
- Files 增加“拍照上传”（`accept=image/* capture=environment`）；390px 无横向滚动。

### 告警

- Dashboard“告警”卡片：当前 active 条件、最近历史、webhook 状态、严重度中文标签。
- 历史状态含 `firing/resolved/unknown/event`：`event` 显示“已记录”并使用中性色调，表示 mcbot 等外部服务的事件记录，**不当作活跃告警**；状态筛选含“已记录”；`mcbot_*` 事件名有中文映射（血量过低/任务失败/断线/箱子已满/防御撤退/告警）。
- 事件带 `deliveries` 时只显示 webhook 一行：完成显示「已送达」；`skipped` 显示「跳过」；`pending` 且 `attempts>0` 显示「待重试」，否则「待投递」；`dead` 显示「投递失败」并附脱敏原因。有投递详情时，`skipped` 不再显示旧的「通知发送失败」。`deliveries` 为 `null` 且存在 `deliveryError` 时仍显示「通知发送失败」。本卡片只读，没有重投按钮。
- Settings“监控告警”：只读阈值/检查间隔/webhook 是否配置/最近评估；“测试 Webhook”按钮（POST /api/alerts/test）。
- 未配置 webhook 时仍显示面板告警，不阻塞。

## 11. 交互细节

- Activity 使用服务端 action 精确筛选/分页；审计动作中文名与真实 action 对齐。
- Files/搜索/Trash 请求可取消，旧响应不会覆盖新目录。
- 上传逐文件取消/超时（15 分钟）/卸载 abort；恢复码弹窗复制/下载前禁止误关。
- 改密/恢复码表单含 TOTP；密码 ≥12；429 显示 `details.retryAfterSec`。
- `/api/version` 元数据驱动域名、回收站天数、上传上限、功能开关与 mcbot 标签/控制显隐（`mcbotEnabled`/`mcbotControlEnabled`）。
- a11y：移动抽屉焦点陷阱、Dropdown 方向键、FormField aria-required、ConfirmDialog describedby、NotFound 标题。
- DSH Web：HTML 原样转发，不注入垫片，也不改写模块脚本。

## 12. 备份与恢复界面

### 备份与恢复

- Dashboard 备份卡：最近拉取、待确认归档、密钥包状态、异常提示与“管理备份”；另有备份状态卡（应用归档/密钥包/世界备份/演练，见 §14）。
- Settings“备份与恢复”：归档列表（模式/时间/大小/SHA 前缀/状态/来源）、刷新、上传（≤100 MiB，TOTP）、校验、恢复入口。
- 恢复向导三步：选择归档/文件 → 校验摘要 → TOTP + typed confirmation（`RESTORE`）→ 结果；执行中锁 Esc/遮罩、失败可重试；仅恢复到新目录，不覆盖。
- 危险操作默认焦点“取消”；TOTP `autocomplete=one-time-code`；390px 卡片化/全屏向导、footer sticky。
- `skippedMissing` 文件在向导中提示并从选择中剔除；恢复结果展示跳过数量。

### 音视频播放

- Files 预览支持原生 `<video controls playsInline preload=metadata>` / `<audio controls>`，`/content?inline=1`；支持 Range/seek。
- 不支持格式/mkv/avi 回退下载；错误区分格式、网络、415/416；不缓存媒体、不做转码、不引入外部播放器。
- 移动端视频 16:9，播放器原生控件；表格/卡片仍可下载。

### DSH Web

- HTML 原样转发。未配置 `DSH_WEB_URL` 时反代仍可指向 OpenCode 回滚地址，应用不因此拒绝启动。

### 分享

- 公开分享不展示“仅自己可见”备注；一次性 URL 创建成功后禁止误关。
- `PUBLIC_APP_SHELL` 默认开启，浏览器仍打开完整界面。关闭且请求主机是应用公网主机时，管理页显示「请使用客户端」；分享链接改为服务端页面，展示文件名、大小和下载链接，需要密码时提交表单。`127.0.0.1`、`localhost` 与 `::1` 仍打开完整界面。生产尚未关闭该开关。

## 13. 大文件分片上传

- `/api/version` 的 `chunkedUploadEnabled/chunkSizeBytes/chunkMaxFileBytes` 驱动前端；未下发时保持单请求上传。
- 文件大小 > `maxUploadBytes`（普通 multipart 上限）且 ≤ 5 GiB 时自动走分片，块默认 8 MiB，每文件独立队列任务。
- 上传面板复用现有进度/取消/重试：显示总进度百分比；断点记录只存 uploadId/已收块号到 localStorage，不缓存文件内容。
- 刷新/断线后同一文件（名称+大小+lastModified+目录）自动查询服务端状态并只补缺块；服务端会话过期则重新 init。
- 取消保留断点供重试；服务端 24h 后清理会话与临时块。390px 面板不横向滚动。

## 14. 可观测性与笔记界面

### 可观测性

- Dashboard 提供“趋势”区：CPU、内存、温度、磁盘四张卡，1h/6h/24h/7d/30d 切换；自定义 SVG 折线/面积图，不引入图表库；60s 轮询，刷新不闪烁。
- 窄屏（≤900px，含 Android）：趋势卡头部纵向排列，范围选择器占满一行；周期按钮不收缩、标签不换行，放不下时横向滑动并隐藏滚动条，确保“1 小时…30 天”文字不被刷新按钮或容器挤压。
- 空数据（刚部署）/采样关闭/接口错误分别显示降级文案与重试；温度不可得显示“—”。
- Activity 支持关键词与时间范围筛选，结果为空给出清除筛选；AlertsCard 支持状态（firing/resolved/unknown）与事件筛选、分页。

### 笔记附件与版本

- 笔记编辑器工具栏增加“附件”按钮与拖拽区；上传显示单项进度/失败重试；成功后插入 Markdown 图片（栅格图）或链接（其它类型）。
- 附件列表显示名称/大小/复制链接/删除；删除需确认，提示其他版本中的引用可能失效。
- 编辑器“历史”按钮打开抽屉：版本时间/标题列表、只读预览、“恢复此版本”（二次确认）；恢复后编辑器内容刷新并提示已保存当前版本快照。
- 移动端附件列表卡片化；上传/恢复期间禁止重复提交。

### 多文件分享

- Files 页支持多选（复选框/全选/清除），选中后浮动操作条显示数量与“分享所选”；单文件行内“分享”保留。
- ShareDialog 支持多文件：展示文件数/总大小；密码/有效期/最大次数/备注沿用；创建成功一次性展示链接。
- Shares 页显示条目数；公开页 `/s/:token` 多文件时为文件清单（名称/大小/逐项下载），密码解锁后展示；仍 noindex、无备注。
- 多文件逐项下载，不提供服务端 zip；下载次数按分享会话计，页面标注说明。

### 备份状态

- Dashboard 与 Settings 备份区增加四类状态：应用归档链（最近拉取/pending/孤儿/已确认）、密钥包、世界备份（最近成功/大小/待拉取/错误）、最近恢复演练（时间/结果/`latestDb` + `schemaVersion` + 世界归档是否校验）。
- 应用归档已 ack 后 PC 可能清理服务端文件：状态仍显示“已确认”，Backups 页额外显示“副本已清理”，恢复按钮禁用并提示“服务端副本已清理”；不得把这类已确认归档误报为“文件缺失”。
- 世界备份/PC 拉取“保留份数”按脚本的 `keptCount` 展示（`kept` 是归档名数组）；文案注明世界备份的 `kept` 是“上次运行保留，PC 拉取确认后远端会删除”，不代表 Pi 当前副本数。
- 演练时间超过 35 天或 schemaVersion 与当前部署不一致时显示 warning 并提示重跑 `drill.ps1 -ExpectedSchemaVersion <当前>`；不伪造 DB 完整性。
- 状态缺失显示 unknown/未运行；异常（超期、失败、pending 堆积）红色/黄色提示并给出下一步；不展示归档路径。
- 390px 状态卡纵向堆叠，不横向滚动。

- 单请求仍受 100 MiB/Cloudflare 代理限制；分片块 8 MiB 远低于限制，5 GiB 文件约 640 块。

## 15. 机器人页

Workbench 不再提供机器人管理页。侧栏没有“机器人”，路由 `/chatbots` 与 `/bots` 不存在。生产 QQ 由 DSH 管理。

## 16. 备份加密/异地副本与审计界面

### 备份与恢复（Settings → 备份与恢复）

- **备份加密状态卡**（只读）：标题“备份加密”，状态徽标（已启用/未启用/公钥缺失）；展示 `age` 公钥是否就绪；
  说明“加密归档文件名 `*.tar.gz.age`；Web 不持私钥，加密归档只能在 PC 用离线私钥校验/恢复”。公钥缺失且开关开启时显示 danger：
  “公钥缺失，prepare 会失败关闭”。不展示任何密钥/私钥内容。
- **异地副本状态卡**（只读）：标题“异地副本”；展示最近同步时间（相对时间）、目标别名（无则“未配置”，**不展示远端真实路径/URL/凭据**）、
  本次上传/跳过/失败数量与字节数、远端保留份数、`plaintextSkipped>0` 安全信号（只展示为异常说明）；未配置时为空态“未配置（默认关闭）”。
- **长任务**：prepare/verify/归档浏览/恢复计划/执行使用显式超时（prepare 3300s，其余 600s）；提交中禁用按钮并显示“服务端可能仍在执行，
  请勿重复提交”；超时 Toast 明确“服务端可能仍在执行，刷新后查看 pending/计划状态”，不提示“失败可重试”造成重复任务。
- **prepare 结果警告**：展示 `warnings[]` 与 `skippedMissing[]`（不完整备份不得显示为完全成功）；缺失文件说明“已跳过、游标不越过、
  下次 prepare 自动补入”。加密归档另展示 `encrypted/archiveFormat/metaName` 与“明文哈希仅在 sidecar，PC 校验”。
- **恢复计划持久化**：恢复计划 `planId` 存本地（`restore-plan-store`），刷新/断网后恢复向导可继续查看计划与结果并轮询；
  计划过期/已完成/失败有明确状态；`skippedMissing` 在计划与结果中展示，非空时提示“非完整恢复”。
- **加密归档边界**：列表对 `.age` 显示“加密归档（Web 不可校验/恢复）”徽标；校验/浏览/恢复/导入按钮禁用并提示 PC 流程；
  收到 `409 archive_encrypted` 时显示说明而非通用错误；恢复目标选择自动跳过加密归档。
- **分片上传断点**：`GET /api/uploads/:id` 命中 `status=completed` 时直接消费 `fileId` 结束，不重新 init/重传整文件。
- 拼接返回 `chunks_missing` 时显示缺失或校验失败。重试刷新服务端会话并上传缺片。
- **导入结果**：展示 `warnings[]`（如缺少字段/兼容提示），成功 Toast 不掩盖警告。

### 通用与设置

- **审计动作中文映射**：包含 `backup_reauth_failed`、`chatbot.ai.send`（`partialTurn` 文本）、备份加密/异地相关动作的展示文案；未知动作按原文等宽显示。
- **设置告警**：告警配置展示 `offsiteMaxAgeHours`（异地副本超期，小时，0 表示关闭）与世界备份/演练阈值；未配置异地副本时不误导为异常。
- **`/api/version` 与元数据**：`MetaContext` 消费 `schemaVersion/backupArchiveEncryption/backupAgeRecipientConfigured/backupOffsiteStatusConfigured/audit`；
  `/api/version` 失败重试一次并回退默认值；`audit.failureCount>0` 时可展示提示“审计写入存在失败（诊断）”，不展示明细。
- **导航与错误**：hash 路由异常/未知页面回退首页并提示；轮询失败静默保留上次数据并提供手动刷新；`ConfirmDialog` 默认焦点在“取消”，
  危险操作需二次确认；错误码 `archive_encrypted`、`backup_busy`、`restore_busy`、`plan_expired` 有专门中文文案。
- **响应式**：加密/异地状态卡与警告条在 390 px 纵向堆叠、不横向滚动；表格使用既有滚动容器。

### 前端工程

- 样式集中在 `web/src/styles/v07.css`（在 `main.tsx` 引入），不引入第三方组件库；测试覆盖长任务超时、恢复持久化、
  加密/异地状态卡、prepare 警告、断点 `fileId`、`archive_encrypted` 文案与 MetaContext 降级。

## 17. Minecraft Bot 面板（`/minecraft?tab=mcbot`）

Minecraft Bot 面板是 `/minecraft` 的第二个标签页。标签文字是“Minecraft Bot”。页面只有三块：Bot 状态、会话、事件记录。状态来自 `GET /api/mcbot/status`（5s 轮询，页面隐藏时暂停），会话来自 `GET /api/mcbot/chat`。面板写操作只有在线模式、发送对话、停止和急停。仅当 `/api/version.mcbotEnabled=true` 时显示入口。`controlReady` 要求启用、可达且 `controlEnabled=true`；否则对话输入、发送和急停禁用。状态快照先经 `safemcbotStatus` 归一化，缺失嵌套段显示“—”而不是整页崩溃；面板轮询使用请求序号 + AbortController，旧响应不会覆盖新响应。

### 入口与布局

- 标签栏与深链见 §4.5。内容自上而下：全局状态提示条 → Bot 状态（含在线模式与急停）→ 会话 → 事件记录。
- 面板不提供任务开始、目标草案、目标读写、自主启动、移动、游戏内发言或历史表格。这些动作由对话里的模型决定，或由游戏内口令发起。
- 在线模式卡标题“在线模式”，说明“只决定 Bot 何时保持在线。任务、移动和目标由管理员对话决定。”展示 `auto/always/off`。切换前确认，标题“切换在线模式”。只读时禁用“常驻在线”。
- 全局提示条可以同时出现：
  - 等待首次轮询：`notice-muted`“正在等待 mcbot 首次轮询结果；轮询完成前状态可能为空，控制操作暂不可用。”
  - 不可达：`notice-warning`“无法连接 mcbot：<中文错误>。当前显示上次成功轮询的缓存数据，控制操作不可用。”
  - 数据过期：`notice-warning`“mcbot 数据已过期（上次成功轮询 …），请检查 mcbot 进程；新数据恢复前请勿依赖当前状态。”
  - **事件缺口**：`eventGap` 非空时 `notice-warning`“mcbot 事件缺口：启动 <bootId> 缺少序号 <fromSeq>–<toSeq>（发现于 <相对时间>）。下方仍显示当前 Bot 状态。”
  - **部分失败**：`notice-warning`“mcbot 状态可达，但事件流/告警游标异常：<中文错误>；事件流可能停止更新，控制仍可尝试。”`reachable=true` 且 `error≠null` 时必须可见。
  - 控制未启用：`notice-muted`“mcbot 控制未启用（服务端未配置 MCBOT_CONTROL_TOKEN）：对话和急停已禁用。”不展示 Token。
- 集成禁用（`mcbotEnabled=false`）：只显示 `notice-muted` 说明“mcbot 集成未启用（服务端 MCBOT_ENABLED=false）。启用后需要配置 mcbot 地址与 Token 并重启应用；本页不展示任何 Token、内部地址或凭据。”+“重新检测”按钮；不渲染任何数据/控制区，也不渲染急停或管理员对话。

### 状态卡

- 标题“Bot 状态”，描述“连接、血量、饥饿、任务、TPS 与版本。在线模式和急停也在这里。”状态每 5 秒轮询；页面隐藏时暂停请求，刷新失败时保留上次成功的数据。
- 头部操作：可达/不可达徽章（带圆点）、控制可用/控制未启用徽章、刷新按钮（`aria-label`、loading 态）。
- 刷新失败时卡片内 `InlineError`“<错误>（显示上次成功获取的数据）”+ 重试；无快照时 `EmptyState`“暂无 mcbot 状态快照”。
- 状态栅格（缺失字段显示“—”）：运行状态（中文徽章：空闲（动态下线）/连接中/已连接/重连等待/冷却中）、Minecraft 连接（已连接（用户名）/未连接）、服务器在线/上限（服务器不可达时提示）、TPS（1m/5m/15m，RCON 不可用时提示）、mcbot 血量/饥饿（维度作 hint）、AI 队列（排队/处理中，失败次数与最近延迟；AI 关闭时“—”）、记忆（玩家数/轮数）、mcbot 版本 + 契约版本、运行时长、白名单数量（上游 lastError 作 hint）、告警联动（已启用/未启用）、事件流条数（“内存环”）。
- 附加警告：上次 Minecraft 断线（相对时间 + 原因 + 累计重连次数）、AI 最近错误（文本）。
- 脚注：上次轮询相对时间（`lastPollAt`）；契约版本是数字且不是 2 时提示“mcbot 契约不是 v2”；`contractVersion` 非 number（缺失/`undefined`）时显示“—”，不显示 `vundefined`。
- 寻路 Fact：有 `navigation` 时显示状态/来源/最近兜底；`lastFallbackReason` 非空时在其下显示“兜底原因：”加该短文本。旧版无 `navigation` 时不显示这一格。

### 自主会话事实

- 状态卡在有 `autonomy` 时增加只读事实“自主会话”，显示状态中文。没有启动或停止按钮。事件流里的 `autonomy` 类型仍可筛选，正文只展示 action/state/原因摘要，不展示模型 prompt。

### 管理员对话

- 卡片标题“会话”。输入说明“用一句话说明要做什么。模型按这句话决定是否使用现有任务和规划工具。”
- 记录按时间展示完整步骤：用户文本、助手文本、工具名与成功或失败、目标或待办的动作和短标题。不展示工具参数、令牌、提示词或世界记忆正文。空态“还没有会话。”输入说明见卡片描述。`aria-label` 为“会话内容”。
- `textarea` `rows=3`、`maxLength=2000`、`aria-label`“管理员对话”。允许 ASCII `/`。本地拒绝 C0，提示“内容不能包含控制字符”。空内容提示“请输入要说的话”。
- 发送调用 `POST /api/mcbot/chat`，成功后清空输入并重新读取对话。进行中时输入和发送禁用。`controlReady` 时，回合 `pending` 每 1 秒轮询 `GET /api/mcbot/chat`，否则每 5 秒；页面隐藏时暂停。
- 急停按钮“急停”。确认标题“急停”，正文“确定停止当前任务、自主会话和管理员对话？”，说明“空闲时也算成功。已经发生的世界动作不会回滚。”确认按钮“急停”，取消“取消”。成功 Toast“已急停”；部分失败 Toast“急停未全部完成：”加失败腿名。急停不调用模型。
- 脚注“立即停止任务、自主会话和这次对话，不经过模型。”不展示 Token、上游地址或 prompt。

### 事件流

- 卡片标题“事件记录”，描述“mcbot 内存事件环的最近事件（按时间倒序，最多显示 100 条）。”；右上角条数徽章。
- 旧版 mcbot（`eventsSupported=false`）显示 warning：“mcbot 需升级到 v0.6.0 才能显示事件记录（当前 mcbot 未提供 /events/recent 或事件契约）。”
- 类型筛选按钮组（全部/聊天/任务/状态/移动/告警/自主，`aria-pressed`）；列表项 = 类型徽章（聊天 accent、任务 info、状态 muted、移动 info、告警 warning）+ 相对时间 + 纯文本正文：聊天事件显示“用户名：内容”或“mcbot：内容”，其余显示结构化摘要（任务动作/状态、连接状态/其他玩家、移动动作/目标/状态/错误、告警类型/级别/内容）；`data` 一律视为不可信 unknown，不使用 HTML 注入。
- 空态区分“暂无事件”与“暂无「<类型>」事件”；脚注说明事件来自 mcbot 内存环、重启清空、本页不保存历史。

### 确认、降级与隐私

- 二次确认：切换在线模式和急停使用统一 `ConfirmDialog`（危险操作默认焦点“取消”，加载中禁止重复提交）。发送管理员对话不再二次确认。
- 降级矩阵：禁用 → 仅说明，`eventGap` 为 null；首次加载失败 → 卡片错误 + 重试；等待首次轮询 → 提示且控制禁用；不可达 → 缓存数据 + 警告 + 控制禁用；stale → 警告，时间用 `lastSuccessAt`，null 时为“尚无成功轮询”（不用失败轮询的 `lastPollAt`）；**事件缺口 → 可见缺口区间，状态卡仍显示**；**可达但事件/游标失败 → 可见部分失败警告，对话在控制可用时仍可尝试**；控制未启用 → 对话和急停禁用。
- 隐私与安全：不展示 mcbot URL/Token/内部路径/记忆正文/模型 prompt/工具参数；事件与对话纯文本渲染；对话和急停在控制未就绪时禁用。管理员对话允许 `/`。mcbot 本机游戏发言仍拒绝任意 ASCII `/` 与 C0。
- 历史错误码/错误提示使用中文映射（含 `mcbot_cursor_failed`/`mcbot_not_found`/`mcbot_history_disabled`），未知码原样显示；查表使用 own-property，不命中原型链。
- 响应式/可访问性：390 px 下状态栅格与双列卡片纵向堆叠、不横向滚动；标签键盘可操作；图标按钮有 `aria-label`；表单 label 关联；错误 `role="alert"`；不引入第三方组件库。
