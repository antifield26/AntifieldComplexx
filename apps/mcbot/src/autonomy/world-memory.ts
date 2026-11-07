/**
 * 自主会话的结构化世界记忆。与聊天记忆分开，落在 dataDir/world-memory.json。
 *
 * 边界：
 * - 分类只有 place、resource、food、danger、route、note。
 * - 最多 200 条；键 1–64，正文 1–240。已有键可更新，满额后拒绝新键。
 * - 文件 0600，先写临时文件再替换。损坏或超限文件隔离后按空记忆继续。
 * - 不启动任务，不写入 Workbench 数据库。提示词只使用索引，不携带正文。
 */
import { readFileSync, renameSync, statSync } from 'node:fs'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '../logger.ts'

export const WORLD_MEMORY_CATEGORIES = ['place', 'resource', 'food', 'danger', 'route', 'note'] as const
export type WorldMemoryCategory = typeof WORLD_MEMORY_CATEGORIES[number]

export const WORLD_MEMORY_MAX_ITEMS = 200
export const WORLD_MEMORY_MAX_KEY = 64
export const WORLD_MEMORY_MAX_TEXT = 240
const MAX_FILE_BYTES = 128 * 1024

export interface WorldMemoryItem {
  category: WorldMemoryCategory
  key: string
  text: string
  updatedAt: string
}

export interface WorldMemoryIndex {
  counts: Record<WorldMemoryCategory, number>
  recentKeys: Array<{ category: WorldMemoryCategory, key: string }>
}

export function worldMemoryPath (dataDir: string): string {
  return path.join(dataDir, 'world-memory.json')
}

export class WorldMemoryError extends Error {
  readonly code: string
  constructor (code: string, message: string) {
    super(message)
    this.name = 'WorldMemoryError'
    this.code = code
  }
}

function emptyCounts (): Record<WorldMemoryCategory, number> {
  return { place: 0, resource: 0, food: 0, danger: 0, route: 0, note: 0 }
}

function isCategory (value: string): value is WorldMemoryCategory {
  return (WORLD_MEMORY_CATEGORIES as readonly string[]).includes(value)
}

function hasControl (value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function parseStoredItem (value: unknown): WorldMemoryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.category !== 'string' || !isCategory(record.category)) return null
  if (typeof record.key !== 'string' || record.key !== record.key.trim()) return null
  if (record.key.length < 1 || record.key.length > WORLD_MEMORY_MAX_KEY || hasControl(record.key)) return null
  if (typeof record.text !== 'string' || record.text !== record.text.trim()) return null
  if (record.text.length < 1 || record.text.length > WORLD_MEMORY_MAX_TEXT || hasControl(record.text)) return null
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) return null
  return {
    category: record.category,
    key: record.key,
    text: record.text,
    updatedAt: record.updatedAt
  }
}

function parseFile (raw: string): WorldMemoryItem[] | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.items)) return null
  if (record.items.length > WORLD_MEMORY_MAX_ITEMS) return null
  const seen = new Set<string>()
  const items: WorldMemoryItem[] = []
  for (const entry of record.items) {
    const item = parseStoredItem(entry)
    if (!item) return null
    const id = `${item.category}\0${item.key}`
    if (seen.has(id)) return null
    seen.add(id)
    items.push(item)
  }
  items.sort((a, b) => a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0)
  return items
}

/** 提示词用的索引。只含分类计数和最近 8 个键，不含正文。最近键按写入时间从新到旧。 */
export function formatWorldMemoryIndex (index: WorldMemoryIndex): string {
  const total = WORLD_MEMORY_CATEGORIES.reduce((sum, category) => sum + index.counts[category], 0)
  if (total === 0) return '世界记忆：空。分类仅限 place、resource、food、danger、route、note。'
  const counts = WORLD_MEMORY_CATEGORIES.map(category => `${category} ${index.counts[category]}`).join('、')
  const keys = index.recentKeys.map(item => `${item.category}:${item.key}`).join('、')
  return `世界记忆：${counts}。最近键：${keys}。正文不在本提示中，需要时调用 memory_read。`
}

export class WorldMemoryStore {
  private readonly file: string
  private readonly logger: Logger | null
  private items: WorldMemoryItem[]
  private chain: Promise<void> = Promise.resolve()
  private persistBlocked = false

  constructor (file: string, logger?: Logger) {
    this.file = file
    this.logger = logger ?? null
    this.items = this.load()
  }

  index (): WorldMemoryIndex {
    const counts = emptyCounts()
    for (const item of this.items) counts[item.category] += 1
    return {
      counts,
      recentKeys: this.items.slice(-8).reverse().map(item => ({ category: item.category, key: item.key }))
    }
  }

  read (category?: string, key?: string): WorldMemoryItem[] {
    const parsedCategory = category === undefined ? undefined : this.parseCategory(category)
    const parsedKey = key === undefined ? undefined : this.parseKey(key)
    if (parsedKey !== undefined && parsedCategory === undefined) {
      throw new WorldMemoryError('memory_key_needs_category', 'key requires a category')
    }
    const matched = this.items.filter(item => {
      if (parsedCategory !== undefined && item.category !== parsedCategory) return false
      if (parsedKey !== undefined && item.key !== parsedKey) return false
      return true
    })
    if (parsedKey !== undefined && matched.length === 0) {
      throw new WorldMemoryError('memory_not_found', 'memory item was not found')
    }
    return matched.map(item => ({ ...item })).reverse()
  }

  async write (category: string, key: string, text: string): Promise<{ category: WorldMemoryCategory, key: string, updated: boolean }> {
    const parsedCategory = this.parseCategory(category)
    const parsedKey = this.parseKey(key)
    const parsedText = this.parseText(text)
    return await this.enqueue(async () => {
      this.assertWritable()
      const existing = this.items.findIndex(item => item.category === parsedCategory && item.key === parsedKey)
      if (existing < 0 && this.items.length >= WORLD_MEMORY_MAX_ITEMS) {
        throw new WorldMemoryError('memory_full', 'world memory is full')
      }
      const previous = this.items.slice()
      const next: WorldMemoryItem = {
        category: parsedCategory,
        key: parsedKey,
        text: parsedText,
        updatedAt: new Date().toISOString()
      }
      if (existing >= 0) this.items.splice(existing, 1)
      this.items.push(next)
      try {
        await this.persist()
      } catch {
        this.items = previous
        throw new WorldMemoryError('memory_persist_failed', 'world memory could not be saved')
      }
      return { category: parsedCategory, key: parsedKey, updated: existing >= 0 }
    })
  }

  async forget (category: string, key: string): Promise<{ category: WorldMemoryCategory, key: string }> {
    const parsedCategory = this.parseCategory(category)
    const parsedKey = this.parseKey(key)
    return await this.enqueue(async () => {
      this.assertWritable()
      const existing = this.items.findIndex(item => item.category === parsedCategory && item.key === parsedKey)
      if (existing < 0) throw new WorldMemoryError('memory_not_found', 'memory item was not found')
      const previous = this.items.slice()
      this.items.splice(existing, 1)
      try {
        await this.persist()
      } catch {
        this.items = previous
        throw new WorldMemoryError('memory_persist_failed', 'world memory could not be saved')
      }
      return { category: parsedCategory, key: parsedKey }
    })
  }

  private parseCategory (value: string): WorldMemoryCategory {
    const category = value.trim()
    if (!isCategory(category)) throw new WorldMemoryError('memory_category_invalid', 'category is not allowed')
    return category
  }

  private parseKey (value: string): string {
    const key = value.trim()
    if (key.length < 1 || key.length > WORLD_MEMORY_MAX_KEY || hasControl(key)) {
      throw new WorldMemoryError('memory_key_invalid', 'key must be 1-64 characters without control characters')
    }
    return key
  }

  private parseText (value: string): string {
    const text = value.trim()
    if (text.length < 1 || text.length > WORLD_MEMORY_MAX_TEXT || hasControl(text)) {
      throw new WorldMemoryError('memory_text_invalid', 'text must be 1-240 characters without control characters')
    }
    return text
  }

  private assertWritable (): void {
    if (this.persistBlocked) throw new WorldMemoryError('memory_persist_failed', 'world memory could not be saved')
  }

  private enqueue<T> (work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  private warn (message: string): void {
    this.logger?.warn(message)
  }

  private load (): WorldMemoryItem[] {
    let size = 0
    try {
      size = statSync(this.file).size
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') return []
      this.persistBlocked = true
      this.warn('world memory unreadable')
      return []
    }
    if (size > MAX_FILE_BYTES) {
      this.quarantine()
      return []
    }
    let raw = ''
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      this.persistBlocked = true
      this.warn('world memory unreadable')
      return []
    }
    const items = parseFile(raw)
    if (!items) {
      this.quarantine()
      return []
    }
    return items
  }

  private quarantine (): void {
    const target = `${this.file}.corrupt-${Date.now()}`
    try {
      renameSync(this.file, target)
      this.warn('world memory quarantined')
    } catch {
      this.persistBlocked = true
      this.warn('world memory quarantine failed')
    }
  }

  private async persist (): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
    try {
      await writeFile(temp, JSON.stringify({ version: 1, items: this.items }), { encoding: 'utf8', mode: 0o600 })
      await chmod(temp, 0o600).catch(() => undefined)
      await rename(temp, this.file)
      await chmod(this.file, 0o600).catch(() => undefined)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw error
    }
  }
}
