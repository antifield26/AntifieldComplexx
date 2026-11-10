import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Logger } from '../../src/logger.ts'
import type { AuditLogger } from '../../src/audit.ts'
import { Defender, bestWeaponName, mobIsAttacking } from '../../src/combat/defender.ts'
import type { MovementManager } from '../../src/minecraft/movement.ts'
import { RouteExecutor, passageColumn } from '../../src/minecraft/routing/executor.ts'
import { planRoute } from '../../src/minecraft/routing/planner.ts'
import type { NavArea, NavBlock, NavWorld } from '../../src/minecraft/routing/types.ts'
import { chooseFoodReflex, droppedItemName } from '../../src/tasks/food-reflex.ts'
import type { TaskContext } from '../../src/tasks/types.ts'
import { makeConfig } from '../helpers.ts'

const logger: Logger = {
  debug () {},
  info () {},
  warn () {},
  error () {},
  withScope () { return logger }
}

const AIR: NavBlock = { name: 'air', boundingBox: 'empty', shapes: [] }
const STONE: NavBlock = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
const LADDER: NavBlock = { name: 'ladder', boundingBox: 'empty', shapes: [] }
const AREA: NavArea = { minX: -2, maxX: 12, minZ: -2, maxZ: 2, minY: 55, maxY: 90 }

class FakeWorld implements NavWorld {
  readonly blocks = new Map<string, NavBlock>()

  set (x: number, y: number, z: number, block: NavBlock): void {
    this.blocks.set(`${x},${y},${z}`, block)
  }

  blockAt (x: number, y: number, z: number): NavBlock | null {
    return this.blocks.get(`${x},${y},${z}`) ?? AIR
  }
}

function floor (world: FakeWorld, x: number, z: number, y: number): void {
  world.set(x, y, z, STONE)
  world.set(x, y + 1, z, AIR)
  world.set(x, y + 2, z, AIR)
}

test('v1.0.11 武器选择：更好的剑优先，没有武器就空手', () => {
  assert.equal(bestWeaponName(['wooden_sword', 'diamond_sword', 'iron_axe']), 'diamond_sword')
  assert.equal(bestWeaponName(['stone_axe']), 'stone_axe')
  assert.equal(bestWeaponName([]), null)
})

test('v1.0.11 女巫只有正在攻击时才算威胁', () => {
  const bot = { id: 7, position: { x: 0, z: 0 } }
  assert.equal(mobIsAttacking({ position: { x: 3, z: 0 } }, bot), false)
  assert.equal(mobIsAttacking({ attacking: true, position: { x: 3, z: 0 } }, bot), true)
  assert.equal(mobIsAttacking({ attackTarget: 7, position: { x: 3, z: 0 } }, bot), true)
  const yaw = Math.PI / 2
  assert.equal(mobIsAttacking({ yaw, position: { x: 3, z: 0 } }, bot), true)
})

test('v1.0.11 防御看见空手可打的怪，跳过苦力怕、末影人、玩家和没攻击的女巫', () => {
  const config = makeConfig({
    defenseRadius: 12,
    defenseTargets: ['zombie']
  })
  const entities: Record<number, unknown> = {
    1: { id: 1, type: 'hostile', name: 'zombie', position: new Vec3(2, 64, 0), health: 20 }
  }
  const bot = {
    entity: { id: 9, position: new Vec3(0, 64, 0) },
    health: 20,
    food: 20,
    entities,
    inventory: { items: () => [] }
  } as unknown as Bot
  const defender = new Defender({
    config,
    logger,
    movement: {} as MovementManager,
    audit: { append: () => {} } as unknown as AuditLogger,
    getBot: () => bot
  })
  assert.equal(defender.hasThreat(), true)
  bot.entities = {
    2: { id: 2, type: 'hostile', name: 'creeper', position: new Vec3(2, 64, 0) },
    3: { id: 3, type: 'hostile', name: 'enderman', position: new Vec3(2, 64, 0) },
    4: { id: 4, type: 'player', name: 'Antifield', position: new Vec3(1, 64, 0) },
    5: { id: 5, type: 'hostile', name: 'witch', position: new Vec3(2, 64, 0), attacking: false }
  } as never
  assert.equal(defender.hasThreat(), false)
  bot.entities = {
    5: { id: 5, type: 'hostile', name: 'witch', position: new Vec3(2, 64, 0), attacking: true }
  } as never
  assert.equal(defender.hasThreat(), true)
})

test('v1.0.11 没有铁剑时仍近战，不撤退', async () => {
  const config = makeConfig({ defenseRadius: 12, defenseTargets: ['zombie'] })
  const zombie = { id: 1, type: 'hostile', name: 'zombie', position: new Vec3(2, 64, 0), health: 20 }
  let attacks = 0
  let homeCalls = 0
  const bot = {
    entity: { id: 9, position: new Vec3(0, 64, 0) },
    health: 20,
    food: 20,
    entities: { 1: zombie },
    inventory: { items: () => [], slots: [] },
    heldItem: null,
    lookAt: async () => {},
    equip: async () => {},
    consume: async () => {},
    attack () {
      attacks += 1
      zombie.health = 0
    }
  } as unknown as Bot
  const progress = { mobsKilled: 0 }
  const ctx = {
    signal: new AbortController().signal,
    progress,
    updateProgress (patch: { mobsKilled?: number }) {
      if (typeof patch.mobsKilled === 'number') progress.mobsKilled = patch.mobsKilled
    },
    say: async () => {}
  } as unknown as TaskContext
  const defender = new Defender({
    config,
    logger,
    movement: {
      goNearPoint: async () => {},
      home: async () => { homeCalls += 1 },
      noteHealth () {}
    } as unknown as MovementManager,
    audit: { append: () => {} } as unknown as AuditLogger,
    getBot: () => bot
  })
  const outcome = await defender.defend(ctx)
  assert.equal(outcome, 'cleared')
  assert.equal(attacks, 1)
  assert.equal(homeCalls, 0)
  assert.equal(progress.mobsKilled, 1)
})

test('已装备护甲和副手盾牌时，准备防御不绕去补给箱', async () => {
  const config = makeConfig()
  const sword = { name: 'iron_sword', type: 1 }
  const slots = Array.from<{ name: string } | null>({ length: 46 }).fill(null)
  slots[5] = { name: 'iron_helmet' }
  slots[6] = { name: 'iron_chestplate' }
  slots[7] = { name: 'iron_leggings' }
  slots[8] = { name: 'iron_boots' }
  slots[45] = { name: 'shield' }
  const bot = {
    entity: { id: 9, position: new Vec3(0, 64, 0) },
    heldItem: sword,
    inventory: { items: () => [sword], slots }
  } as unknown as Bot
  let supplyChecks = 0
  const movement = {
    waitForChunks: async () => {
      supplyChecks++
      throw new Error('夹具不提供补给箱')
    }
  } as unknown as MovementManager
  const defender = new Defender({
    config,
    logger,
    movement,
    audit: { append: () => {} } as unknown as AuditLogger,
    getBot: () => bot
  })
  await defender.prepare({
    config, logger, movement, getBot: () => bot, signal: new AbortController().signal
  } as TaskContext)
  assert.equal(supplyChecks, 0)
})

test('v1.0.11 规划器可以沿梯子向上', () => {
  const world = new FakeWorld()
  floor(world, 0, 0, 63)
  world.set(1, 63, 0, STONE)
  for (let y = 64; y <= 67; y += 1) world.set(1, y, 0, LADDER)
  const result = planRoute(world, AREA, { x: 0.5, y: 64, z: 0.5 }, { x: 1.5, y: 67, z: 0.5 }, 1, {
    timeoutMs: 1500,
    maxNodes: 4000
  })
  assert.equal(result.status, 'success')
  assert.ok(result.waypoints.some(point => point.x === 1 && point.y === 67))
})

test('v1.0.11 木门可穿过，铁门失败并写明 iron_door', () => {
  const wooden = new FakeWorld()
  const iron = new FakeWorld()
  for (const world of [wooden, iron]) {
    for (let x = 0; x <= 4; x += 1) {
      floor(world, x, 0, 63)
      world.set(x, 64, 1, STONE)
      world.set(x, 65, 1, STONE)
      world.set(x, 64, -1, STONE)
      world.set(x, 65, -1, STONE)
    }
  }
  const door: NavBlock = { name: 'oak_door', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], open: false }
  wooden.set(2, 64, 0, door)
  wooden.set(2, 65, 0, door)
  const ironDoor: NavBlock = { name: 'iron_door', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
  iron.set(2, 64, 0, ironDoor)
  iron.set(2, 65, 0, ironDoor)
  const options = { timeoutMs: 1500, maxNodes: 4000 }
  const woodPlan = planRoute(wooden, AREA, { x: 0.5, y: 64, z: 0.5 }, { x: 4.5, y: 64, z: 0.5 }, 1, options)
  const ironPlan = planRoute(iron, AREA, { x: 0.5, y: 64, z: 0.5 }, { x: 4.5, y: 64, z: 0.5 }, 1, options)
  assert.equal(woodPlan.status, 'success')
  assert.equal(ironPlan.status, 'no_path')
  assert.equal(ironPlan.reason, 'iron_door')
})

test('v1.0.11 执行器打开关着的木门，铁门停下且不交互', async () => {
  const closed: NavBlock = { name: 'oak_door', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], open: false }
  const opened: NavBlock = { name: 'oak_fence_gate', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], open: true }
  const iron: NavBlock = { name: 'iron_trapdoor', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.2, 1]] }
  assert.equal(passageColumn(closed, AIR), 'feet')
  assert.equal(passageColumn(opened, AIR), 'clear')
  assert.equal(passageColumn(iron, AIR), 'iron')
  const executor = new RouteExecutor()
  const activated: string[] = []
  const arrived = await executor.run({
    entity: { position: new Vec3(1.5, 64, 0.5) },
    lookAt: async () => {},
    setControlState () {},
    clearControlStates () {},
    blockAt: () => closed,
    activatePassage: async (x, y, z) => { activated.push(`${x},${y},${z}`) }
  }, [{ x: 1, y: 64, z: 0 }], { isCancelled: () => false })
  assert.equal(arrived.status, 'arrived')
  assert.deepEqual(activated, ['1,64,0'])
  const blocked = await executor.run({
    entity: { position: new Vec3(1.5, 64, 0.5) },
    lookAt: async () => {},
    setControlState () {},
    clearControlStates () {},
    blockAt: () => iron,
    activatePassage: async () => { activated.push('iron') }
  }, [{ x: 1, y: 64, z: 0 }], { isCancelled: () => false })
  assert.equal(blocked.status, 'stuck')
  assert.equal(blocked.reason, 'iron_door')
  assert.equal(activated.includes('iron'), false)
})

test('v1.0.11 找食顺序：吃、捡、箱、任务，不饿就停', () => {
  assert.equal(chooseFoodReflex({
    hungry: true, inventoryFood: 2, nearbyDrops: 1, triedPickup: false, triedChest: false, triedTask: false
  }), 'eat')
  assert.equal(chooseFoodReflex({
    hungry: true, inventoryFood: 0, nearbyDrops: 1, triedPickup: false, triedChest: false, triedTask: false
  }), 'pickup')
  assert.equal(chooseFoodReflex({
    hungry: true, inventoryFood: 0, nearbyDrops: 1, triedPickup: true, triedChest: false, triedTask: false
  }), 'chest')
  assert.equal(chooseFoodReflex({
    hungry: true, inventoryFood: 0, nearbyDrops: 0, triedPickup: true, triedChest: true, triedTask: false
  }), 'task')
  assert.equal(chooseFoodReflex({
    hungry: false, inventoryFood: 0, nearbyDrops: 3, triedPickup: false, triedChest: false, triedTask: false
  }), 'done')
  assert.equal(droppedItemName({ name: 'item', getDroppedItem: () => ({ name: 'bread' }) }), 'bread')
  assert.equal(droppedItemName({ name: 'zombie' }), null)
})
