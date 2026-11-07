import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Logger } from '../../src/logger.ts'
import { Defender } from '../../src/combat/defender.ts'
import type { AuditLogger } from '../../src/audit.ts'
import { MovementManager } from '../../src/minecraft/movement.ts'
import { columnsWithinRadius, isTeleportAnchor } from '../../src/tasks/navigation.ts'
import { scanExposedOres } from '../../src/tasks/resources.ts'
import { makeConfig } from '../helpers.ts'

const logger: Logger = {
  debug () {},
  info () {},
  warn () {},
  error () {},
  withScope () { return logger }
}

test('v1.0.10 扫描列有上界，超大半径被截到 64', () => {
  const columns = columnsWithinRadius({ x: 0, z: 0 }, 32)
  assert.ok(columns.length < 4000)
  assert.ok(columns.some(column => column.x === 32 && column.z === 0))
  assert.equal(columns.some(column => column.x === 40), false)
  const capped = columnsWithinRadius({ x: 0, z: 0 }, 1000)
  assert.equal(capped.some(column => Math.abs(column.x) > 64 || Math.abs(column.z) > 64), false)
})

test('v1.0.10 任意坐标不能传送，家和锚点可以', async () => {
  const config = makeConfig()
  assert.equal(isTeleportAnchor(config, config.home.x, config.home.y, config.home.z), true)
  assert.equal(isTeleportAnchor(config, 1, 64, 1), false)
  assert.equal(isTeleportAnchor(config, config.fishStand.x, config.fishStand.y, config.fishStand.z), true)
  const movement = new MovementManager(logger, config)
  const chats: string[] = []
  ;(movement as unknown as { bot: Bot }).bot = {
    entity: { position: new Vec3(175, 64, 410) },
    chat (line: string) { chats.push(line) },
    pathfinder: { stop () {}, setGoal () {} },
    clearControlStates () {}
  } as unknown as Bot
  await assert.rejects(() => movement.teleportTo(1, 64, 1), /只能传送到基地或已配置锚点/)
  assert.deepEqual(chats, [])
})

test('v1.0.10 旧矩形外可以行走', async () => {
  const config = makeConfig({
    safeZone: { minX: 111, maxX: 239, minZ: 410, maxZ: 474 }
  })
  const movement = new MovementManager(logger, config)
  const chats: string[] = []
  const here = new Vec3(500, 64, 500)
  ;(movement as unknown as { bot: Bot }).bot = {
    entity: { position: here, onGround: true },
    pathfinder: { goto: async () => undefined, stop () {}, setGoal () {} },
    clearControlStates () {},
    chat (line: string) { chats.push(line) },
    blockAt () { return null }
  } as unknown as Bot
  await movement.goNearPoint(500, 64, 500, 2, 1000, true)
  assert.deepEqual(chats, [])
})

test('v1.0.10 寻路失败停在原地，不传送到任意目标', async () => {
  const config = makeConfig({
    pathPlannerEnabled: false,
    pathAiEnabled: false,
    safeZone: { minX: 111, maxX: 239, minZ: 410, maxZ: 474 }
  })
  const movement = new MovementManager(logger, config)
  const chats: string[] = []
  ;(movement as unknown as { bot: Bot }).bot = {
    entity: { position: new Vec3(500, 64, 500), onGround: true },
    pathfinder: {
      goto: async () => { throw new Error('NoPath') },
      stop () {},
      setGoal () {}
    },
    clearControlStates () {},
    chat (line: string) { chats.push(line) },
    blockAt () { return null },
    listeners () { return [] }
  } as unknown as Bot
  await assert.rejects(() => movement.goNearPoint(520, 64, 520, 2, 1000, true), /走不过去/)
  assert.deepEqual(chats, [])
})

test('v1.0.10 防御仍看见旧矩形外的敌对生物', () => {
  const config = makeConfig({
    safeZone: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    defenseRadius: 16,
    defenseTargets: ['zombie']
  })
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    health: 20,
    food: 20,
    entities: {
      1: { id: 1, type: 'hostile', name: 'zombie', position: new Vec3(8, 64, 0) }
    },
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
})

test('v1.0.10 挖矿扫描不到半径外的矿', () => {
  const config = makeConfig({
    mining: { ...makeConfig().mining, minY: 60, maxY: 61, protectRadius: 0 }
  })
  const blocks = new Map<string, string>([
    ['200,60,5', 'coal_ore'],
    ['200,61,5', 'air']
  ])
  const bot = {
    entity: { position: new Vec3(5, 65, 5) },
    players: {},
    blockAt: (point: Vec3) => ({ name: blocks.get(`${point.x},${point.y},${point.z}`) ?? 'air' })
  } as unknown as Bot
  assert.equal(scanExposedOres(bot, config).length, 0)
})

test('v1.0.10 濒危只传送回基地', async () => {
  const config = makeConfig({
    botUsername: 'lofii',
    criticalHealth: 6,
    home: { x: 10, y: 64, z: 10 }
  })
  const chats: string[] = []
  const healthLog: number[] = []
  const movement = new MovementManager(logger, config)
  movement.setCriticalListener(health => { healthLog.push(health) })
  const bot = {
    health: 4,
    entity: { position: new Vec3(80, 64, 80) },
    chat (line: string) {
      chats.push(line)
      bot.entity.position = new Vec3(10, 64, 10)
    },
    pathfinder: { stop () {}, setGoal () {} },
    clearControlStates () {},
    waitForChunksToLoad: async () => undefined
  }
  ;(movement as unknown as { bot: Bot }).bot = bot as unknown as Bot
  movement.noteHealth()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(chats, ['/tp lofii 10.00 64.00 10.00'])
  assert.deepEqual(healthLog, [4])
  movement.noteHealth()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(chats.length, 1)
})
