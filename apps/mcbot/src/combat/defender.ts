/**
 * 任务中的近战反射：白名单内正在靠近的敌对生物用最好的武器或拳头处理。
 * 不近战苦力怕、末影人和玩家。女巫不主动追，只有它已经在攻击时才还手。
 * 不要求护甲或铁剑；低血、低饥饿和怪太多时仍撤退。
 */
import type { Bot } from 'mineflayer'
import type { Vec3 as Vec3Type } from 'vec3'
import type { AuditLogger } from '../audit.ts'
import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'
import type { MovementManager } from '../minecraft/movement.ts'
import { withdrawSupplies } from '../tasks/deposit.ts'
import { eatIfNeeded, equipItem, findItem } from '../tasks/inventory.ts'
import type { TaskContext } from '../tasks/types.ts'
import { sleep } from '../tasks/types.ts'
import type { DefenseOutcome, TaskDefender } from './types.ts'

interface DefensibleEntity {
  id: number
  name?: string
  type: string
  position: Vec3Type
  health?: number
}

const NEVER_MELEE = new Set(['creeper', 'enderman', 'player'])
const WEAPON_NAMES = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'
]

export function bestWeaponName (names: readonly string[]): string | null {
  for (const name of WEAPON_NAMES) {
    if (names.includes(name)) return name
  }
  return null
}

/** 女巫只有正在攻击 Bot 时才算威胁。显式标记优先，否则看它是否面向 Bot。 */
export function mobIsAttacking (
  mob: { attacking?: boolean, attackTarget?: number, yaw?: number, position: { x: number, z: number } },
  bot: { id?: number, position: { x: number, z: number } }
): boolean {
  if (mob.attacking === true) return true
  if (typeof mob.attackTarget === 'number' && bot.id !== undefined && mob.attackTarget === bot.id) return true
  if (typeof mob.yaw !== 'number') return false
  const dx = bot.position.x - mob.position.x
  const dz = bot.position.z - mob.position.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.2 || distance > 8) return false
  const lookX = -Math.sin(mob.yaw)
  const lookZ = -Math.cos(mob.yaw)
  return (lookX * dx + lookZ * dz) / distance > 0.85
}
const ARMOR = [
  { name: 'iron_helmet', slot: 'head' as const },
  { name: 'iron_chestplate', slot: 'torso' as const },
  { name: 'iron_leggings', slot: 'legs' as const },
  { name: 'iron_boots', slot: 'feet' as const }
]
const OFF_HAND_SLOT = 45

export interface DefenderDeps {
  config: Config
  logger: Logger
  movement: MovementManager
  audit: AuditLogger
  getBot: () => Bot | null
}

export class Defender implements TaskDefender {
  private readonly deps: DefenderDeps
  private readonly logger: Logger

  constructor (deps: DefenderDeps) {
    this.deps = deps
    this.logger = deps.logger
  }

  hasThreat (): boolean {
    return this.threats().length > 0
  }

  async prepare (ctx: TaskContext): Promise<void> {
    const bot = this.deps.getBot()
    if (!bot?.entity) return
    // 背包 items() 不含已装备的护甲和副手。
    const equipped = [OFF_HAND_SLOT, ...ARMOR.map(item => this.slotFor(item.slot))]
      .map(slot => bot.inventory.slots[slot]?.name)
    const missing = ['iron_sword', 'shield', ...ARMOR.map(item => item.name)]
      .filter(name => !equipped.includes(name) && !findItem(bot, name))
      .map(name => ({ name, count: 1 }))
    if (missing.length === 0) {
      await this.equipGear(bot)
      return
    }
    try {
      await withdrawSupplies(ctx, missing)
    } catch (error) {
      this.logger.warn('defense: combat gear withdraw failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
    await this.equipGear(bot)
  }

  async defend (ctx: TaskContext): Promise<DefenseOutcome> {
    const bot = this.deps.getBot()
    if (!bot?.entity) return 'retreat'
    const startedAt = Date.now()
    let kills = 0
    while (Date.now() - startedAt < 20_000) {
      const threats = this.threats()
      if (threats.length === 0) {
        if (kills > 0) this.logger.info('defense: threats cleared', { kills })
        return kills > 0 ? 'cleared' : 'none'
      }
      if (this.shouldRetreat(bot, threats)) {
        await this.retreat(ctx, '血量/食物偏低或怪太多')
        return 'retreat'
      }
      await this.equipBestWeapon(bot)
      await this.equipShield(bot)
      const target = threats[0]
      if (!target) return 'cleared'
      this.logger.info('defense: engaging', {
        target: target.name,
        threats: threats.length,
        health: bot.health,
        food: bot.food
      })
      if (this.deps.config.criticalHealth > 0 && bot.health <= this.deps.config.criticalHealth) {
        this.deps.movement.noteHealth()
        await this.retreat(ctx, '血量濒危', false)
        return 'retreat'
      }
      try {
        await this.deps.movement.goNearPoint(target.position.x, target.position.y, target.position.z, 2, 8000, true)
      } catch (error) {
        this.logger.warn('defense: approach failed', {
          target: target.name,
          error: error instanceof Error ? error.message : String(error)
        })
        await this.retreat(ctx, '走不到怪那里')
        return 'retreat'
      }
      const until = Date.now() + 5000
      while (Date.now() < until) {
        const live = bot.entities[target.id] as DefensibleEntity | undefined
        if (!live || (live.health !== undefined && live.health <= 0)) {
          kills = this.noteKill(ctx, target.name, kills)
          break
        }
        if (bot.entity.position.distanceTo(live.position) > this.deps.config.defenseRadius + 1) break
        if (this.shouldRetreat(bot, this.threats())) {
          await this.retreat(ctx, '战斗中血量/食物偏低')
          return 'retreat'
        }
        try {
          await bot.lookAt(live.position.offset(0, 1.2, 0), true)
          const rawEntity = bot.entities[target.id]
          if (rawEntity) bot.attack(rawEntity)
          const struck = bot.entities[target.id] as DefensibleEntity | undefined
          if (!struck || (struck.health !== undefined && struck.health <= 0)) {
            kills = this.noteKill(ctx, target.name, kills)
            break
          }
        } catch (error) {
          this.logger.warn('defense: attack failed', {
            target: target.name,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        await sleep(550, ctx.signal)
      }
    }
    this.logger.warn('defense: timeout', { kills })
    await this.retreat(ctx, '战斗时间太长')
    return 'retreat'
  }

  private threats (): DefensibleEntity[] {
    const bot = this.deps.getBot()
    if (!bot?.entity) return []
    const result: DefensibleEntity[] = []
    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity === bot.entity) continue
      if (entity.type === 'player') continue
      const hostile = entity as DefensibleEntity & { attacking?: boolean, attackTarget?: number, yaw?: number }
      if (typeof hostile.health === 'number' && hostile.health <= 0) continue
      const name = hostile.name
      if (!name || NEVER_MELEE.has(name)) continue
      if (name === 'witch' && !mobIsAttacking(hostile, { id: bot.entity.id, position: bot.entity.position })) continue
      if (name !== 'witch' && !this.deps.config.defenseTargets.includes(name)) continue
      if (bot.entity.position.distanceTo(entity.position) > this.deps.config.defenseRadius) continue
      result.push(entity as unknown as DefensibleEntity)
    }
    return result.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
  }

  private noteKill (ctx: TaskContext, name: string | undefined, kills: number): number {
    const next = kills + 1
    ctx.updateProgress({ mobsKilled: ctx.progress.mobsKilled + 1 })
    this.deps.audit.append({
      event: 'combat.kill',
      source: 'combat',
      actor: 'lofii',
      action: name ?? 'hostile',
      result: 'completed',
      details: { kills: next, radius: this.deps.config.defenseRadius }
    })
    return next
  }

  private shouldRetreat (bot: Bot, threats: DefensibleEntity[]): boolean {
    if (bot.health <= this.deps.config.defenseHealthThreshold) return true
    if (bot.food <= this.deps.config.defenseFoodThreshold) return true
    return threats.length > this.deps.config.defenseMaxHostiles
  }

  private async equipBestWeapon (bot: Bot): Promise<void> {
    const name = bestWeaponName(bot.inventory.items().map(item => item.name))
    if (!name) return
    const weapon = findItem(bot, name)
    if (!weapon) return
    try {
      await equipItem(bot, weapon)
    } catch {
      // 换装失败时继续用当前手上的东西或拳头
    }
  }

  private async equipGear (bot: Bot): Promise<void> {
    await this.equipBestWeapon(bot)
    for (const armor of ARMOR) {
      if (bot.inventory.slots[this.slotFor(armor.slot)]?.name === armor.name) continue
      const item = findItem(bot, armor.name)
      if (!item) continue
      try {
        await bot.equip(item, armor.slot)
      } catch {
        // best-effort armor
      }
    }
    await this.equipShield(bot)
  }

  private async equipShield (bot: Bot): Promise<void> {
    const shield = findItem(bot, 'shield')
    if (!shield) return
    try {
      await bot.equip(shield, 'off-hand')
    } catch {
      // shield is best-effort across protocol/version combinations
    }
  }

  private slotFor (slot: 'head' | 'torso' | 'legs' | 'feet'): number {
    if (slot === 'head') return 5
    if (slot === 'torso') return 6
    if (slot === 'legs') return 7
    return 8
  }

  private async retreat (ctx: TaskContext, reason: string, walkHome = true): Promise<void> {
    this.logger.warn('defense: retreat', { reason })
    this.deps.audit.append({
      event: 'combat.retreat',
      source: 'combat',
      actor: 'lofii',
      action: 'retreat',
      result: 'interrupted',
      details: { reason }
    })
    try {
      await eatIfNeeded(ctx)
    } catch {
      // ignore; movement home is the priority
    }
    if (!walkHome) return
    try {
      await this.deps.movement.home()
    } catch {
      // ignore; task will stop with the retreat reason
    }
    await ctx.say('有怪，我先回家。')
  }
}
