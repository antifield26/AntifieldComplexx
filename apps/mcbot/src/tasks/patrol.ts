import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import { requireBot, TaskStopError, type TaskContext } from './types.ts'
import { safeSpotNear } from './navigation.ts'

/** 绕家的四个方向点。半径不超过 16，也不超过扫描半径。 */
export function patrolCorners (config: Config): Vec3[] {
  const radius = Math.min(16, config.scanRadius)
  const { x, y, z } = config.home
  return [
    new Vec3(x + radius, y, z),
    new Vec3(x, y, z + radius),
    new Vec3(x - radius, y, z),
    new Vec3(x, y, z - radius)
  ]
}

/**
 * 绕家走一圈。不追怪；路上的敌对生物仍由被动防御处理。
 */
export async function runPatrol (ctx: TaskContext): Promise<void> {
  const bot: Bot = requireBot(ctx)
  const startedAt = Date.now()
  const corners = patrolCorners(ctx.config)
  for (const corner of corners) {
    if (ctx.signal.aborted) throw new TaskStopError()
    await ctx.defend()
    if (Date.now() - startedAt > ctx.config.patrol.maxMinutes * 60_000) return
    const spot = safeSpotNear(bot, ctx.config, corner, 32)
    if (!spot) {
      ctx.logger.warn('patrol: no safe spot near corner', {
        corner: `${corner.x},${corner.z}`
      })
      continue
    }
    const before = bot.entity?.position ?? null
    try {
      await ctx.movement.goNearPoint(spot.x, spot.y, spot.z, 3, 20000, true)
    } catch (error) {
      ctx.logger.warn('patrol: waypoint unreachable', {
        corner: `${corner.x},${corner.z}`,
        error: error instanceof Error ? error.message : String(error)
      })
      continue
    }
    const after = bot.entity?.position ?? null
    const distance = before && after ? before.distanceTo(after) : 0
    ctx.updateProgress({
      patrolWaypoints: ctx.progress.patrolWaypoints + 1,
      patrolDistance: ctx.progress.patrolDistance + distance
    })
    await ctx.defend()
  }
}
