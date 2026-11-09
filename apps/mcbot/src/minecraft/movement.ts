/** 统一寻路和单次动作取消。坐标传送只允许基地与已配置锚点；濒危传送只回基地。 */
import type { Bot } from 'mineflayer'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'
import { isTeleportAnchor, safeSpotNear } from '../tasks/navigation.ts'
import { planRoute } from './routing/planner.ts'
import { RouteExecutor, type ExecutorBot } from './routing/executor.ts'
import { canStand } from './routing/sampler.ts'
import { buildTerrainSummary } from '../ai/path-advisor.ts'
import { NavigationTrace } from './routing/trace.ts'
import type {
  NavArea,
  NavigationSnapshot,
  NavVector,
  NavWorld,
  RouteAdvisor,
  RouteExecutionResult,
  RouteFailureKind
} from './routing/types.ts'

const { goals, Movements } = pathfinderPackage

export class MovementError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'MovementError'
  }
}

interface Target {
  username: string
  entity: Bot['players'][string]['entity']
}

function targetFor (bot: Bot, username: string): Target | null {
  const player = bot.players[username]
  if (!player || !player.entity) return null
  return { username: player.username, entity: player.entity }
}

function distanceTo (bot: Bot, x: number, y: number, z: number): number {
  if (!bot.entity) return Number.POSITIVE_INFINITY
  return bot.entity.position.distanceTo(new Vec3(x, y, z))
}

export class MovementManager {
  private readonly logger: Logger
  private config: Config | null
  private bot: Bot | null = null
  private current: 'come' | 'follow' | 'task' | null = null
  private followedName: string | null = null
  private operation: AbortController | null = null
  private notify: ((message: string) => void) | null = null
  private advisor: RouteAdvisor | null = null
  private navigationListener: ((snapshot: NavigationSnapshot) => void) | null = null
  private fallbackListener: ((fallback: 'teleport' | 'stopped', reason: string) => void) | null = null
  private readonly executor = new RouteExecutor()
  private criticalBusy = false
  private criticalListener: ((health: number) => void) | null = null
  private readonly trace = new NavigationTrace()
  private lastAiAt = 0
  private restoreMonitor: (() => void) | null = null
  private navigation: NavigationSnapshot = {
    state: 'idle',
    source: null,
    attempts: 0,
    lastFailureKind: null,
    lastFallback: null,
    lastFallbackReason: null,
    aiUsed: false,
    updatedAt: null
  }

  constructor (logger: Logger, config: Config | null = null) {
    this.logger = logger
    this.config = config
  }

  setConfig (config: Config): void {
    this.config = config
  }

  attach (bot: Bot): void {
    this.bot = bot
    const movements = new Movements(bot)
    movements.canDig = false
    movements.canOpenDoors = false
    movements.allowParkour = false
    movements.allowSprinting = true
    // PaperMC 高低差地形：允许安全的两格下落，避免一格台阶/坡道边缘被判定为不可达。
    // pathfinder 仍不挖掘、不开门、不跑酷、不搭建。木门由确定性执行器打开，铁门只报告阻挡。
    movements.maxDropDown = 2
    movements.scafoldingBlocks = []
    bot.pathfinder.setMovements(movements)
    bot.pathfinder.thinkTimeout = 3000
    bot.pathfinder.tickTimeout = 40
    this.logger.info('pathfinder configured', { canDig: false, allowParkour: false, maxDropDown: 2 })
  }

  detach (): void {
    this.stop('detach')
    this.bot = null
  }

  setNotify (notify: ((message: string) => void) | null): void {
    this.notify = notify
  }

  setRouteAdvisor (advisor: RouteAdvisor | null): void {
    this.advisor = advisor
  }

  setNavigationListener (listener: ((snapshot: NavigationSnapshot) => void) | null): void {
    this.navigationListener = listener
  }

  setFallbackListener (listener: ((fallback: 'teleport' | 'stopped', reason: string) => void) | null): void {
    this.fallbackListener = listener
  }

  setCriticalListener (listener: ((health: number) => void) | null): void {
    this.criticalListener = listener
  }

  navigationSnapshot (): NavigationSnapshot {
    return { ...this.navigation }
  }

  navigationTrace (): ReturnType<NavigationTrace['recent']> {
    return this.trace.recent()
  }

  private updateNavigation (patch: Partial<NavigationSnapshot>): void {
    this.navigation = {
      ...this.navigation,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.navigationListener?.({ ...this.navigation })
  }

  private recordFailure (source: NavigationSnapshot['source'], failure: RouteFailureKind, reason: string | null, nodes: number | null = null): void {
    this.trace.record({
      at: new Date().toISOString(),
      source: source ?? 'pathfinder',
      failure,
      reason,
      nodes
    })
    this.updateNavigation({ state: 'fallback', source, lastFailureKind: failure })
  }

  describe (): string {
    if (this.current === 'come') return '移动中'
    if (this.current === 'follow') return `跟随 ${this.followedName ?? '目标'} 中`
    if (this.current === 'task') return '任务移动中'
    return '待机'
  }

  isBusy (): boolean {
    return this.current !== null || this.criticalBusy
  }

  atHome (): boolean {
    return Boolean(this.bot && this.config && this.reachedTarget(this.bot, this.config.home, 1))
  }

  private requireBot (): Bot {
    if (!this.bot) throw new MovementError('not attached')
    return this.bot
  }

  private requireConfig (): Config {
    if (!this.config) throw new MovementError('任务坐标未配置')
    return this.config
  }

  private requireTarget (username: string): Target {
    const bot = this.requireBot()
    const target = targetFor(bot, username)
    if (!target) throw new MovementError(`看不到 ${username}，请靠近一点再试`)
    return target
  }

  private begin (kind: NonNullable<MovementManager['current']>): AbortController {
    if (this.operation) this.stop('superseded')
    const operation = new AbortController()
    this.operation = operation
    this.current = kind
    return operation
  }

  private end (operation: AbortController): void {
    if (this.operation !== operation) return
    this.operation = null
    this.current = null
    this.followedName = null
  }

  async waitForNear (x: number, y: number, z: number, tolerance = 3, timeoutMs = 6000): Promise<void> {
    const bot = this.requireBot()
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (distanceTo(bot, x, y, z) <= tolerance) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new MovementError('传送没有生效，可能被服务器拒绝了')
  }

  async waitForChunks (timeoutMs?: number): Promise<void> {
    const bot = this.requireBot()
    const config = this.requireConfig()
    const wait = timeoutMs ?? config.chunkWaitMs
    try {
      await Promise.race([
        bot.waitForChunksToLoad(),
        new Promise<void>(resolve => setTimeout(resolve, wait))
      ])
    } catch (error) {
      this.logger.warn('movement: chunk wait failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private assertSameDimension (username: string): void {
    const bot = this.requireBot()
    const player = bot.players[username]
    const dimension = (player?.entity as { dimension?: string } | null | undefined)?.dimension
    if (dimension && bot.game?.dimension && dimension !== bot.game.dimension) {
      throw new MovementError('跨维度暂不支持')
    }
  }

  async teleportTo (x: number, y: number, z: number): Promise<void> {
    const bot = this.requireBot()
    const config = this.requireConfig()
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new MovementError('传送坐标无效')
    }
    if (!isTeleportAnchor(config, x, y, z)) {
      throw new MovementError('只能传送到基地或已配置锚点')
    }
    const command = `/tp ${config.botUsername} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`
    this.logger.info('movement teleport', { x, y, z })
    bot.chat(command)
    await this.waitForNear(x, y, z, 3, 6000)
    await this.waitForChunks(config.chunkWaitMs)
  }

  /**
   * 按玩家名传送。实体未加载或跨维度时拒绝。跟随不走这条路径。
   */
  async teleportToPlayer (username: string): Promise<void> {
    const bot = this.requireBot()
    const config = this.requireConfig()
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) throw new MovementError('目标名字无效')
    const player = bot.players[username]
    if (!player) throw new MovementError(`${username} 不在线`)
    const entity = player.entity
    if (!entity) throw new MovementError(`看不到 ${username}，请靠近一点再试`)
    this.assertSameDimension(username)
    this.logger.info('movement teleport to player', { username })
    bot.chat(`/tp ${config.botUsername} ${username}`)
    await new Promise(resolve => setTimeout(resolve, 1000))
    await this.waitForChunks()
  }

  async teleportNearPoint (x: number, y: number, z: number, radius = 4, signal?: AbortSignal): Promise<Vec3> {
    const bot = this.requireBot()
    const config = this.requireConfig()
    if (!isTeleportAnchor(config, x, y, z)) {
      throw new MovementError('只能传送到基地或已配置锚点')
    }
    await this.waitForChunks()
    signal?.throwIfAborted()
    const spot = safeSpotNear(bot, config, { x, y, z }, radius)
    if (!spot) throw new MovementError('附近找不到安全落点')
    await this.teleportTo(spot.x, spot.y, spot.z)
    return spot
  }

  /**
   * 带停滞看门狗的路径执行：pathfinder 在高低差/地形边缘可能一直“原地跳”而不 reject。
   * 位置 3.5 秒没有达到 0.05 格位移就停止路径并抛错，交给上层规划/传送兜底。
   */
  private async runPathWithWatchdog (goal: unknown, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const bot = this.requireBot()
    if (!bot.entity) throw new MovementError('还没加载好位置')
    const start = bot.entity.position.clone()
    let last = start.clone()
    let lastMovedAt = Date.now()
    const failed = Promise.withResolvers<never>()
    const abort = (): void => failed.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const stopPath = (message: string): void => {
      if (signal.aborted) return
      failed.reject(new MovementError(message))
      try {
        bot.pathfinder.stop()
        bot.pathfinder.setGoal(null)
      } catch { /* 尝试释放底层目标。 */ }
    }
    const watchdog = setInterval(() => {
      if (signal.aborted || !bot.entity) return
      const position = bot.entity.position
      if (position.distanceTo(last) >= 0.05) {
        last = position.clone()
        lastMovedAt = Date.now()
        return
      }
      if (Date.now() - lastMovedAt >= 3500) {
        this.logger.warn('movement path stuck; aborting to fallback', {
          x: Math.round(position.x),
          y: Math.round(position.y),
          z: Math.round(position.z),
          goal: start.distanceTo(position) > 0.1 ? 'progressing' : 'blocked'
        })
        stopPath('卡住了')
      }
    }, 250)
    const timeout = setTimeout(() => stopPath('走不过去'), timeoutMs)
    try {
      await Promise.race([failed.promise, bot.pathfinder.goto(goal)])
    } finally {
      signal.removeEventListener('abort', abort)
      clearInterval(watchdog)
      clearTimeout(timeout)
    }
  }

  private navWorld (bot: Bot): NavWorld {
    return {
      blockAt: (x, y, z) => {
        const block = bot.blockAt(new Vec3(x, y, z), false)
        if (!block) return null
        const shapes = Array.isArray(block.shapes) ? block.shapes.map(shape => [...shape]) : []
        const properties = typeof block.getProperties === 'function' ? block.getProperties() : null
        const open = properties && typeof properties.open === 'boolean' ? properties.open : undefined
        return {
          name: block.name,
          boundingBox: block.boundingBox ?? 'empty',
          shapes,
          open
        }
      }
    }
  }

  private navArea (bot: Bot, target: NavVector): NavArea {
    const config = this.requireConfig()
    const radius = config.pathOutsideSafeRadius
    const position = bot.entity?.position ?? target
    return {
      minX: Math.floor(Math.min(position.x, target.x) - radius),
      maxX: Math.ceil(Math.max(position.x, target.x) + radius),
      minZ: Math.floor(Math.min(position.z, target.z) - radius),
      maxZ: Math.ceil(Math.max(position.z, target.z) + radius),
      minY: -64,
      maxY: 320
    }
  }

  private executorBot (bot: Bot, signal: AbortSignal): ExecutorBot {
    return {
      get entity () {
        return bot.entity ? { position: bot.entity.position } : null
      },
      lookAt: (point, force) => signal.aborted ? Promise.resolve() : bot.lookAt(point, force),
      setControlState: (control, state) => { if (!signal.aborted) bot.setControlState(control, state) },
      clearControlStates: () => { if (!signal.aborted) bot.clearControlStates() },
      controlState: () => ({ ...bot.controlState }),
      onGround: () => bot.entity?.onGround === true,
      velocity: () => bot.entity ? { x: bot.entity.velocity.x, y: bot.entity.velocity.y, z: bot.entity.velocity.z } : { x: 0, y: 0, z: 0 },
      physicsEnabled: () => bot.physicsEnabled,
      blockAtFeet: () => {
        if (!bot.entity) return null
        const block = bot.blockAt(bot.entity.position)
        return block ? block.name : null
      },
      forceGround: () => { if (!signal.aborted) this.refreshGround(bot) },
      getControlState: control => bot.getControlState(control),
      blockAt: (x, y, z) => this.navWorld(bot).blockAt(x, y, z),
      activatePassage: async (x, y, z) => {
        if (signal.aborted) return
        const block = bot.blockAt(new Vec3(x, y, z), false)
        if (!block) return
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true)
        await bot.activateBlock(block)
      }
    }
  }

  /**
   * 传送/重连后 mineflayer 可能保留 onGround=false，导致跳跃键被物理层忽略。
   * 只在脚下确实有完整方块且脚底贴近方块顶面时纠正；不改变真实空中状态。
   */
  private refreshGround (bot: Bot): void {
    const position = bot.entity?.position
    if (!position) return
    const entity = bot.entity as { jumpTicks?: number }
    if (typeof entity.jumpTicks === 'number') entity.jumpTicks = 0
    if (bot.entity.onGround) return
    const x = Math.floor(position.x)
    const y = Math.floor(position.y)
    const z = Math.floor(position.z)
    const below = bot.blockAt(new Vec3(x, y - 1, z))
    if (below && below.boundingBox === 'block' && position.y - y <= 0.25) {
      bot.entity.onGround = true
    }
  }

  private reachedTarget (bot: Bot, target: NavVector, tolerance: number): boolean {
    const position = bot.entity?.position
    if (!position) return false
    return Math.hypot(position.x - target.x, position.z - target.z) <= Math.max(1.2, tolerance + 0.8) &&
      Math.abs(position.y - target.y) <= 0.7
  }

  private classifyPathFailure (error: unknown): RouteFailureKind {
    const message = error instanceof Error ? error.message : String(error)
    if (/NoPath|no path/i.test(message)) return 'no_path'
    if (/Timeout|timeout|太久|走不过去/i.test(message)) return 'timeout'
    if (/卡住|stuck/i.test(message)) return 'path_stuck'
    return 'unreachable'
  }

  /**
   * 受控执行期间临时摘掉 pathfinder 的 physicsTick 监控，避免它每 tick 覆写手动控制键。
   * 仅在同一次导航调用内挂起，finally 恢复；失败路径也不会留下状态。
   */
  private suspendPathfinderMonitor (bot: Bot): () => void {
    const listeners = bot.listeners('physicsTick') as Array<() => void>
    const monitors = listeners.filter(listener => listener.name === 'monitorMovement')
    for (const listener of monitors) bot.removeListener('physicsTick', listener)
    const restore = (): void => {
      if (this.restoreMonitor !== restore) return
      this.restoreMonitor = null
      for (const listener of monitors) bot.on('physicsTick', listener)
    }
    this.restoreMonitor = restore
    return restore
  }

  private async tryPlannerRoute (
    bot: Bot,
    target: NavVector,
    tolerance: number,
    allowOutsideSafeZone: boolean,
    signal: AbortSignal
  ): Promise<{ ok: boolean, failure: RouteFailureKind, reason: string }> {
    const config = this.requireConfig()
    if (!config.pathPlannerEnabled) {
      return { ok: false, failure: 'no_path', reason: 'planner_disabled' }
    }
    // 清空 pathfinder 目标，避免旧路径物理循环覆盖受控执行的控制键。
    try {
      bot.pathfinder.setGoal(null)
    } catch {
      // ignore
    }
    this.refreshGround(bot)
    const world = this.navWorld(bot)
    const area = this.navArea(bot, target)
    const position = bot.entity?.position
    if (!position) return { ok: false, failure: 'unreachable', reason: 'entity_unavailable' }
    const plan = planRoute(
      world,
      area,
      { x: position.x, y: position.y, z: position.z },
      target,
      tolerance,
      { timeoutMs: config.pathPlannerTimeoutMs, maxNodes: config.pathPlannerMaxNodes }
    )
    if (plan.status !== 'success') {
      const failure: RouteFailureKind = plan.status === 'timeout' ? 'timeout' : 'no_path'
      this.recordFailure('planner', failure, plan.reason ?? plan.status, plan.nodesVisited)
      this.logger.warn('movement planner failed', {
        status: plan.status,
        reason: plan.reason,
        nodes: plan.nodesVisited,
        target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) }
      })
      return { ok: false, failure, reason: plan.reason ?? plan.status }
    }
    this.updateNavigation({ state: 'executing', source: 'planner', attempts: this.navigation.attempts + 1 })
    this.logger.info('movement planner route', {
      waypoints: plan.waypoints.map(point => `${point.x},${point.y},${point.z}`).slice(0, 12),
      nodes: plan.nodesVisited,
      start: bot.entity ? {
        x: Math.round(bot.entity.position.x * 10) / 10,
        y: Math.round(bot.entity.position.y * 10) / 10,
        z: Math.round(bot.entity.position.z * 10) / 10
      } : null,
      target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) }
    })
    const restore = this.suspendPathfinderMonitor(bot)
    let result: RouteExecutionResult
    try {
      result = await this.executor.run(
        this.executorBot(bot, signal),
        plan.waypoints.map(point => ({ x: point.x, y: point.y, z: point.z })),
        {
          isCancelled: () => signal.aborted,
          totalMs: Math.max(8000, plan.waypoints.length * 2500)
        }
      )
    } finally {
      restore()
    }
    signal.throwIfAborted()
    if (result.status !== 'arrived') {
      const failure: RouteFailureKind = result.status === 'timeout' ? 'timeout' : 'path_stuck'
      this.recordFailure('planner', failure, result.reason)
      this.logger.warn('movement planner executor failed', { status: result.status, reason: result.reason })
      return { ok: false, failure, reason: result.reason ?? result.status }
    }
    const reached = this.reachedTarget(bot, target, tolerance)
    if (!reached) {
      this.recordFailure('planner', 'unreachable', 'final_position_mismatch')
      return { ok: false, failure: 'unreachable', reason: 'final_position_mismatch' }
    }
    this.updateNavigation({ state: 'idle', source: 'planner', lastFailureKind: null })
    return { ok: true, failure: 'no_path', reason: '' }
  }

  private async tryAiRoute (
    bot: Bot,
    target: NavVector,
    tolerance: number,
    allowOutsideSafeZone: boolean,
    failure: RouteFailureKind,
    signal: AbortSignal
  ): Promise<boolean> {
    const config = this.requireConfig()
    const advisor = this.advisor
    if (!advisor || !config.pathAiEnabled || !advisor.available) return false
    if (Date.now() - this.lastAiAt < config.pathAiCooldownMs) return false
    this.lastAiAt = Date.now()
    const position = bot.entity?.position
    if (!position) return false
    const world = this.navWorld(bot)
    const area = this.navArea(bot, target)
    this.updateNavigation({ state: 'planning', source: 'ai', aiUsed: true })
    try {
      const advice = await advisor.suggest({
        start: { x: position.x, y: position.y, z: position.z },
        target,
        failure,
        bounds: area,
        allowOutsideSafeZone: true,
        terrain: buildTerrainSummary(world, area, { x: position.x, y: position.y, z: position.z })
      })
      signal.throwIfAborted()
      if (!advice || advice.waypoints.length === 0) {
        this.recordFailure('ai', 'ai_invalid', 'empty_advice')
        return false
      }
      if (advice.waypoints.length > 3) {
        this.recordFailure('ai', 'ai_invalid', 'too_many_waypoints')
        return false
      }
      let cursor = { x: position.x, y: position.y, z: position.z }
      const waypoints: NavVector[] = []
      for (const point of advice.waypoints) {
        const rounded = { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) }
        if (!canStand(world, area, rounded.x, rounded.y, rounded.z)) {
          this.recordFailure('ai', 'ai_invalid', 'waypoint_not_standable')
          return false
        }
        const plan = planRoute(world, area, cursor, rounded, 0, {
          timeoutMs: config.pathPlannerTimeoutMs,
          maxNodes: config.pathPlannerMaxNodes
        })
        if (plan.status !== 'success') {
          this.recordFailure('ai', 'ai_invalid', 'waypoint_unreachable')
          return false
        }
        waypoints.push(...plan.waypoints)
        cursor = rounded
      }
      const finalPlan = planRoute(world, area, cursor, target, tolerance, {
        timeoutMs: config.pathPlannerTimeoutMs,
        maxNodes: config.pathPlannerMaxNodes
      })
      if (finalPlan.status !== 'success') {
        this.recordFailure('ai', 'ai_invalid', 'final_unreachable')
        return false
      }
      waypoints.push(...finalPlan.waypoints)
      this.updateNavigation({ state: 'executing', source: 'ai' })
      const result = await this.executor.run(this.executorBot(bot, signal), waypoints, {
        isCancelled: () => signal.aborted,
        totalMs: Math.max(8000, waypoints.length * 1800)
      })
      signal.throwIfAborted()
      if (result.status !== 'arrived') {
        this.recordFailure('ai', result.status === 'timeout' ? 'ai_timeout' : 'path_stuck', result.reason)
        return false
      }
      if (!this.reachedTarget(bot, target, tolerance)) {
        this.recordFailure('ai', 'unreachable', 'final_position_mismatch')
        return false
      }
      this.updateNavigation({ state: 'idle', source: 'ai', lastFailureKind: null })
      this.logger.info('movement ai route reached', { waypoints: waypoints.length })
      return true
    } catch (error) {
      signal.throwIfAborted()
      this.recordFailure('ai', 'ai_timeout', error instanceof Error ? error.message : String(error))
      this.logger.warn('movement ai advisor failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /**
   * 统一导航：pathfinder 快速路径 → 确定性 A* → 受控执行 → AI 路点 → 停止。
   * 寻路失败不传送到目标点。锚点传送和濒危回基地走各自的入口。
   */
  private async navigateTo (
    target: NavVector,
    tolerance: number,
    allowOutsideSafeZone: boolean,
    allowTeleport: boolean,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<void> {
    const bot = this.requireBot()
    const config = this.requireConfig()
    signal.throwIfAborted()
    this.updateNavigation({
      state: 'planning',
      source: 'pathfinder',
      attempts: 0,
      lastFailureKind: null,
      lastFallback: null,
      lastFallbackReason: null,
      aiUsed: false
    })
    let failure: RouteFailureKind = 'path_stuck'
    let reason = ''
    try {
      this.refreshGround(bot)
      await this.runPathWithWatchdog(
        new goals.GoalNear(target.x, target.y, target.z, Math.max(1, tolerance)),
        Math.min(timeoutMs, 30000),
        signal
      )
      signal.throwIfAborted()
      if (!this.reachedTarget(bot, target, tolerance)) {
        // pathfinder 在 3D GoalNear 的半径内可能停在一格下方；交给确定性规划器补齐高度。
        throw new MovementError('到达位置高度不精确')
      }
      this.updateNavigation({ state: 'idle', source: 'pathfinder', lastFailureKind: null })
      return
    } catch (error) {
      signal.throwIfAborted()
      failure = this.classifyPathFailure(error)
      reason = error instanceof Error ? error.message : String(error)
      this.recordFailure('pathfinder', failure, reason)
      this.logger.warn('movement pathfinder failed; trying deterministic planner', {
        x: Math.round(target.x),
        y: Math.round(target.y),
        z: Math.round(target.z),
        reason
      })
    }

    for (let attempt = 0; attempt <= config.pathMaxReplans; attempt += 1) {
      signal.throwIfAborted()
      const planner = await this.tryPlannerRoute(bot, target, tolerance, allowOutsideSafeZone, signal)
      signal.throwIfAborted()
      if (planner.ok) return
      failure = planner.failure
      reason = planner.reason
      if (planner.failure === 'no_path') break
      await this.waitForChunks()
    }

    signal.throwIfAborted()
    if (await this.tryAiRoute(bot, target, tolerance, allowOutsideSafeZone, failure, signal)) return
    signal.throwIfAborted()
    void allowTeleport
    void config.pathTeleportFallback
    const fallbackReason = reason.slice(0, 160)
    this.updateNavigation({
      state: 'fallback',
      source: 'stopped',
      lastFallback: 'stopped',
      lastFallbackReason: fallbackReason,
      lastFailureKind: failure
    })
    this.notify?.('我找不到规范路径，先停在这里。')
    this.fallbackListener?.('stopped', fallbackReason)
    throw new MovementError(`走不过去：${reason}`)
  }

  async goNearPoint (
    x: number,
    y: number,
    z: number,
    radius = 2,
    timeoutMs = 15000,
    allowTeleport = true
  ): Promise<void> {
    const operation = this.begin('task')
    try {
      await this.navigateTo({ x, y, z }, radius, true, false, timeoutMs, operation.signal)
    } finally {
      this.end(operation)
    }
    void allowTeleport
  }

  /**
   * 血量到达濒危线时调用。已在家附近、未连接或开关关闭时不传送。
   */
  noteHealth (): void {
    const bot = this.bot
    const config = this.config
    if (!bot?.entity || !config || config.criticalHealth <= 0 || this.criticalBusy) return
    if (!Number.isFinite(bot.health) || bot.health <= 0 || bot.health > config.criticalHealth) return
    const position = bot.entity.position
    const home = config.home
    if (Math.hypot(position.x - home.x, position.y - home.y, position.z - home.z) <= 4) return
    this.criticalBusy = true
    const health = bot.health
    void this.criticalTeleportHome(health).finally(() => {
      this.criticalBusy = false
    })
  }

  private async criticalTeleportHome (health: number): Promise<void> {
    const config = this.requireConfig()
    this.stop('critical')
    this.logger.warn('movement critical teleport home', { health })
    this.criticalListener?.(health)
    this.notify?.('血量太低，我先回基地。')
    await this.teleportTo(config.home.x, config.home.y, config.home.z)
  }

  async home (): Promise<void> {
    const config = this.requireConfig()
    const home = config.home
    await this.goNearPoint(home.x, home.y, home.z, 1, 30000, false)
  }

  async comeTo (username: string, timeoutMs = 30000): Promise<'arrived' | 'cancelled'> {
    const bot = this.requireBot()
    this.assertSameDimension(username)
    const target = targetFor(bot, username)
    if (!target?.entity) {
      throw new MovementError(`看不到 ${username}，请靠近一点再试`)
    }
    const entity = target.entity
    const distance = bot.entity ? bot.entity.position.distanceTo(entity.position) : Number.POSITIVE_INFINITY
    if (distance > this.requireConfig().teleportDistance) {
      await this.teleportToPlayer(username)
      return 'arrived'
    }
    const operation = this.begin('come')
    this.logger.info('movement come start', { target: username, timeoutMs })
    try {
      await this.navigateTo(
        { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        2,
        true,
        true,
        timeoutMs,
        operation.signal
      )
      if (operation.signal.aborted) return 'cancelled'
      this.logger.debug('movement come reached', { target: username })
      return 'arrived'
    } catch (error) {
      if (operation.signal.aborted) return 'cancelled'
      if (error instanceof MovementError) throw error
      throw new MovementError(`移动失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.end(operation)
    }
  }

  follow (username: string, maxMs = 600000): void {
    const bot = this.requireBot()
    try {
      this.assertSameDimension(username)
    } catch (error) {
      this.notify?.(error instanceof Error ? error.message : String(error))
      throw error
    }
    const target = targetFor(bot, username)
    if (!target?.entity) {
      throw new MovementError(`看不到 ${username}，请靠近一点再试`)
    }
    const operation = this.begin('follow')
    this.followedName = username
    this.logger.info('movement follow start', { target: username })
    void this.followLoop(username, maxMs, operation)
  }

  private async followLoop (username: string, maxMs: number, operation: AbortController): Promise<void> {
    const startedAt = Date.now()
    try {
      while (!operation.signal.aborted) {
        if (Date.now() - startedAt > maxMs) {
          this.notify?.(`跟了 ${Math.round(maxMs / 60000)} 分钟了，我先歇一下。`)
          return
        }
        const bot = this.bot
        if (!bot) return
        const target = targetFor(bot, username)
        if (!target?.entity) {
          this.notify?.(`${username} 不在了，我先停下。`)
          return
        }
        const entity = target.entity
        const distance = bot.entity ? bot.entity.position.distanceTo(entity.position) : 0
        if (distance > 3) {
          try {
            await this.navigateTo(
              { x: entity.position.x, y: entity.position.y, z: entity.position.z },
              2,
              true,
              false,
              12000,
              operation.signal
            )
          } catch (error) {
            if (operation.signal.aborted) return
            this.notify?.('我找不到过去的路，先停下跟随。')
            this.logger.warn('movement follow failed', {
              error: error instanceof Error ? error.message : String(error)
            })
            return
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    } finally {
      this.end(operation)
    }
  }

  stop (reason = 'user'): void {
    this.operation?.abort(new MovementError('移动已取消'))
    this.operation = null
    this.restoreMonitor?.()
    this.current = null
    this.followedName = null
    const bot = this.bot
    if (bot) {
      try {
        bot.pathfinder.stop()
        // pathfinder.stop() only sets a flag; force the reset so a following
        // goto() does not immediately reject with PathStopped.
        bot.pathfinder.setGoal(null)
        bot.clearControlStates()
      } catch {
        // ignore
      }
    }
    this.logger.info('movement stop', { reason })
  }

  async lookAt (username: string): Promise<void> {
    const bot = this.requireBot()
    const target = this.requireTarget(username)
    const entity = target.entity
    if (!entity) throw new MovementError(`看不到 ${username}`)
    await bot.lookAt(entity.position.offset(0, 1.6, 0), true)
  }

  async wave (): Promise<void> {
    const bot = this.requireBot()
    bot.swingArm('right')
    await new Promise(resolve => setTimeout(resolve, 300))
    bot.swingArm('right')
  }
}
