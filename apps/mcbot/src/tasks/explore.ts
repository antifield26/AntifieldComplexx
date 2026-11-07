import { isExpired, requireBot, TaskError, TaskStopError, type TaskContext } from './types.ts'

/**
 * 航点探索：按 EXPLORE_WAYPOINTS 顺序移动并观察，不挖方块。
 * 航点由配置校验名称、数量和坐标范围。
 */
export async function runExplore (ctx: TaskContext): Promise<void> {
  const bot = requireBot(ctx)
  const { config, movement } = ctx
  const waypoints = config.exploreWaypoints
  if (waypoints.length === 0) {
    throw new TaskError('没有配置探索航点（EXPLORE_WAYPOINTS）')
  }
  for (const waypoint of waypoints) {
    if (isExpired(ctx)) throw new TaskStopError('任务时间到了')
    if (ctx.signal.aborted) throw new TaskStopError()
    await ctx.defend()
    await movement.goNearPoint(waypoint.x, waypoint.y, waypoint.z, 3, 20000, true)
    ctx.updateProgress({ exploreWaypoints: ctx.progress.exploreWaypoints + 1 })
    ctx.logger.info('explore: waypoint reached', {
      name: waypoint.name,
      total: ctx.progress.exploreWaypoints
    })
    await ctx.defend()
    if (!bot.entity) throw new TaskStopError('连接断开')
  }
}
