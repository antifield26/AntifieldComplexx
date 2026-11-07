import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import type { Block } from 'prismarine-block'
import { TaskError } from './types.ts'


const HAZARD_BLOCKS = new Set(['water', 'lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'powder_snow', 'sweet_berry_bush'])
const CROP_BLOCKS = new Set(['wheat', 'carrots', 'potatoes', 'beetroot', 'pumpkin_stem', 'melon_stem', 'nether_wart'])

export function insideSafeZone (config: Config, x: number, z: number): boolean {
  return x >= config.safeZone.minX && x <= config.safeZone.maxX &&
    z >= config.safeZone.minZ && z <= config.safeZone.maxZ
}

/** 以原点为圆心的水平列。半径超过 64 时截断，避免扫描扩大到整个世界。 */
export function columnsWithinRadius (origin: { x: number, z: number }, radius: number): Array<{ x: number, z: number }> {
  const r = Math.max(1, Math.min(64, Math.floor(radius)))
  const cx = Math.floor(origin.x)
  const cz = Math.floor(origin.z)
  const limit = r * r
  const columns: Array<{ x: number, z: number }> = []
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > limit) continue
      columns.push({ x: cx + dx, z: cz + dz })
    }
  }
  return columns
}

/** 传送落点必须是家、箱子、钓点、农田、树场、分类箱或探索航点附近。 */
export function isTeleportAnchor (config: Config, x: number, y: number, z: number): boolean {
  const slack = 8
  const points: Array<{ x: number, y: number, z: number }> = [
    config.home,
    config.chest,
    config.fishStand,
    config.fishWater,
    ...config.exploreWaypoints
  ]
  for (const point of [config.storageChests.ores, config.storageChests.food, config.storageChests.saplings, config.storageChests.misc]) {
    if (point) points.push(point)
  }
  if (points.some(point => Math.hypot(point.x - x, point.y - y, point.z - z) <= slack)) return true
  const inRect = (minX: number, maxX: number, minZ: number, maxZ: number, anchorY: number): boolean =>
    x >= minX - slack && x <= maxX + slack &&
    z >= minZ - slack && z <= maxZ + slack &&
    Math.abs(y - anchorY) <= slack + 4
  if (inRect(config.farm.minX, config.farm.maxX, config.farm.minZ, config.farm.maxZ, config.farm.cropY)) return true
  return inRect(config.treeFarm.minX, config.treeFarm.maxX, config.treeFarm.minZ, config.treeFarm.maxZ, config.treeFarm.logMinY)
}

/** 家或 Bot 周围四个调查点，距离不超过扫描半径。 */
export function surveyRing (origin: { x: number, y: number, z: number }, radius: number): Vec3[] {
  const reach = Math.max(4, Math.min(64, Math.floor(radius * 0.75)))
  return [
    new Vec3(origin.x + reach, origin.y, origin.z),
    new Vec3(origin.x, origin.y, origin.z + reach),
    new Vec3(origin.x - reach, origin.y, origin.z),
    new Vec3(origin.x, origin.y, origin.z - reach)
  ]
}

export function insideFarm (config: Config, x: number, z: number): boolean {
  return x >= config.farm.minX && x <= config.farm.maxX &&
    z >= config.farm.minZ && z <= config.farm.maxZ
}

function isTreeBlock (name: string): boolean {
  return name.endsWith('_log') || name.endsWith('_wood') || name.endsWith('_leaves')
}

function isSolidGround (block: Block | null): boolean {
  return block !== null && block.boundingBox === 'block' && !HAZARD_BLOCKS.has(block.name) && !isTreeBlock(block.name)
}

function isClear (block: Block | null): boolean {
  if (!block) return true
  if (HAZARD_BLOCKS.has(block.name) || CROP_BLOCKS.has(block.name)) return false
  return block.boundingBox === 'empty' || block.name === 'air' || block.name === 'cave_air'
}

export function safeSpotNear (bot: Bot, config: Config, point: { x: number, y: number, z: number }, radius = 4): Vec3 | null {
  const centerX = Math.floor(point.x)
  const centerZ = Math.floor(point.z)
  const reach = Math.min(radius, Math.max(1, config.scanRadius))
  const candidates: Vec3[] = []
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      const x = centerX + dx
      const z = centerZ + dz
      for (let y = Math.floor(point.y) + 2; y >= Math.floor(point.y) - 5; y--) {
        const below = bot.blockAt(new Vec3(x, y - 1, z), false)
        const feet = bot.blockAt(new Vec3(x, y, z), false)
        const head = bot.blockAt(new Vec3(x, y + 1, z), false)
        if (!isSolidGround(below) || !isClear(feet) || !isClear(head)) continue
        candidates.push(new Vec3(x + 0.5, y, z + 0.5))
      }
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.distanceTo(point as Vec3) - b.distanceTo(point as Vec3))
  return candidates[0] ?? null
}

export function findChestAt (bot: Bot, point: { x: number, y: number, z: number }, label = '存箱'): Block {
  const base = bot.blockAt(new Vec3(point.x, point.y, point.z), false)
  if (base?.name === 'chest' || base?.name === 'trapped_chest') return base
  const pair = bot.blockAt(new Vec3(point.x, point.y, point.z + 1), false)
  if (pair?.name === 'chest' || pair?.name === 'trapped_chest') return pair
  throw new TaskError(`找不到${label}，请确认箱子还在原地`)
}

export function findChest (bot: Bot, config: Config): Block {
  return findChestAt(bot, config.chest)
}

export function isMatureWheat (block: Block | null): boolean {
  if (!block || block.name !== 'wheat') return false
  const age = block.getProperties().age
  return Number(age) === 7
}

export function findMatureWheat (bot: Bot, config: Config): Block[] {
  const found: Block[] = []
  for (let x = config.farm.minX; x <= config.farm.maxX; x++) {
    for (let z = config.farm.minZ; z <= config.farm.maxZ; z++) {
      const block = bot.blockAt(new Vec3(x, config.farm.cropY, z), false)
      if (isMatureWheat(block)) found.push(block as Block)
    }
  }
  return found
}

export function findEmptyFarmland (bot: Bot, config: Config): Block[] {
  const found: Block[] = []
  for (let x = config.farm.minX; x <= config.farm.maxX; x++) {
    for (let z = config.farm.minZ; z <= config.farm.maxZ; z++) {
      const ground = bot.blockAt(new Vec3(x, config.farm.groundY, z), false)
      const crop = bot.blockAt(new Vec3(x, config.farm.cropY, z), false)
      if (ground?.name === 'farmland' && isClear(crop)) found.push(ground)
    }
  }
  return found
}

export function farmAnchor (config: Config): { x: number, y: number, z: number } {
  return {
    x: (config.farm.minX + config.farm.maxX) / 2 + 0.5,
    y: config.farm.cropY,
    z: (config.farm.minZ + config.farm.maxZ) / 2 + 0.5
  }
}
