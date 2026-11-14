# Minecraft Bot

游戏内人格名是 Lofii。服务只监听 `127.0.0.1:3010`，跑在 Paper 旁边，用 mineflayer 以离线账号登录。

当前版本：**v1.2.3**。本机契约 v2。发言使用控制 Token。生产自主工具由 DSH 插件经私有 Unix socket 调用，mcbot 自己校验并执行。配置该 socket 后 `/autonomy/mcp` 返回 404。OpenCode 原生 MCP 只属于离线回滚路径。

管理员对话决定是否行动。主人没有要求行动时只回答。世界动作只用下面 13 个工具，任务名只能来自白名单。急停不经过模型。应用面板不再直接开始任务、写目标、开始自主会话、移动或向游戏发言。

## 工具与任务

权限前缀是 `mcbot_autonomy_*`。OpenCode 回滚路径的会话使用 deny-all，再允许这一前缀。

工具：`start_task`、`stop_task`、`go_home`、`deposit`、`task_status`、`observe`、`inspect_chest`、`eat`、`equip`、`finish`、`memory_read`、`memory_write`、`memory_forget`。

任务：`fishing`、`farming`、`woodcutting`、`mining`、`forest`、`sleep`、`patrol`、`guard`、`escort`、`explore`、`clearing`。

`observe` 只读环境。`inspect_chest` 只在空闲时短距打开半径内的允许容器，不取物、不传送、不破块。`eat` 与 `equip` 只在空闲时使用背包里的食物、护甲或工具。三个记忆工具计入既有工具预算，不启动任务。

世界记忆与聊天记忆分开。分类只有 `place`、`resource`、`food`、`danger`、`route`、`note`。主世界、下界与末地分文件保存，权限 0600。提示词只带当前维度、分类计数和最近 8 个键。断线时记忆工具返回 `memory_dimension_unavailable`，不回退读取主世界。

挖矿和天然林先读 `resource` 记忆坐标，失效后再做半径扫描。扫描到并复核过的资源点会少量写回。行走不受 `SAFE_*` 矩形限制。寻路失败就停下。血量降到 `CRITICAL_HEALTH` 时只传送回基地。

## 提示词上下文

普通聊天使用的提示词上下文段由 `READ_ONLY_AI_TOOL_NAMES` 列出，名称是 `status`、`inventory`、`task_status`。这些名称只拼进提示词，不是可执行工具。普通聊天不因此执行游戏动作。

## 现行行为

- 只有被 Lofii 点名时才聊天。固定短语优先。模糊的任务语句先做意图分类，不能直接执行任意动作。
- 在线模式是 `auto`、`always` 或 `off`，写在 `/var/lib/mcbot/presence.json`。任务、队列、待恢复或自主会话运行中切到 `off` 会返回 409。
- 任务队列是一个活动任务加最多 3 个排队，单项上限 60 分钟。状态写盘。服务重启后变成 `pending_resume`，10 分钟内由面板确认才继续。
- 任务中的被动防御只处理白名单敌对生物。有剑或斧就用最好的一把，没有就用拳头。不近战苦力怕、末影人和玩家。低血、低饥饿或敌人过多时撤退。
- 饥饿时先吃背包，再捡近处掉落，然后去食物箱。仍然挨饿且空闲时排队种田，下一轮改排队钓鱼。
- `clearing` 只在安全区内按既有敌对生物白名单清怪，不追出安全区。
- 梯子和藤蔓可以上下。木门、栅栏门和木活板门由执行器打开。铁门和铁活板门挡住。pathfinder 不挖掘、不跑酷、不开门。
- 寻路顺序是 pathfinder、确定性 A*、受控执行、路点建议，然后才是停止或回基地。AI 路点不直接控制移动。`PATH_AI_ENABLED=false` 可单独关闭寻路 AI。
- 寻路兜底进入既有重决策：30 秒去重，每会话最多 6 次。
- 空闲时默认可自动进食、换装和补货。多步目标保存在本地 `goals.db`，创建后不自动开始，重启后保持暂停。
- 管理接口只用读 Token，RCON 只允许 `tps`、`list`、`whitelist list`、`time`。
- 读 Token 与控制 Token 分离。游戏发言 `/say` 拒绝 ASCII `/` 与 C0。管理员对话允许 `/`，因为它不进入游戏聊天。
- 事件在内存 ring 中。同一启动周期的序号空洞由 Workbench 记入 `eventGap`。聊天正文不进应用数据库。

## 约束

- 不做 PvP、建筑、踢人、封禁或备份触发。不跨维度，不放置新床，不挖石头隧道。
- 外发聊天经过清洗，行首 `/` 换成全角，避免变成 OP 命令。
- 内部传送只由移动和任务代码用固定坐标或已加载的玩家生成。玩家实体未加载时不按名字传送。
- 审计只记元数据，不记聊天正文、Token、提示词或完整容器内容。
- HTTP 只在回环地址提供，不进入 Cloudflare 或 nftables 的对外规则。

环境键、路径参数和错误码见 [API](API.md) 的 Minecraft Bot 本机契约。部署见 [DEPLOY](DEPLOY.md)。

