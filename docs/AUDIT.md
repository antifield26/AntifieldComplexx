# 审计残余

已关闭的处置见 [CHANGELOG](../CHANGELOG.md)。下文只保留仍然成立的残余，以及现行声明矩阵。

## 仍然成立的残余

- 服务端是单进程。限流计数在内存中，重启清零。小时维护任务同步执行，可能短暂挡住请求。
- SQLite 使用 `synchronous=NORMAL`，突然断电时最后若干毫秒写入没有保证。
- Cloudflare 终止 TLS，边缘可见明文。scrypt 参数保持 N=2^15。
- 真实 QQ、模型与 Cloudflare 的限流、签名漂移和故障只在隔离候选里验证，不在生产上制造这些条件。
- 物理孤儿只回收超期、数据库无行、且符合 id 形状的文件。
- 5 格垂直墙在禁止挖掘和放置时没有规范路径，只能绕行、停止或按既有规则回基地。
- `inspect_chest` 的实机路径没有单独触发，由离线测试覆盖。
- 插件页的生产安装与列表读取尚未观察，见 [BACKLOG](BACKLOG.md)。
- 预部署数据库快照保持明文 0600，供同 schema 回滚使用。私钥丢失后加密归档无法解密。

## 声明矩阵

自动检查是 `scripts/check-mcbot-claims.mjs`。矩阵以当前代码为准。

| 文档声明 | 代码 | 状态 |
|---|---|---|
| 自主工具 13 个，权限前缀 `mcbot_autonomy_` | `apps/mcbot/src/autonomy/tools.ts` 的 `AUTONOMY_RAW_TOOLS` | 一致 |
| 任务白名单 11 个，含 `clearing` | `AUTONOMY_TASK_NAMES` | 一致 |
| 提示词上下文段 `READ_ONLY_AI_TOOL_NAMES` | `apps/mcbot/src/ai/tools.ts` | 一致 |
| 环境键与 `PATH_*` 九键同时出现在 env 模板、bootstrap 与 API | `apps/mcbot/deploy/env.example`、`bootstrap-env.sh`、`docs/API.md` | 一致 |
| 生产自主工具经 DSH 私有 Unix socket 调用，配置该 socket 后 `/autonomy/mcp` 返回 404 | `apps/mcbot` 运行时配置 | 一致 |
| 应用面板的行动写入口返回 409，急停不经过模型 | Workbench mcbot 路由 | 一致 |

