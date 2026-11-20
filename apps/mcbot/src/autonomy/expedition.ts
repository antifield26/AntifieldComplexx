/** 主人委托的游戏执行器。模型提供目标与参数，数量、来源和结果由 Mineflayer 复核。 */
import { randomInt, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import type { MovementManager } from '../minecraft/movement.ts'
import { hasAirNeighbor, hasLiquidNeighbor, insideProtected, playerNear } from '../tasks/resources.ts'
import { nearbyHostile } from '../tasks/safety.ts'
import { isFood } from '../tasks/inventory.ts'
import { OPERATIONS, type Operation } from './expedition-contract.ts'
import { memoryDimension } from './world-memory.ts'

const NAME = /^[a-z0-9_]{1,64}$/
const PLAYER = /^[A-Za-z0-9_]{1,16}$/
const CHESTS = ['chest', 'trapped_chest', 'barrel']
const WORKSTATIONS = ['crafting_table', 'furnace'] as const
const SMELTING = { raw_iron: 'iron_ingot', raw_gold: 'gold_ingot', raw_copper: 'copper_ingot' } as const
const STRUCTURES = new Set(['village_plains', 'village_desert', 'village_savanna', 'village_snowy', 'village_taiga', 'ruined_portal', 'shipwreck', 'mineshaft'])
type Target = { item: string, quantity: number, delivered: number }
type SavedTarget = Target & { dimension: string | null }
type Place = { name: string, x: number, y: number, z: number, dimension: string, observedAt: string }
type Transfer = { run: string, operation: 'give' | 'deliver', item: string, quantity: number }
type Permission = { run: string, signal: AbortSignal, bot: Bot, dimension: string, item: string, quantity: number, code: string, expires: number }
type Result = Record<string, unknown>
type Execution = { run: string, signal: AbortSignal, bot: Bot, dimension: string }

class Blocked extends Error {
  constructor (readonlyCode: string, message: string) {
    super(message)
    this.code = readonlyCode
  }

  readonly code: string
}

function readJson<T> (file: string, missing: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missing
    throw error
  }
}

function saveJson (file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const draft = file + '.tmp'
  writeFileSync(draft, JSON.stringify(value), { mode: 0o600 })
  renameSync(draft, file)
}

function point (value: unknown): Vec3 {
  if (typeof value !== 'string' || !/^-?\d+ *, *-?\d+ *, *-?\d+$/.test(value.trim())) {
    throw new Blocked('invalid_position', '需要已观测的整数坐标')
  }
  const [x, y, z] = value.split(',').map(Number)
  if (Math.abs(x!) > 29999984 || Math.abs(z!) > 29999984 || y! < -64 || y! > 319) throw new Blocked('invalid_position', '坐标超出范围')
  return new Vec3(x!, y!, z!)
}

function sameDimension (entity: Entity, dimension: string): boolean {
  const value = (entity as Entity & { dimension?: string }).dimension
  return !value || value === dimension
}

export class Expedition {
  private readonly config: Config
  private readonly movement: MovementManager
  private readonly getBot: () => Bot | null
  private readonly directory: string
  private readonly goals = new Map<string, Target>()
  private readonly workstations = new Map<string, string>()
  private readonly seen = new Map<string, Place>()
  private permission: Permission | null = null
  private running = false

  constructor (config: Config, movement: MovementManager, getBot: () => Bot | null) {
    this.config = config
    this.movement = movement
    this.getBot = getBot
    this.directory = join(config.dataDir, 'worlds', config.worldId)
  }

  isBusy (): boolean { return this.running }

  reconcile (actor: string): string {
    if (actor.toLowerCase() !== this.owner().toLowerCase() || this.running) return '当前不能确认物品核对。'
    const pending = readJson<Transfer | null>(join(this.directory, 'transfer.json'), null)
    if (!pending) return '没有待核对的物品转移。'
    this.goals.delete(pending.run)
    saveJson(join(this.directory, 'target.json'), null)
    this.finishTransfer()
    return '已记录你核对了库存。请按实际缺口重新交代任务。'
  }

  revoke (run: string): void {
    if (this.permission?.run === run) this.permission = null
    this.goals.delete(run)
  }

  private owner (): string {
    const owner = this.config.commandAllowlist[0]
    if (!owner || !PLAYER.test(owner)) throw new Blocked('owner_unavailable', '没有配置主人游戏名')
    return owner
  }

  private player (bot: Bot, dimension: string): Entity | null {
    const owner = this.owner().toLowerCase()
    const player = Object.values(bot.players).find(value => value.username.toLowerCase() === owner)?.entity
    return player && sameDimension(player, dimension) ? player : null
  }

  private inventory (bot: Bot, name: string): number {
    return bot.inventory.items().filter(item => item.name === name).reduce((count, item) => count + item.count, 0)
  }

  private assertConnected (execution: Execution): void {
    execution.signal.throwIfAborted()
    if (this.getBot() !== execution.bot || !execution.bot.entity || execution.bot.game?.dimension !== execution.dimension) {
      throw new Blocked('world_changed', '连接或维度发生变化')
    }
  }

  private assertSafe (execution: Execution, allowHungry = false): void {
    this.assertConnected(execution)
    const { bot } = execution
    if (!Number.isFinite(bot.health) || bot.health <= this.config.defenseHealthThreshold || nearbyHostile(bot, this.config.defenseRadius)) {
      throw new Blocked('danger', '血量或周围威胁要求暂停')
    }
    if (!allowHungry && (!Number.isFinite(bot.food) || bot.food <= this.config.defenseFoodThreshold)) throw new Blocked('hunger', '请先吃食物')
  }

  private place (name: string, position: Vec3, dimension: string): Place {
    return { name, x: position.x, y: position.y, z: position.z, dimension, observedAt: new Date().toISOString() }
  }

  private places (dimension: string): Place[] {
    return readJson(join(this.directory, 'shared-' + memoryDimension(dimension) + '.json'), [])
  }

  teachSharedChest (actor: string): string {
    if (actor.toLowerCase() !== this.owner().toLowerCase()) return '只有主人可以指定共享箱。'
    const bot = this.getBot()
    const dimension = bot?.game?.dimension
    if (!bot || !dimension) return '我现在看不到箱子。'
    const owner = this.player(bot, dimension)
    if (!owner) return '我现在看不到你。'
    const ids = CHESTS.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined)
    const positions = bot.findBlocks({ point: owner.position, matching: ids, maxDistance: 3, count: 2 })
    if (positions.length !== 1) return '请站到唯一一个要共享的箱子旁边，再告诉我。'
    const found = bot.blockAt(positions[0]!)
    if (!found || !CHESTS.includes(found.name)) return '我没有确认到箱子。'
    const position = this.place(found.name, found.position, dimension)
    const places = this.places(dimension).filter(value => value.x !== position.x || value.y !== position.y || value.z !== position.z)
    saveJson(join(this.directory, 'shared-' + memoryDimension(dimension) + '.json'), [position, ...places].slice(0, 32))
    return '记住了，共享箱在 ' + found.position.toArray().join(',') + '。'
  }

  private status (execution: Execution): Result {
    const { run, bot, dimension } = execution
    const goal = this.goals.get(run)
    const owned = goal ? this.inventory(bot, goal.item) : null
    const pending = readJson<Transfer | null>(join(this.directory, 'transfer.json'), null)
    const inventory = new Map<string, number>()
    for (const item of bot.inventory.items()) inventory.set(item.name, (inventory.get(item.name) ?? 0) + item.count)
    return {
      observedAt: new Date().toISOString(),
      dimension, position: bot.entity.position.floored(), owner: this.owner(),
      ownerPosition: this.player(bot, dimension)?.position.floored() ?? null,
      health: bot.health, food: bot.food, inventory: Object.fromEntries(inventory),
      shared: this.places(dimension), pending,
      paused: goal ? null : this.pausedTarget(dimension),
      target: goal ? { ...goal, owned, remaining: Math.max(0, goal.quantity - goal.delivered), complete: goal.delivered >= goal.quantity } : null
    }
  }

  private pausedTarget (dimension: string): Target | null {
    const target = readJson<SavedTarget | null>(join(this.directory, 'target.json'), null)
    return target?.dimension === dimension && target.delivered < target.quantity ? target : null
  }

  private saveTarget (execution: Execution, target: Target): void {
    saveJson(join(this.directory, 'target.json'), { ...target, dimension: execution.dimension })
  }

  async execute (run: string, signal: AbortSignal, args: Record<string, unknown>): Promise<Result> {
    if (this.running) return { ok: false, error: 'tool_busy' }
    const id = randomUUID()
    const bot = this.getBot()
    const dimension = bot?.game?.dimension
    if (!bot?.entity || !dimension || signal.aborted) return { ok: false, error: 'not_connected', executionId: id }
    const operation = args.operation as Operation
    if (!OPERATIONS.includes(operation)) return { ok: false, error: 'invalid_operation', executionId: id }
    const execution = { run, signal, bot, dimension }
    this.running = true
    const cancel = () => {
      this.movement.stop('expedition')
      bot.stopDigging()
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await this.perform(execution, operation, args)
      this.assertConnected(execution)
      return { ok: true, executionId: id, ...result }
    } catch (error) {
      return {
        ok: false, executionId: id,
        error: signal.aborted ? 'cancelled' : error instanceof Blocked ? error.code : 'action_failed',
        message: error instanceof Blocked ? error.message : '游戏没有确认这次操作'
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      this.running = false
    }
  }

  private async perform (execution: Execution, operation: Operation, args: Record<string, unknown>): Promise<Result> {
    const { bot, run, dimension } = execution
    const itemName = typeof args.item === 'string' ? args.item.replace(/^minecraft:/, '') : ''
    const item = NAME.test(itemName) ? itemName : ''
    const quantity = typeof args.quantity === 'number' && Number.isInteger(args.quantity) && args.quantity >= 1 && args.quantity <= 64 ? args.quantity : 0
    const registryItem = item ? bot.registry.itemsByName[item] : undefined
    const target = this.goals.get(run)
    this.assertConnected(execution)
    if (operation === 'status') return this.status(execution)
    if (operation === 'resume' || operation === 'abandon') {
      if (readJson(join(this.directory, 'transfer.json'), null)) throw new Blocked('reconciliation_required', '请先核对物品转移')
      const paused = this.pausedTarget(dimension)
      if (operation === 'resume') {
        if (!paused) throw new Blocked('no_paused_goal', '当前维度没有待继续的物资目标')
        if (!target) this.goals.set(run, paused)
      } else {
        this.revoke(run)
        saveJson(join(this.directory, 'target.json'), null)
      }
      return this.status(execution)
    }
    if (operation === 'goal') {
      if (!registryItem || !quantity || target && target.delivered < target.quantity) throw new Blocked('invalid_goal', '需要合法的物品和数量，且当前没有未完成的交付')
      if (this.pausedTarget(dimension)) throw new Blocked('goal_paused', '已有暂停的目标，请主人确认继续或放弃')
      const created = { item, quantity, delivered: 0 }
      this.saveTarget(execution, created)
      this.goals.set(run, created)
      return this.status(execution)
    }
    if (operation === 'scan') return this.scan(execution, item)
    if (operation === 'follow') return await this.follow(execution)
    this.assertSafe(execution)
    switch (operation) {
      case 'walk': return this.walk(execution, point(args.position))
      case 'gather': return this.gather(execution, item, point(args.position))
      case 'craft':
        if (!registryItem || !quantity) throw new Blocked('invalid_item', '需要合成产物与数量')
        return this.craft(execution, item, quantity)
      case 'smelt': return this.smelt(execution, item, quantity)
      case 'withdraw':
        if (!registryItem || !quantity) throw new Blocked('invalid_item', '需要取出的物品与数量')
        return this.withdraw(execution, item, quantity, point(args.position))
      case 'deliver': return this.deliver(execution, target)
      case 'locate':
        if (!STRUCTURES.has(item)) throw new Blocked('invalid_structure', '当前只支持村庄、废弃传送门、沉船和废弃矿井')
        return this.locate(execution, item)
      case 'teleport': {
        const owner = this.player(bot, dimension)
        const position = point(args.position)
        if (!owner || position.distanceTo(owner.position) > 3) throw new Blocked('unsafe_destination', '自身传送只允许到已加载的主人身边')
        await this.movement.teleportToPlayer(this.owner())
        this.assertConnected(execution)
        const actual = this.player(bot, dimension)
        if (!actual || bot.entity.position.distanceTo(actual.position) > 4) throw new Blocked('unverified', '传送收尾未得到位置确认')
        return { arrived: true, position: bot.entity.position.floored() }
      }
      case 'give': {
        if (readJson(join(this.directory, 'transfer.json'), null)) throw new Blocked('reconciliation_required', '已有未核实的发放或交付')
        if (!target || item !== target.item || !quantity || quantity > target.quantity - target.delivered - this.inventory(bot, item) ||
            !registryItem || !/^(raw_(iron|gold|copper)|(iron|gold|copper)_ingot|coal|charcoal|[a-z_]+_(log|planks)|bread|wheat|carrot|potato|cobblestone)$/.test(item)) {
          throw new Blocked('invalid_generation', '仅能为当前目标申请缺少的普通生存物资')
        }
        if (this.permission && this.permission.expires > Date.now()) throw new Blocked('approval_pending', '已有一项申请等待主人确认')
        const code = String(randomInt(100000, 1000000))
        this.permission = { ...execution, item, quantity, code, expires: Date.now() + 60_000 }
        return { status: 'approval_required', approvalCode: code, item, quantity, recipient: bot.username, expiresInSeconds: 60 }
      }
      default: throw new Blocked('invalid_operation', '未知操作')
    }
  }

  async answer (actor: string, raw: string): Promise<string | null> {
    const match = /^(确认|同意|拒绝|取消)\s*(\d{6})[。！!]?$/u.exec(raw)
    if (!match || actor.toLowerCase() !== this.owner().toLowerCase()) return null
    const pending = this.permission
    if (!pending || pending.code !== match[2] || pending.expires <= Date.now() || pending.signal.aborted) return '这项许可已失效。'
    if (this.running) return '我正在执行另一步，请稍后再确认。'
    this.permission = null
    if (match[1] === '拒绝' || match[1] === '取消') return '已取消生成申请。'
    const { bot, item, quantity } = pending
    this.running = true
    try {
      this.assertSafe(pending)
      const goal = this.goals.get(pending.run)
      const before = this.inventory(bot, item)
      if (!goal || goal.quantity - goal.delivered - before < quantity || !PLAYER.test(bot.username)) return '所需数量已变化，请重新申请。'
      this.beginTransfer(pending, 'give', item, quantity)
      bot.chat('/give ' + bot.username + ' minecraft:' + item + ' ' + quantity)
      for (let retry = 0; retry < 16; retry += 1) {
        await delay(250, undefined, { signal: pending.signal })
        this.assertConnected(pending)
        if (this.inventory(bot, item) - before === quantity) {
          this.finishTransfer()
          return '生成的 ' + quantity + ' 个 ' + item + ' 已在我背包。'
        }
      }
      return '尚未核实生成结果，需要先核对库存。'
    } catch {
      return '生成未确认，请先核对库存。'
    } finally {
      this.running = false
    }
  }

  private scan (execution: Execution, name: string): Result {
    const { bot, dimension } = execution
    const block = name && bot.registry.blocksByName[name]
    if (!block) throw new Blocked('unknown_block', '请提供要寻找的方块 ID')
    const radius = 48
    const visible = bot.findBlocks({ matching: block.id, maxDistance: radius, count: 24 }).map(position => this.place(name, position, dimension))
    for (const entry of visible) this.seen.set(dimension + ':' + entry.x + ',' + entry.y + ',' + entry.z, entry)
    while (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value!)
    const remembered = [...this.seen.values()].filter(entry => entry.name === name && entry.dimension === dimension &&
      bot.blockAt(new Vec3(entry.x, entry.y, entry.z)) === null).slice(-12)
    return { ...this.status(execution), block: name, radius, visible, remembered, scope: 'loaded_chunks' }
  }

  private async walk (execution: Execution, position: Vec3): Promise<Result> {
    this.assertSafe(execution)
    const { bot } = execution
    if (bot.entity.position.distanceTo(position) > 64 || !bot.blockAt(position)) throw new Blocked('unloaded_destination', '每步只能走向已加载的地点')
    if (bot.entity.position.distanceTo(position) > 2.5) {
      await this.movement.goNearPoint(position.x, position.y, position.z, 2, 15_000, false)
    }
    this.assertSafe(execution)
    if (bot.entity.position.distanceTo(position) > 3.5) throw new Blocked('unreachable', '还没有到达位置')
    return { position: bot.entity.position.floored() }
  }

  private async follow (execution: Execution): Promise<Result> {
    const { bot, dimension, signal } = execution
    let lastSeen: Vec3 | null = null
    let unseenSince: number | null = null
    const end = Date.now() + 90_000
    while (Date.now() < end) {
      this.assertSafe(execution, true)
      if (bot.food <= this.config.defenseFoodThreshold) {
        const food = bot.inventory.items().find(item => isFood(bot, item))
        if (!food) throw new Blocked('hunger', '我需要食物，先停在这里')
        await bot.equip(food, 'hand')
        this.assertSafe(execution, true)
        await bot.consume()
      }
      const owner = this.player(bot, dimension)
      if (owner) {
        unseenSince = null
        lastSeen = owner.position.floored()
        await this.walk(execution, lastSeen)
      } else {
        unseenSince ??= Date.now()
        if (!lastSeen || Date.now() - unseenSince >= 5_000) return { status: 'owner_lost', lastSeen }
      }
      await delay(500, undefined, { signal })
    }
    return { status: 'follow_interval_finished', lastSeen }
  }

  private async locate (execution: Execution, name: string): Promise<Result> {
    const { bot, signal } = execution
    const keys = ['commands.locate.structure.success', 'commands.locate.structure.not_found']
    let coordinates: string | null = null
    const received = (message: { translate?: string, toString: () => string }, position: string): void => {
      if (position !== 'system' || !keys.includes(message.translate ?? '')) return
      const text = message.toString()
      const match = /\[\s*(-?\d+),\s*(?:~|\?|\u223c|-?\d+),\s*(-?\d+)\s*\]/u.exec(text)
      coordinates = match ? match[1] + ',' + match[2] : ''
    }
    bot.on('message', received)
    try {
      bot.chat('/locate structure minecraft:' + name)
      for (let retry = 0; retry < 20 && coordinates === null; retry += 1) await delay(250, undefined, { signal })
      this.assertConnected(execution)
      if (!coordinates) throw new Blocked('locate_unavailable', '游戏未返回可确认的结构位置')
      return { structure: name, xz: coordinates, source: 'locate', loaded: false }
    } finally {
      bot.removeListener('message', received)
    }
  }

  private safeDigSite (bot: Bot, position: Vec3): boolean {
    if (insideProtected(this.config, position.x, position.z, 12) || playerNear(bot, position, 6) || hasLiquidNeighbor(bot, position)) return false
    if (this.places(bot.game.dimension).some(place => position.distanceTo(new Vec3(place.x, place.y, place.z)) <= 6)) return false
    const buildings = /(?:_planks|_bricks|_glass|_stairs|_door|_fence|chest|furnace|crafting_table)$/
    return bot.findBlocks({ point: position, matching: block => buildings.test(block.name), maxDistance: 5, count: 1 }).length === 0
  }

  private async gather (execution: Execution, name: string, position: Vec3): Promise<Result> {
    const { bot, signal } = execution
    if (!/^(?:[a-z_]+_ore|[a-z_]+_log|stone|coal_ore)$/.test(name)) throw new Blocked('protected_block', '当前只采集普通木材、石料和矿石')
    const block = bot.blockAt(position)
    if (!block || block.name !== name || !hasAirNeighbor(bot, position) || !this.safeDigSite(bot, position)) throw new Blocked('unsafe_target', '目标未复核为可采集的野外方块')
    if (name.endsWith('_log')) {
      const leaves = bot.registry.blocksByName[name.replace(/_log$/, '_leaves')]
      if (!leaves || !bot.findBlocks({ point: position, matching: leaves.id, maxDistance: 6, count: 1 }).length) {
        throw new Blocked('unsafe_target', '未找到树叶证据，保留这根原木')
      }
    }
    await this.walk(execution, position)
    const current = bot.blockAt(position)
    if (!current || current.name !== name || !this.safeDigSite(bot, position) || !bot.canDigBlock(current)) throw new Blocked('unreachable_block', '到场后无法安全采集该方块')
    const pick = bot.pathfinder.bestHarvestTool(current)
    if (pick) await bot.equip(pick, 'hand')
    this.assertSafe(execution)
    if (!current.canHarvest(bot.heldItem?.type ?? null)) throw new Blocked('missing_tool', '缺少能获得掉落物的工具')
    const before = new Map(bot.inventory.items().map(item => [item.name, this.inventory(bot, item.name)]))
    await bot.dig(current)
    await this.collectNearbyDrop(execution, position)
    await delay(300, undefined, { signal })
    const gained = Object.fromEntries([...new Set(bot.inventory.items().map(item => item.name))]
      .map(item => [item, this.inventory(bot, item) - (before.get(item) ?? 0)] as const).filter(([, count]) => count > 0))
    if (!Object.keys(gained).length) throw new Blocked('no_drop_verified', '方块已采集，尚未确认掉落物入包')
    return { gained }
  }

  private async collectNearbyDrop (execution: Execution, position: Vec3): Promise<void> {
    const { bot, signal } = execution
    // 方块变成空气的更新可能早于物品实体的生成和元数据。
    for (let retry = 0; retry < 12; retry += 1) {
      this.assertSafe(execution)
      const drop = bot.nearestEntity(entity => entity.getDroppedItem() !== null && entity.position.distanceTo(position) < 3)
      if (drop) {
        if (bot.entity.position.distanceTo(drop.position) > 0.65) {
          await this.movement.goNearPoint(drop.position.x, drop.position.y, drop.position.z, 0.5, 3_000, false).catch(() => undefined)
        }
        if (!bot.entities[drop.id]) return
      }
      await delay(200, undefined, { signal })
    }
  }

  private async workstation (execution: Execution, name: typeof WORKSTATIONS[number]): Promise<Block> {
    const { bot, dimension } = execution
    const id = bot.registry.blocksByName[name]?.id
    if (id === undefined) throw new Blocked('station_unavailable', '当前版本缺少工作站')
    if (name === 'crafting_table') {
      const existing = bot.findBlock({ matching: id, maxDistance: 12 })
      if (existing) return existing
    }
    const item = bot.inventory.items().find(value => value.name === name)
    if (!item) throw new Blocked('station_unavailable', '需要先合成 ' + name)
    for (const offset of [new Vec3(2, 0, 0), new Vec3(-2, 0, 0), new Vec3(0, 0, 2), new Vec3(0, 0, -2)]) {
      const position = bot.entity.position.floored().plus(offset)
      const floor = bot.blockAt(position.offset(0, -1, 0))
      if (!floor || floor.boundingBox !== 'block' || !['grass_block', 'dirt', 'stone', 'deepslate', 'sand', 'gravel'].includes(floor.name) ||
          bot.blockAt(position)?.name !== 'air' || !this.safeDigSite(bot, position)) continue
      await bot.equip(item, 'hand')
      this.assertSafe(execution)
      await bot.placeBlock(floor, new Vec3(0, 1, 0))
      const placed = bot.blockAt(position)
      if (placed?.name !== name) throw new Blocked('station_unverified', '工作站没有得到放置确认')
      this.workstations.set(dimension + ':' + position.toString(), name)
      return placed
    }
    throw new Blocked('unsafe_station_site', '周围没有可安全放置工作站的位置')
  }

  private async reclaim (execution: Execution, block: Block): Promise<void> {
    const { bot, dimension } = execution
    const key = dimension + ':' + block.position.toString()
    if (this.workstations.get(key) !== block.name) return
    this.assertSafe(execution)
    const current = bot.blockAt(block.position)
    if (!current || current.name !== block.name) return
    const tool = bot.pathfinder.bestHarvestTool(current)
    if (tool) await bot.equip(tool, 'hand')
    this.assertSafe(execution)
    if (!current.canHarvest(bot.heldItem?.type ?? null) || !bot.canDigBlock(current)) return
    await bot.dig(current)
    this.workstations.delete(key)
    await this.collectNearbyDrop(execution, current.position)
  }

  private async craft (execution: Execution, name: string, quantity: number): Promise<Result> {
    const { bot } = execution
    const id = bot.registry.itemsByName[name]!.id
    const before = this.inventory(bot, name)
    let station: Block | null = null
    let recipe = bot.recipesFor(id, null, quantity, null)[0]
    if (!recipe) {
      station = await this.workstation(execution, 'crafting_table')
      await this.walk(execution, station.position)
      recipe = bot.recipesFor(id, null, quantity, station)[0]
    }
    try {
      if (!recipe) throw new Blocked('ingredients_missing', '现有背包不能合成所需物品')
      this.assertSafe(execution)
      await bot.craft(recipe, Math.ceil(quantity / recipe.result.count), station ?? undefined)
      const gained = this.inventory(bot, name) - before
      if (gained < quantity) throw new Blocked('craft_unverified', '背包尚未核实全部合成产物')
      return { item: name, gained }
    } finally {
      if (station && !execution.signal.aborted) await this.reclaim(execution, station)
    }
  }

  private async smelt (execution: Execution, name: string, quantity: number): Promise<Result> {
    const { bot, signal } = execution
    const output = SMELTING[name as keyof typeof SMELTING]
    const fuel = bot.inventory.items().find(item => ['coal', 'charcoal'].includes(item.name))
    if (!output || !quantity || quantity > 8 || this.inventory(bot, name) < quantity || !fuel) {
      throw new Blocked('ingredients_missing', '每批最多冶炼 8 个粗矿，需要足够原料以及煤或木炭')
    }
    const before = this.inventory(bot, output)
    const station = await this.workstation(execution, 'furnace')
    this.assertSafe(execution)
    const furnace = await bot.openFurnace(station)
    try {
      this.assertSafe(execution)
      if (furnace.inputItem() || furnace.fuelItem() || furnace.outputItem()) throw new Blocked('station_occupied', '熔炉里已有物品')
      await furnace.putFuel(fuel.type, fuel.metadata, 1)
      this.assertSafe(execution)
      await furnace.putInput(bot.registry.itemsByName[name]!.id, null, quantity)
      const end = Date.now() + quantity * 11_000 + 4000
      while ((furnace.outputItem()?.count ?? 0) < quantity && Date.now() < end) {
        this.assertSafe(execution)
        await delay(500, undefined, { signal })
      }
      this.assertSafe(execution)
      if (!furnace.outputItem()) throw new Blocked('smelt_unverified', '熔炉未产生可确认的产物')
      await furnace.takeOutput()
      if (furnace.inputItem()) await furnace.takeInput()
      if (furnace.fuelItem()) await furnace.takeFuel()
    } finally {
      if (bot.currentWindow === furnace) await furnace.close()
    }
    await this.reclaim(execution, station)
    return { item: output, gained: this.inventory(bot, output) - before }
  }

  private async withdraw (execution: Execution, name: string, quantity: number, position: Vec3): Promise<Result> {
    const { bot, dimension } = execution
    const shared = this.places(dimension).find(place => position.equals(new Vec3(place.x, place.y, place.z)))
    if (!shared) throw new Blocked('not_shared', '这不是主人指定的共享箱')
    await this.walk(execution, position)
    const block = bot.blockAt(position)
    if (!block || block.name !== shared.name || !CHESTS.includes(block.name)) throw new Blocked('chest_changed', '容器已经变化，请主人重新指定')
    const before = this.inventory(bot, name)
    const chest = await bot.openContainer(block)
    try {
      this.assertSafe(execution)
      const available = chest.containerItems().filter(item => item.name === name).reduce((total, item) => total + item.count, 0)
      if (!available) throw new Blocked('not_in_chest', '共享箱内没有这种物品')
      await chest.withdraw(bot.registry.itemsByName[name]!.id, null, Math.min(available, quantity))
    } finally {
      if (bot.currentWindow === chest) chest.close()
    }
    return { item: name, gained: this.inventory(bot, name) - before }
  }

  private beginTransfer (execution: Execution, operation: Transfer['operation'], item: string, quantity: number): void {
    const file = join(this.directory, 'transfer.json')
    if (readJson<Transfer | null>(file, null)) throw new Blocked('reconciliation_required', '已有需核对的物品转移')
    saveJson(file, { run: execution.run, operation, item, quantity } satisfies Transfer)
  }

  private finishTransfer (): void {
    saveJson(join(this.directory, 'transfer.json'), null)
  }

  private async deliver (execution: Execution, goal: Target | undefined): Promise<Result> {
    if (!goal) throw new Blocked('missing_goal', '没有已登记的物资目标')
    const { bot, dimension, signal } = execution
    const quantity = Math.min(this.inventory(bot, goal.item), goal.quantity - goal.delivered)
    if (goal.delivered >= goal.quantity) return this.status(execution)
    if (!quantity) throw new Blocked('missing_items', '背包里没有可交付的物资')
    const owner = this.player(bot, dimension)
    if (!owner) return { status: 'awaiting_owner', ...this.status(execution) }
    await this.walk(execution, owner.position.floored())
    if (this.player(bot, dimension)?.id !== owner.id || owner.position.distanceTo(bot.entity.position) > 3.5) return { status: 'awaiting_owner', ...this.status(execution) }
    const peers = Object.values(bot.players).some(player => player.entity && player.entity.id !== owner.id &&
      player.entity !== bot.entity && player.entity.position.distanceTo(bot.entity.position) < 6)
    if (peers) throw new Blocked('delivery_crowded', '请主人到空旷位置接收，避免其他玩家误捡')
    this.assertSafe(execution)
    this.beginTransfer(execution, 'deliver', goal.item, quantity)
    let verified = 0
    const dropped = new Set<number>()
    const onDrop = (entity: Entity): void => {
      const item = entity.getDroppedItem()
      if (item?.name === goal.item && entity.position.distanceTo(bot.entity.position) <= 2.5) dropped.add(entity.id)
    }
    const onCollect = (collector: Entity, entity: Entity): void => {
      if (collector.id !== owner.id || !dropped.has(entity.id)) return
      // collect 事件没有传递协议的拾取数量。只把客户端可见的一件掉落物作为一件证据。
      if (entity.getDroppedItem()?.count !== 1) return
      dropped.delete(entity.id)
      verified += 1
    }
    bot.on('itemDrop', onDrop)
    bot.on('playerCollect', onCollect)
    try {
      for (let index = 0; index < quantity; index += 1) {
        this.assertSafe(execution)
        if (this.player(bot, dimension)?.id !== owner.id || owner.position.distanceTo(bot.entity.position) > 3.5) break
        // 每件投掷前更新朝向，避免把掉落物投到自己的脚边或主人刚离开的位置。
        await bot.lookAt(owner.position.offset(0, 1.4, 0), true)
        this.assertSafe(execution)
        await bot.toss(bot.registry.itemsByName[goal.item]!.id, null, 1)
        const deadline = Date.now() + 4000
        while (verified <= index && Date.now() < deadline) await delay(125, undefined, { signal })
        this.assertConnected(execution)
        if (verified <= index) {
          goal.delivered += verified
          this.saveTarget(execution, goal)
          return { status: 'delivery_unverified', confirmedThisAction: verified, ...this.status(execution) }
        }
      }
      goal.delivered += verified
      this.saveTarget(execution, goal)
      this.finishTransfer()
      return this.status(execution)
    } finally {
      bot.removeListener('itemDrop', onDrop)
      bot.removeListener('playerCollect', onCollect)
    }
  }
}
