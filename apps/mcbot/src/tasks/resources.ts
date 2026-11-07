import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import type { Config } from '../config.ts'
import { columnsWithinRadius, insideSafeZone, surveyRing } from './navigation.ts'

export interface ProtectedPoint {
  x: number
  z: number
}

export function protectedPoints (config: Config): ProtectedPoint[] {
  return [
    { x: config.home.x, z: config.home.z },
    { x: (config.farm.minX + config.farm.maxX) / 2, z: (config.farm.minZ + config.farm.maxZ) / 2 },
    { x: config.chest.x, z: config.chest.z },
    { x: (config.treeFarm.minX + config.treeFarm.maxX) / 2, z: (config.treeFarm.minZ + config.treeFarm.maxZ) / 2 }
  ]
}

export function insideProtected (config: Config, x: number, z: number, radius: number): boolean {
  const limit = radius * radius
  return protectedPoints(config).some(point => {
    const dx = x - point.x
    const dz = z - point.z
    return dx * dx + dz * dz <= limit
  })
}

export function playerNear (bot: Bot, position: Vec3, radius = 8): boolean {
  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.username === bot.username) continue
    if (player.entity.position.distanceTo(position) <= radius) return true
  }
  return false
}

function blockAt (bot: Bot, position: Vec3): Block | null {
  return bot.blockAt(position, false)
}

export function isAirBlock (block: Block | null): boolean {
  return block !== null && (block.name === 'air' || block.name === 'cave_air')
}

export function hasAirNeighbor (bot: Bot, position: Vec3): boolean {
  for (const offset of [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 1, 0), new Vec3(0, -1, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1)
  ]) {
    if (isAirBlock(blockAt(bot, position.plus(offset)))) return true
  }
  return false
}

export function hasLiquidNeighbor (bot: Bot, position: Vec3): boolean {
  for (const offset of [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 1, 0), new Vec3(0, -1, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1)
  ]) {
    const name = blockAt(bot, position.plus(offset))?.name
    if (name === 'water' || name === 'lava') return true
  }
  return false
}

export function isSoil (name: string | undefined): boolean {
  return name !== undefined && ['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'moss_block'].includes(name)
}

export function oreKind (name: string): 'coal' | 'iron' | 'copper' | null {
  if (name === 'coal_ore' || name === 'deepslate_coal_ore') return 'coal'
  if (name === 'iron_ore' || name === 'deepslate_iron_ore') return 'iron'
  if (name === 'copper_ore' || name === 'deepslate_copper_ore') return 'copper'
  return null
}

export const FOREST_SPECIES: Record<string, { log: string, leaves: string, sapling: string }> = {
  oak: { log: 'oak_log', leaves: 'oak_leaves', sapling: 'oak_sapling' },
  spruce: { log: 'spruce_log', leaves: 'spruce_leaves', sapling: 'spruce_sapling' },
  birch: { log: 'birch_log', leaves: 'birch_leaves', sapling: 'birch_sapling' }
}

export function forestSpeciesForLog (config: Config, name: string): string | null {
  for (const species of config.forest.species) {
    const entry = FOREST_SPECIES[species]
    if (entry?.log === name) return species
  }
  return null
}

export function surveyCells (config: Config): Vec3[] {
  return surveyRing(config.home, config.scanRadius)
}

export function surveyCellsFor (config: Config, x: number, z: number): Vec3[] {
  return surveyCells(config).sort((a, b) => {
    const da = Math.hypot(a.x - x, a.z - z)
    const db = Math.hypot(b.x - x, b.z - z)
    return da - db
  })
}

export function inSafeZone (config: Config, position: Vec3): boolean {
  return insideSafeZone(config, position.x, position.z)
}

export interface OreTarget {
  position: Vec3
  name: string
  kind: 'coal' | 'iron' | 'copper'
}

/** 挖矿扫描的 y 区间：可选深层带 + 原有表层带；顺序即优先级。 */
export function miningBands (config: Config): Array<[number, number]> {
  const bands: Array<[number, number]> = []
  if (config.mining.deepEnabled) bands.push([config.mining.deepMinY, config.mining.deepMaxY])
  bands.push([config.mining.minY, config.mining.maxY])
  return bands
}

/** 单个方块是否仍是可挖的裸露矿。不限制与 Bot 的距离，调用方自己收口范围。 */
export function exposedOreAt (bot: Bot, config: Config, point: Vec3): OreTarget | null {
  if (insideProtected(config, point.x, point.z, config.mining.protectRadius)) return null
  const y = point.y
  if (!miningBands(config).some(([min, max]) => y >= min && y <= max)) return null
  const block = blockAt(bot, point)
  if (!block || !config.mining.ores.includes(block.name)) return null
  const kind = oreKind(block.name)
  if (!kind) return null
  if (!hasAirNeighbor(bot, point)) return null
  if (hasLiquidNeighbor(bot, point)) return null
  if (playerNear(bot, point, 8)) return null
  return { position: point, name: block.name, kind }
}

export function scanExposedOres (bot: Bot, config: Config): OreTarget[] {
  const targets: OreTarget[] = []
  const position = bot.entity?.position ?? null
  if (!position) return []
  const bands = miningBands(config)
  const windowMin = Math.floor(position.y) - 24
  const windowMax = Math.floor(position.y) + 8
  for (const column of columnsWithinRadius(position, config.scanRadius)) {
    const { x, z } = column
    for (const [bandMin, bandMax] of bands) {
      const minY = Math.max(bandMin, windowMin)
      const maxY = Math.min(bandMax, windowMax)
      if (minY > maxY) continue
      for (let y = minY; y <= maxY; y++) {
        const ore = exposedOreAt(bot, config, new Vec3(x, y, z))
        if (ore) targets.push(ore)
      }
    }
  }
  targets.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position))
  return targets.slice(0, 64)
}
