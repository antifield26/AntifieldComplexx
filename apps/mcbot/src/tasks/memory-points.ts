/**
 * 挖矿和天然林复用当前维度的资源坐标，并记录已扫描、再次核对的资源。
 *
 * 边界：只访问当前维度的 resource 分类，不调用模型，不新增工具或移动能力。
 * 正文需能解析出 x,y,z，并用矿或树的关键词区分。超出两倍扫描半径、两种关键词都有或都没有的条目不用。
 */
import { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'
import type { Config } from '../config.ts'
import { WorldMemoryStore, worldMemoryPath, sharedWorldMemory, memoryDimension, type WorldMemoryItem } from '../autonomy/world-memory.ts'
import { exposedOreAt, type OreTarget } from './resources.ts'

const MAX_POINTS = 8
const COORDINATE = /(?<![0-9-])(-?\d{1,7})\s*[,，]\s*(-?\d{1,3})\s*[,，]\s*(-?\d{1,7})(?![0-9])|(?<![0-9-])(-?\d{1,7})\s+(-?\d{1,3})\s+(-?\d{1,7})(?![0-9])/

export function readResourceMemory (dataDir: string, dimension?: string): WorldMemoryItem[] {
  try {
    return new WorldMemoryStore(worldMemoryPath(dataDir, dimension)).read('resource')
  } catch {
    return []
  }
}

/** 只持久化调用方已扫描并复核的少量资源；失败交给任务错误路径，不伪装保存成功。 */
export async function rememberObservedResources (
  bot: Bot, config: Config, kind: 'ore' | 'tree', points: readonly { position: Vec3, name: string }[]
): Promise<void> {
  const dimension = memoryDimension(bot.game?.dimension)
  const memory = sharedWorldMemory(config.dataDir, dimension)
  const now = Date.now()
  for (const { position, name } of points.slice(0, MAX_POINTS)) {
    if (memoryDimension(bot.game?.dimension) !== dimension) break
    const block = bot.blockAt(position, false)
    if (!block || block.name !== name) continue
    if (kind === 'ore' && !/^(coal|iron|copper)_ore$|^deepslate_(coal|iron|copper)_ore$/.test(name)) continue
    if (kind === 'tree' && !/^(oak|spruce|birch)_log$/.test(name)) continue
    const { x, y, z } = position
    if (![x, y, z].every(Number.isSafeInteger)) continue
    const key = `auto-${kind}-${x},${y},${z}`
    const text = `${name} ${x},${y},${z}`
    const existing = memory.read('resource').find((item) => item.key === key)
    if (existing?.text === text && now - Date.parse(existing.updatedAt) < 60_000) continue
    // 自动观察不淘汰主人写入的记忆；满额时停止本批，仍保留任务自身的资源扫描能力。
    if (!existing && memory.read().length >= 200) break
    await memory.write('resource', key, text)
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
  const ore = /(?:^|[^a-z])(?:coal|iron|copper|ores?)(?![a-z])|矿/i.test(blob)
  const tree = /(?:^|[^a-z])(?:oak|spruce|birch|logs?|trees?|saplings?|forest)(?![a-z])|原木|树|林/i.test(blob)
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
