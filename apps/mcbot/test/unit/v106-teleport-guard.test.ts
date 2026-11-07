import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Logger } from '../../src/logger.ts'
import { MovementManager } from '../../src/minecraft/movement.ts'
import { makeConfig } from '../helpers.ts'

const logger: Logger = {
  debug () {},
  info () {},
  warn () {},
  error () {},
  withScope () { return logger }
}

function attachBot (movement: MovementManager, bot: Bot): void {
  ;(movement as unknown as { bot: Bot }).bot = bot
}

test('取消旧路径后可立即回家，旧收尾不取消新路径', async () => {
  const config = makeConfig({
    home: { x: 5, y: 64, z: 5 },
    safeZone: { minX: 0, maxX: 32, minZ: 0, maxZ: 32 }
  })
  const movement = new MovementManager(logger, config)
  const old = Promise.withResolvers<void>()
  const next = Promise.withResolvers<void>()
  const calls = [old.promise, next.promise]
  const chats: string[] = []
  attachBot(movement, {
    entity: { position: new Vec3(5, 64, 5), onGround: true },
    pathfinder: { goto: () => calls.shift(), stop () {}, setGoal () {} },
    clearControlStates () {},
    chat (text: string) { chats.push(text) }
  } as unknown as Bot)
  const first = movement.home()
  movement.stop('test')
  const second = movement.home()
  await assert.rejects(first, /移动已取消/)
  assert.equal(movement.isBusy(), true)
  old.resolve()
  next.resolve()
  await second
  assert.equal(movement.isBusy(), false)
  assert.deepEqual(chats, [])
})

test('v1.0.6 传送：看不到实体时过来/跟随/按名传送都不发 /tp', async () => {
  const chats: string[] = []
  const config = makeConfig({
    botUsername: 'lofii',
    safeZone: { minX: 0, maxX: 32, minZ: 0, maxZ: 32 }
  })
  const movement = new MovementManager(logger, config)
  const bot = {
    players: { Far: { username: 'Far', entity: undefined } },
    game: { dimension: 'minecraft:overworld' },
    chat (line: string) { chats.push(line) }
  } as unknown as Bot
  attachBot(movement, bot)
  await assert.rejects(() => movement.comeTo('Far'), /看不到 Far/)
  await assert.rejects(() => movement.teleportToPlayer('Far'), /看不到 Far/)
  assert.throws(() => movement.follow('Far'), /看不到 Far/)
  assert.deepEqual(chats, [])
})

test('v1.0.10 传送：已加载的区外玩家可以按名字传送', async () => {
  const chats: string[] = []
  const config = makeConfig({
    botUsername: 'lofii',
    safeZone: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
  })
  const movement = new MovementManager(logger, config)
  const bot = {
    players: {
      Out: {
        username: 'Out',
        entity: {
          position: { x: 80, y: 64, z: 80 },
          dimension: 'minecraft:overworld'
        }
      }
    },
    game: { dimension: 'minecraft:overworld' },
    chat (line: string) { chats.push(line) },
    waitForChunksToLoad: async () => undefined
  } as unknown as Bot
  attachBot(movement, bot)
  await movement.teleportToPlayer('Out')
  assert.deepEqual(chats, ['/tp lofii Out'])
})
