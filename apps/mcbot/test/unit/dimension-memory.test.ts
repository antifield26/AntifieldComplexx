/** 维度隔离与自动观察夹具只读取假方块及临时文件，不连接 Minecraft。 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { memoryDimension, sharedWorldMemory, worldMemoryPath, WorldMemoryStore } from '../../src/autonomy/world-memory.ts'
import { readResourceMemory, rememberObservedResources } from '../../src/tasks/memory-points.ts'
import { makeConfig } from '../helpers.ts'

test('主世界兼容历史文件，不同维度的同键独立，未知维度拒绝', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcbot-dimension-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await new WorldMemoryStore(path.join(dir, 'world-memory.json')).write('resource', 'same', 'iron 1,64,1')
  const nether = sharedWorldMemory(dir, 'minecraft:the_nether')
  await nether.write('resource', 'same', 'coal 2,64,2')
  assert.equal(sharedWorldMemory(dir, 'nether'), nether)
  assert.equal(readResourceMemory(dir)[0]?.text, 'iron 1,64,1')
  assert.equal(readResourceMemory(dir, 'the_nether')[0]?.text, 'coal 2,64,2')
  assert.deepEqual(readResourceMemory(dir, 'the_end'), [])
  assert.equal(memoryDimension('minecraft:the_end'), 'end')
  assert.throws(() => worldMemoryPath(dir, '../../overworld'), /dimension is not supported/)
  assert.deepEqual(readResourceMemory(dir, 'unknown'), [])
})

test('自动资源只保存真实匹配方块，并发写入不覆盖主人记忆', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcbot-observed-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const memory = sharedWorldMemory(dir, 'minecraft:the_nether')
  const config = makeConfig({ dataDir: dir })
  const bot = { game: { dimension: 'minecraft:the_nether' }, blockAt: (p: Vec3) => p.x === 1 ? { name: 'iron_ore' } : p.x === 2 ? null : { name: 'stone' } } as unknown as Bot
  const point = { name: 'iron_ore', position: new Vec3(1, 64, 1) }
  await Promise.all([
    memory.write('note', 'owner', '主人记忆'),
    rememberObservedResources(bot, config, 'ore', [point, { name: 'iron_ore', position: new Vec3(2, 64, 2) }, { name: 'iron_ore', position: new Vec3(3, 64, 3) }]),
  ])
  assert.equal(memory.read().length, 2)
  assert.equal(memory.read('resource')[0]?.text, 'iron_ore 1,64,1')
  const before = await readFile(worldMemoryPath(dir, 'nether'), 'utf8')
  await rememberObservedResources(bot, config, 'ore', [point])
  assert.equal(await readFile(worldMemoryPath(dir, 'nether'), 'utf8'), before)
  assert.deepEqual(readResourceMemory(dir), [])
  assert.equal(readResourceMemory(dir, 'nether').length, 1)
})

test('满额观察不淘汰主人记忆，单批最多八条', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcbot-observed-limit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const config = makeConfig({ dataDir: dir })
  const bot = { game: { dimension: 'overworld' }, blockAt: () => ({ name: 'oak_log' }) } as unknown as Bot
  const points = Array.from({ length: 12 }, (_, x) => ({ name: 'oak_log', position: new Vec3(x, 64, 0) }))
  await rememberObservedResources(bot, config, 'tree', points)
  const memory = sharedWorldMemory(dir)
  assert.equal(memory.read().length, 8)
  for (let i = 8; i < 200; i++) await memory.write('note', `owner-${i}`, '保留')
  await rememberObservedResources(bot, config, 'tree', [{ name: 'oak_log', position: new Vec3(100, 64, 0) }])
  assert.equal(memory.read().length, 200)
  assert.equal(memory.read('note').length, 192)
})
