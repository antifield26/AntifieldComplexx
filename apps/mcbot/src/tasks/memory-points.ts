/**
 * 挖矿和天然林在半径扫描前读取世界记忆里的坐标。
 *
 * 边界：只读 resource 分类，不写记忆，不调用模型，不新增工具或环境变量。
 * 正文需能解析出 x,y,z，并用矿或树的关键词区分。超出两倍扫描半径、两种关键词都有或都没有的条目不用。
 */
import { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'
import type { Config } from '../config.ts'
import { WorldMemoryStore, worldMemoryPath, type WorldMemoryItem } from '../autonomy/world-memory.ts'
import { exposedOreAt, type OreTarget } from './resources.ts'

const MAX_POINTS = 8
const COORDINATE = /(?<![0-9-])(-?\d{1,7})\s*[,，]\s*(-?\d{1,3})\s*[,，]\s*(-?\d{1,7})(?![0-9])|(?<![0-9-])(-?\d{1,7})\s+(-?\d{1,3})\s+(-?\d{1,7})(?![0-9])/

export function readResourceMemory (dataDir: string): WorldMemoryItem[] {
  try {
    return new WorldMemoryStore(worldMemoryPath(dataDir)).read('resource')
  } catch {
    return []
  }
}

export function rememberedCoordinates (
  items: readonly WorldMemoryItem[],
  kind: 'ore' | 'tree',
  origin: Vec3,
  maxDistance: number
): Vec3[] {
  const points: Vec3[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.category !== 'resource' || pointKind(item.key, item.text) !== kind) continue
    const point = firstCoordinate(`${item.text}\n${item.key}`)
    if (!point) continue
    const dx = point.x - origin.x
    const dz = point.z - origin.z
    if (dx * dx + dz * dz > maxDistance * maxDistance) continue
    const key = `${point.x},${point.y},${point.z}`
    if (seen.has(key)) continue
    seen.add(key)
    points.push(point)
    if (points.length >= MAX_POINTS) break
  }
  return points
}

export function rememberedOreTargets (bot: Bot, config: Config, items: readonly WorldMemoryItem[]): OreTarget[] {
  const origin = bot.entity?.position
  if (!origin) return []
  const targets: OreTarget[] = []
  for (const point of rememberedCoordinates(items, 'ore', origin, config.scanRadius * 2)) {
    if (bot.blockAt(point, false) === null) continue
    const ore = exposedOreAt(bot, config, point)
    if (ore) targets.push(ore)
  }
  targets.sort((a, b) => origin.distanceTo(a.position) - origin.distanceTo(b.position))
  return targets
}

export function rememberedProbes (
  bot: Bot,
  items: readonly WorldMemoryItem[],
  kind: 'ore' | 'tree',
  origin: Vec3,
  maxDistance: number
): Vec3[] {
  return rememberedCoordinates(items, kind, origin, maxDistance)
    .filter(point => bot.blockAt(point, false) === null)
}

function pointKind (key: string, text: string): 'ore' | 'tree' | null {
  const blob = `${key}\n${text}`
  const ore = /coal|iron|copper|ore|矿/i.test(blob)
  const tree = /oak|spruce|birch|log|tree|sapling|原木|树|林/i.test(blob)
  if (ore === tree) return null
  return ore ? 'ore' : 'tree'
}

function firstCoordinate (text: string): Vec3 | null {
  const match = COORDINATE.exec(text)
  if (!match) return null
  const x = Number(match[1] ?? match[4])
  const y = Number(match[2] ?? match[5])
  const z = Number(match[3] ?? match[6])
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return null
  if (y < -64 || y > 320) return null
  if (Math.abs(x) > 30_000_000 || Math.abs(z) > 30_000_000) return null
  return new Vec3(x, y, z)
}
