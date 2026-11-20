# Minecraft Bot

游戏内人格名是 Lofii。服务只监听 `127.0.0.1:3010`，跑在本机 Fabric 26.1.2 旁边，用 mineflayer 以离线账号登录。

当前版本：**v1.3.0**。本机契约 v2。发言使用控制 Token。生产自主工具由 DSH 插件经私有 Unix socket 调用，mcbot 自己校验并执行。配置该 socket 后 `/autonomy/mcp` 返回 404。自主会话与管理员对话不回退到 OpenCode。

配置的主人在游戏内点名 Lofii 交代自然语言任务，也可使用 Workbench 管理员会话。世界动作只使用下述 14 个工具，停止与急停走本地控制。首个 `COMMAND_ALLOWLIST` 项是生存协作的主人。

## 工具与任务

权限前缀是 `mcbot_autonomy_*`。生产由 DSH 插件经私有 Unix socket 调用这些工具。没有该 socket 时，自主会话和管理员对话不可用。

工具：`expedition`、`start_task`、`stop_task`、`go_home`、`deposit`、`task_status`、`observe`、`inspect_chest`、`eat`、`equip`、`finish`、`memory_read`、`memory_write`、`memory_forget`。

生存协作用 `expedition` 登记物品与数量，再选择已加载区块内的资源、工作站和主人指定的共享箱。主人可站在唯一的共享箱旁，让 Lofii 记住该箱。交付以主人拾取证据为准。有限的结构查询、自身传送与普通物资生成由固定模板执行。生成须在 60 秒内由主人回复「确认 编号」，结果无法核对时由主人核对后点名告知「我已核对物品」。

任务：`fishing`、`farming`、`woodcutting`、`mining`、`forest`、`sleep`、`patrol`、`guard`、`escort`、`explore`、`clearing`。

`observe` 只读环境。`inspect_chest` 只在空闲时短距打开半径内的允许容器，不取物、不传送、不破块。`eat` 与 `equip` 只在空闲时使用背包里的食物、护甲或工具。三个记忆工具计入既有工具预算，不启动任务。

世界记忆与聊天记忆分开。分类只有 `place`、`resource`、`food`、`danger`、`route`、`note`。按 `MC_WORLD_ID` 和维度分文件保存，权限 0600。更换存档时配置独立标识。断线时记忆工具返回 `memory_dimension_unavailable`。

挖矿和天然林先读 `resource` 记忆坐标，失效后再做半径扫描。扫描到并复核过的资源点会少量写回。行走不受 `SAFE_*` 矩形限制。寻路失败就停下。血量降到 `CRITICAL_HEALTH` 时只传送回基地。基地坐标必须整组填写；全部省略表示没有基地，不再使用已归档世界的坐标，也不因此传送、补货或执行依赖基地的任务。聊天记忆按 version 2 保存，包含摘要和摘要后的轮次。

## 提示词上下文

普通聊天使用的提示词上下文段由 `READ_ONLY_AI_TOOL_NAMES` 列出，名称是 `status`、`inventory`、`task_status`。这些名称只拼进提示词，不是可执行工具。普通聊天不因此执行游戏动作。

## 现行行为

- 主人点名后进入任务会话；许可编号和限时澄清可接话。关闭主动寒暄。
- 在线模式是 `auto`、`always` 或 `off`，写在 `/var/lib/mcbot/presence.json`。任务、队列、待恢复或自主会话运行中切到 `off` 会返回 409。
- 任务队列是一个活动任务加最多 3 个排队，单项上限 60 分钟。状态写盘。服务重启后变成 `pending_resume`。Workbench 面板不提供恢复按钮。恢复走 mcbot 本机控制入口或游戏内口令。
- 任务中的被动防御只处理白名单敌对生物。有剑或斧就用最好的一把，没有就用拳头。不近战苦力怕、末影人和玩家。低血、低饥饿或敌人过多时撤退。
- 饥饿时先吃背包，再捡近处掉落，然后去食物箱。仍然挨饿且空闲时排队种田，下一轮改排队钓鱼。
- `clearing` 只在安全区内按既有敌对生物白名单清怪，不追出安全区。
- 梯子和藤蔓可以上下。木门、栅栏门和木活板门由执行器打开。铁门和铁活板门挡住。pathfinder 不挖掘、不跑酷、不开门。
- 寻路顺序是 pathfinder、确定性 A*、受控执行、路点建议，然后才是停止或回基地。AI 路点不直接控制移动。`PATH_AI_ENABLED=false` 可单独关闭寻路 AI。
- 寻路兜底进入既有重决策：30 秒去重，每会话最多 6 次。
- 空闲时默认可自动进食、换装和补货。多步目标保存在本地 `goals.db`，创建后不自动开始，重启后保持暂停。
- 管理接口只用读 Token，RCON 只允许 `tick query`、`list`、`whitelist list`、`time query daytime`。
- 读 Token 与控制 Token 分离。游戏发言 `/say` 拒绝 ASCII `/` 与 C0。管理员对话允许 `/`，因为它不进入游戏聊天。
- 事件在内存 ring 中。同一启动周期的序号空洞由 Workbench 记入 `eventGap`。聊天正文不进应用数据库。
- 管理员对话在内存里保留最多 80 步：用户文本、助手文本、工具名与成败、目标或待办的动作和不超过 120 字的标题。不记录工具参数、令牌、提示词或世界记忆正文。急停清空这些步骤。`GET /admin/chat` 与 Workbench `GET /api/mcbot/chat` 一并返回。

## 约束

- 不做 PvP、建筑、踢人、封禁或备份触发。不跨维度，不放置新床，不挖石头隧道。
- 外发聊天经过清洗，行首 `/` 换成全角，避免变成 OP 命令。
- 内部传送只由移动和任务代码用固定坐标或已加载的玩家生成。玩家实体未加载时不按名字传送。
- 审计只记元数据，不记聊天正文、Token、提示词或完整容器内容。
- HTTP 只在回环地址提供，不进入 Cloudflare 或 nftables 的对外规则。

环境键、路径参数和错误码见 [API](API.md) 的 Minecraft Bot 本机契约。部署见 [DEPLOY](DEPLOY.md)。
