/** 露天采矿只处理配置内可达矿物，观察记忆按当前维度保存；不扩大挖掘和移动边界。 */
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import { surveyRing } from './navigation.ts'
import { depositProduce } from './deposit.ts'
import { equipItem } from './inventory.ts'
import { isExpired, requireBot, sleep, TaskError, TaskStopError, type TaskContext } from './types.ts'
import { readResourceMemory, rememberedOreTargets, rememberedProbes, rememberObservedResources } from './memory-points.ts'
import { playerNear, scanExposedOres, type OreTarget } from './resources.ts'

function freshPickaxe (bot: Bot): ReturnType<Bot['inventory']['items']>[number] | null {
  return bot.inventory.items()
    .filter(item => item.name === 'iron_pickaxe')
    .sort((a, b) => ((b.maxDurability ?? 0) - (b.durabilityUsed ?? 0)) - ((a.maxDurability ?? 0) - (a.durabilityUsed ?? 0)))
    .find(item => ((item.maxDurability ?? 0) - (item.durabilityUsed ?? 0)) > 10) ?? null
}

async function moveToOre (ctx: TaskContext, target: Vec3): Promise<void> {
  if (ctx.signal.aborted) throw new TaskStopError()
  await ctx.movement.goNearPoint(target.x + 0.5, target.y + 0.5, target.z + 0.5, 3, 15000, true)
}

async function mineOre (ctx: TaskContext, bot: Bot, target: OreTarget): Promise<boolean> {
  const pickaxe = freshPickaxe(bot)
  if (!pickaxe) throw new TaskError('铁镐快坏了，箱子里没有备用镐')
  await equipItem(bot, pickaxe)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (isExpired(ctx)) throw new TaskStopError('任务时间到了')
    await ctx.defend()
    try {
      await moveToOre(ctx, target.position)
      const block = bot.blockAt(target.position, false)
      if (!block || block.name !== target.name) return false
      await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true)
      if (ctx.signal.aborted) throw new TaskStopError()
      await bot.dig(block)
      return true
    } catch (error) {
      if (error instanceof TaskStopError) throw error
      ctx.logger.warn('mining: dig failed', {
        position: `${target.position.x},${target.position.y},${target.position.z}`,
        error: error instanceof Error ? error.message : String(error)
      })
      await sleep(300, ctx.signal)
    }
  }
  return false
}

/**
 * 只挖已经露出空气的煤、铁、铜。先用 resource 记忆里、两倍扫描半径内的坐标；
 * 方块仍是可挖的矿才采用。坐标未加载时先走近再确认。都不成立时才按半径扫描。
 * 不挖隧道，不调用模型。
 */
export async function runMining (ctx: TaskContext): Promise<void> {
  const bot = requireBot(ctx)
  const config = ctx.config
  const startedAt = Date.now()
  let lastDeposit = Date.now()
  let cells = surveyCells(config, bot)
  let cellIndex = 0
  const skipped = new Set<string>()
  const triedProbes = new Set<string>()
  let targets = rememberOres(bot, config, skipped)

  while (!isExpired(ctx)) {
    if (ctx.signal.aborted) throw new TaskStopError()
    if (Date.now() - startedAt > config.mining.maxMinutes * 60_000) {
      ctx.logger.info('mining: time limit reached', { ores: ctx.progress.oresMined })
      return
    }
    if (ctx.progress.oresMined >= config.mining.maxOres) return
    await ctx.defend()

    if (targets.length === 0) targets = rememberOres(bot, config, skipped)
    if (targets.length === 0) {
      const probe = nextOreProbe(bot, config, skipped, triedProbes)
      if (probe) {
        const key = pointKey(probe)
        triedProbes.add(key)
        try {
          await ctx.movement.goNearPoint(probe.x + 0.5, probe.y, probe.z + 0.5, 6, 15000, true)
        } catch (error) {
          ctx.logger.warn('mining: remembered move failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
        targets = rememberOres(bot, config, skipped)
        if (targets.length > 0) continue
      }
    }
    if (targets.length === 0) {
      if (cellIndex >= cells.length) {
        ctx.logger.info('mining: no exposed surface ore found')
        return
      }
      const cell = cells[cellIndex]
      cellIndex += 1
      if (!cell) return
      try {
        await ctx.movement.goNearPoint(cell.x, cell.y, cell.z, 6, 15000, true)
      } catch (error) {
        ctx.logger.warn('mining: survey move failed', {
          cell: `${cell.x},${cell.y},${cell.z}`,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      targets = scanExposedOres(bot, config).filter(target => !skipped.has(pointKey(target.position)))
      if (!ctx.signal.aborted) {
        await rememberObservedResources(bot, config, 'ore', targets)
          .catch(() => ctx.logger.warn('资源记忆保存失败，继续使用已观察的采集目标'))
      }
      continue
    }

    const target = targets.shift()
    if (!target) continue
    if (playerNear(bot, target.position, 8)) {
      skipped.add(pointKey(target.position))
      continue
    }

    const mined = await mineOre(ctx, bot, target)
    if (!mined) {
      skipped.add(pointKey(target.position))
      continue
    }
    const next = {
      oresMined: ctx.progress.oresMined + 1,
      coalMined: ctx.progress.coalMined + (target.kind === 'coal' ? 1 : 0),
      ironMined: ctx.progress.ironMined + (target.kind === 'iron' ? 1 : 0),
      copperMined: ctx.progress.copperMined + (target.kind === 'copper' ? 1 : 0)
    }
    ctx.updateProgress(next)
    ctx.logger.info('mining: ore mined', { block: target.name, total: next.oresMined })

    if (ctx.progress.oresMined % 16 === 0 || Date.now() - lastDeposit >= 300_000) {
      try {
        await depositProduce(ctx)
        lastDeposit = Date.now()
      } catch (error) {
        if (error instanceof TaskStopError) throw error
        ctx.logger.warn('mining: deposit failed', { error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  throw new TaskStopError('任务时间到了')
}

function pointKey (position: Vec3): string {
  return `${position.x},${position.y},${position.z}`
}

function rememberOres (bot: Bot, config: Config, skipped: Set<string>): OreTarget[] {
  return rememberedOreTargets(bot, config, readResourceMemory(config.dataDir, bot.game?.dimension))
    .filter(target => !skipped.has(pointKey(target.position)))
}

function nextOreProbe (bot: Bot, config: Config, skipped: Set<string>, tried: Set<string>): Vec3 | null {
  const origin = bot.entity?.position
  if (!origin) return null
  return rememberedProbes(bot, readResourceMemory(config.dataDir, bot.game?.dimension), 'ore', origin, config.scanRadius * 2)
    .find(point => {
      const key = pointKey(point)
      return !skipped.has(key) && !tried.has(key)
    }) ?? null
}

function surveyCells (config: Config, bot: Bot): Vec3[] {
  const position = bot.entity?.position
  if (!position) return []
  return surveyRing(position, config.scanRadius)
}


