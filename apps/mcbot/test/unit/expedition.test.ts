/** 生存协作回归，使用假物品、玩家和协议事件。 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Expedition } from '../../src/autonomy/expedition.ts'
import type { MovementManager } from '../../src/minecraft/movement.ts'
import { makeConfig } from '../helpers.ts'

function fixture (t: TestContext, pickupByOwner = true) {
  const directory = mkdtempSync(join(tmpdir(), 'lofii-expedition-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const config = makeConfig({ dataDir: directory, worldId: 'fixture', commandAllowlist: ['Antifield'] })
  const commands: string[] = []
  const entry = { id: 3, name: 'iron_ingot', count: 0 }
  const owner = { id: 2, position: new Vec3(1, 64, 0) }
  const position = new Vec3(0, 64, 0)
  let entityId = 10
  const bot = Object.assign(new EventEmitter(), {
    username: 'Lofii', health: 20, food: 20,
    entity: { id: 1, position },
    players: { Antifield: { username: 'Antifield', entity: owner } },
    game: { dimension: 'minecraft:overworld' },
    registry: { itemsByName: { iron_ingot: entry } },
    inventory: { items: () => entry.count ? [entry] : [] },
    lookAt: async () => undefined,
    blockAt: () => ({ name: 'air' }),
    chat: (command: string) => { commands.push(command); entry.count += Number(command.split(' ').at(-1)) },
    toss: async () => {
      entry.count -= 1
      const item = { id: entityId++, position, getDroppedItem: () => ({ name: 'iron_ingot', count: 1 }) }
      bot.emit('itemDrop', item)
      bot.emit('playerCollect', pickupByOwner ? owner : { id: 1 }, item)
    }
  })
  const create = () => new Expedition(config, {} as MovementManager, () => bot as unknown as Bot)
  const expedition = create()
  const abort = new AbortController()
  return { expedition, commands, entry, abort, create, run: (operation: string, args = {}) =>
    expedition.execute('fixture-run', abort.signal, { operation, ...args }) }
}

test('逐次许可只接受主人且不能重放，交付按拾取证据完成', async t => {
  const f = fixture(t)
  await f.run('goal', { item: 'iron_ingot', quantity: 2 })
  const request = await f.run('give', { item: 'iron_ingot', quantity: 2 })
  assert.equal(request.status, 'approval_required')
  const text = '确认 ' + request.approvalCode
  assert.equal(await f.expedition.answer('other', text), null)
  assert.match(await f.expedition.answer('Antifield', text) ?? '', /在我背包/)
  assert.match(await f.expedition.answer('Antifield', text) ?? '', /失效/)
  assert.deepEqual(f.commands, ['/give Lofii minecraft:iron_ingot 2'])
  const result = await f.run('deliver')
  assert.equal(result.ok, true)
  assert.equal((result.target as { delivered: number }).delivered, 2)
  assert.equal(f.entry.count, 0)
})

test('急停后旧许可不能执行', async t => {
  const f = fixture(t)
  await f.run('goal', { item: 'iron_ingot', quantity: 1 })
  const request = await f.run('give', { item: 'iron_ingot', quantity: 1 })
  f.abort.abort()
  assert.match(await f.expedition.answer('Antifield', '确认 ' + request.approvalCode) ?? '', /失效/)
  assert.equal(f.commands.length, 0)
})

test('拾取者不符时保留核对记录，新执行器不重复发放', async t => {
  const f = fixture(t, false)
  f.entry.count = 1
  await f.run('goal', { item: 'iron_ingot', quantity: 1 })
  const result = await f.run('deliver')
  assert.equal(result.status, 'delivery_unverified')
  const next = f.create()
  const signal = new AbortController().signal
  await next.execute('new-run', signal, { operation: 'goal', item: 'iron_ingot', quantity: 1 })
  const give = await next.execute('new-run', signal, { operation: 'give', item: 'iron_ingot', quantity: 1 })
  assert.equal(give.error, 'reconciliation_required')
})
