import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'
import { WorldMemoryStore } from '../../src/autonomy/world-memory.ts'
import { naturalTreeAt, rememberedTrees } from '../../src/tasks/forest.ts'
import {
  readResourceMemory,
  rememberedCoordinates,
  rememberedOreTargets,
  rememberedProbes
} from '../../src/tasks/memory-points.ts'
import type { WorldMemoryItem } from '../../src/autonomy/world-memory.ts'
import { makeConfig } from '../helpers.ts'

function item (category: WorldMemoryItem['category'], key: string, text: string, updatedAt: string): WorldMemoryItem {
  return { category, key, text, updatedAt }
}

function fakeBlockBot (blocks: Map<string, string | null>, position = new Vec3(0, 64, 0)): Bot {
  return {
    username: 'lofii',
    entity: { position },
    players: {},
    blockAt: (point: Vec3) => {
      const name = blocks.get(`${point.x},${point.y},${point.z}`)
      if (name === null) return null
      return { name: name ?? 'air' }
    }
  } as unknown as Bot
}

test('v1.0.13 memory coordinates keep ore and tree points inside two scan radii', () => {
  const origin = new Vec3(0, 64, 0)
  const items = [
    item('resource', 'iron-east', '铁矿 8,64,2', '2026-11-07T00:00:03.000Z'),
    item('resource', 'oak-south', '橡树 4,64,6', '2026-11-07T00:00:02.000Z'),
    item('resource', 'both', 'iron oak 1,64,1', '2026-11-07T00:00:04.000Z'),
    item('resource', 'plain', '12,64,12', '2026-11-07T00:00:05.000Z'),
    item('food', 'bread', '食物 3,64,3', '2026-11-07T00:00:06.000Z'),
    item('resource', 'far', '煤矿 400,64,0', '2026-11-07T00:00:01.000Z'),
    item('resource', 'spaced', 'copper ore 6 70 1', '2026-11-07T00:00:00.000Z')
  ]
  assert.deepEqual(rememberedCoordinates(items, 'ore', origin, 64).map(point => point.toArray()), [
    [8, 64, 2],
    [6, 70, 1]
  ])
  assert.deepEqual(rememberedCoordinates(items, 'tree', origin, 64).map(point => point.toArray()), [
    [4, 64, 6]
  ])
})

test('v1.0.13 remembered ore is used only while the block is still exposed', () => {
  const config = makeConfig({
    mining: { ...makeConfig().mining, protectRadius: 0, minY: 60, maxY: 80 }
  })
  const blocks = new Map<string, string | null>()
  blocks.set('8,64,2', 'iron_ore')
  blocks.set('8,65,2', 'air')
  blocks.set('6,70,1', 'stone')
  const items = [
    item('resource', 'iron-east', '铁矿 8,64,2', '2026-11-07T00:00:03.000Z'),
    item('resource', 'gone', 'copper ore 6,70,1', '2026-11-07T00:00:02.000Z')
  ]
  const targets = rememberedOreTargets(fakeBlockBot(blocks), config, items)
  assert.equal(targets.length, 1)
  assert.equal(targets[0]?.name, 'iron_ore')
  assert.deepEqual(targets[0]?.position.toArray(), [8, 64, 2])
})

test('v1.0.13 unloaded ore coordinate is a probe and not a target', () => {
  const config = makeConfig({
    mining: { ...makeConfig().mining, protectRadius: 0 }
  })
  const blocks = new Map<string, string | null>()
  blocks.set('8,64,2', null)
  const items = [item('resource', 'iron-east', '铁矿 8,64,2', '2026-11-07T00:00:03.000Z')]
  const bot = fakeBlockBot(blocks)
  assert.equal(rememberedOreTargets(bot, config, items).length, 0)
  assert.deepEqual(rememberedProbes(bot, items, 'ore', new Vec3(0, 64, 0), 64).map(point => point.toArray()), [
    [8, 64, 2]
  ])
})

test('v1.0.13 remembered tree still requires leaves and soil', () => {
  const config = makeConfig({
    forest: { ...makeConfig().forest, protectRadius: 0 }
  })
  const blocks = new Map<string, string | null>()
  blocks.set('4,63,6', 'dirt')
  blocks.set('4,64,6', 'oak_log')
  blocks.set('5,64,6', 'oak_leaves')
  const items = [item('resource', 'oak-south', '橡树 4,64,6', '2026-11-07T00:00:02.000Z')]
  const trees = rememberedTrees(fakeBlockBot(blocks), config, items)
  assert.equal(trees.length, 1)
  assert.equal(trees[0]?.species, 'oak')
  assert.equal(naturalTreeAt(fakeBlockBot(blocks), config, new Vec3(4, 64, 6))?.base.y, 64)
  blocks.set('4,64,6', 'stone')
  assert.equal(rememberedTrees(fakeBlockBot(blocks), config, items).length, 0)
})

test('v1.0.13 resource memory roundtrip does not invent coordinates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcbot-v113-'))
  try {
    const store = new WorldMemoryStore(path.join(dir, 'world-memory.json'))
    await store.write('resource', 'iron-east', '铁矿 8,64,2')
    const items = readResourceMemory(dir)
    assert.equal(items.length, 1)
    assert.equal(items[0]?.category, 'resource')
    assert.deepEqual(
      rememberedCoordinates(items, 'ore', new Vec3(0, 64, 0), 64).map(point => point.toArray()),
      [[8, 64, 2]]
    )
    assert.equal(readResourceMemory(path.join(dir, 'missing')).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
