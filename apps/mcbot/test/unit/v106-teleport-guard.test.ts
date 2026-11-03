import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
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

test('v1.0.6 传送：安全区外的在线玩家不能按名字传送', async () => {
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
    chat (line: string) { chats.push(line) }
  } as unknown as Bot
  attachBot(movement, bot)
  await assert.rejects(() => movement.teleportToPlayer('Out'), /安全区外/)
  assert.deepEqual(chats, [])
})
