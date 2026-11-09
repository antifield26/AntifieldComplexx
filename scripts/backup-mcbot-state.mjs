/**
 * 备份与隔离恢复共用 mcbot 状态验证。只复制业务状态，标准输出只含状态和计数。
 */
import { createHash } from 'node:crypto'
import { constants, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, closeSync, fstatSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { GoalStore } from '../apps/mcbot/src/goals/store.ts'
import { parseTaskState } from '../apps/mcbot/src/tasks/store.ts'
import { parseWorldMemory } from '../apps/mcbot/src/autonomy/world-memory.ts'

const GOALS = 'goals.db'
const TASK = 'task-state.json'
const MEMORY = 'world-memory.json'
const FILES = [GOALS, TASK, MEMORY]
const MAX_JSON_BYTES = 1024 * 1024

function readJsonFile(file) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('invalid_state_file')
    const raw = readFileSync(fd)
    if (raw.length > MAX_JSON_BYTES) throw new Error('invalid_state_file')
    return raw
  } finally {
    closeSync(fd)
  }
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function inspectGoals(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('invalid_goals_database')
  const goals = db.prepare('SELECT count(id) AS n FROM goals WHERE current_step >= 0').get().n
  db.prepare('SELECT goal_id, step_index, status FROM goal_steps LIMIT 1').get()
  return { goals, running: db.prepare("SELECT count(*) AS n FROM goals WHERE status = 'running'").get().n }
}

function validateJson(name, raw) {
  if (name === TASK) {
    const state = parseTaskState(raw.toString('utf8'))
    return { pendingTask: state.active !== null, queuedTasks: state.queue.length }
  }
  const entries = parseWorldMemory(raw.toString('utf8'))
  if (entries === null) throw new Error('invalid_world_memory')
  return { worldMemoryItems: entries.length }
}

export async function captureMcbotState(directory, sources) {
  mkdirSync(directory, { mode: 0o700 })
  const files = {}
  for (const name of FILES) {
    const from = sources[name]
    const to = join(directory, name)
    try {
      if (name === GOALS) {
        if (!lstatSync(from).isFile()) throw new Error('invalid_goals_database')
        const db = new DatabaseSync(from, { readOnly: true })
        try {
          db.prepare('SELECT id FROM goals LIMIT 1').get()
          await backup(db, to)
        } finally {
          db.close()
        }
        const copy = new DatabaseSync(to, { readOnly: true })
        try {
          inspectGoals(copy)
        } finally {
          copy.close()
        }
      } else {
        const raw = readJsonFile(from)
        validateJson(name, raw)
        writeFileSync(to, raw, { flag: 'wx', mode: 0o600 })
      }
      files[name] = { status: 'included', sha256: await sha256(to), size: lstatSync(to).size }
    } catch (error) {
      files[name] = { status: name !== GOALS && error.code === 'ENOENT' ? 'not_created' : 'read_failed' }
    }
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: 1, files }) + '\n', { mode: 0o600 })
  return files
}

export async function verifyMcbotState(directory, { restore = false } = {}) {
  const manifest = JSON.parse(readJsonFile(join(directory, 'manifest.json')).toString('utf8'))
  if (manifest.version !== 1) throw new Error('invalid_mcbot_manifest')
  const details = {}
  for (const name of FILES) {
    const entry = manifest.files?.[name]
    const file = join(directory, name)
    if (name !== GOALS && entry?.status === 'not_created' && !existsSync(file)) continue
    if (entry?.status !== 'included' || !lstatSync(file).isFile() ||
        entry.size !== lstatSync(file).size || entry.sha256 !== await sha256(file)) {
      throw new Error('invalid_mcbot_archive_entry:' + name)
    }
    if (name === GOALS) {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        Object.assign(details, inspectGoals(db))
      } finally {
        db.close()
      }
    } else {
      Object.assign(details, validateJson(name, readJsonFile(file)))
    }
  }
  if (restore) {
    // 仅在隔离解包副本上启动目标库，使中断目标进入暂停态。
    const store = new GoalStore(join(directory, GOALS))
    try {
      store.init()
      const db = new DatabaseSync(join(directory, GOALS), { readOnly: true })
      try {
        const restored = inspectGoals(db)
        if (restored.running || restored.goals !== details.goals) throw new Error('invalid_restored_goals')
      } finally {
        db.close()
      }
    } finally {
      store.close()
    }
  }
  return details
}

if (import.meta.main) {
  try {
    const [command, directory, data, goals, task] = process.argv.slice(2)
    if (command === 'capture') {
      if (![directory, data, goals, task].every(value => typeof value === 'string' && isAbsolute(value))) {
        throw new Error('invalid_mcbot_paths')
      }
      process.umask(0o077)
      const files = await captureMcbotState(directory, { [GOALS]: goals, [TASK]: task, [MEMORY]: join(data, MEMORY) })
      const states = Object.fromEntries(FILES.map(name => [name, files[name].status]))
      const ok = !Object.values(states).includes('read_failed')
      process.stdout.write(JSON.stringify({ ok, files: states }) + '\n')
      if (!ok) process.exitCode = 1
    } else if (command === 'verify' || command === 'restore') {
      const details = await verifyMcbotState(directory, { restore: command === 'restore' })
      process.stdout.write(JSON.stringify({ ok: true, ...details }) + '\n')
    } else {
      throw new Error('invalid_command')
    }
  } catch {
    process.stdout.write('{"ok":false,"error":"mcbot_state_validation_failed"}\n')
    process.exitCode = 1
  }
}
