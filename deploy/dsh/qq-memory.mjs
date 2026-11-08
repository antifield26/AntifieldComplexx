/**
 * QQ 角色与结构化记忆仓。身份只来自已通过 QQ 策略的入站上下文。
 * 模型只能提出当前成员的变更，管理员审核后才写入生效记忆。
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, openSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const KINDS = new Set(['profile', 'preference', 'fact', 'project', 'task', 'relationship', 'episode'])
const KEY = /^[\p{L}\p{N}_.-]{1,80}$/u
const MAX_VALUE = 500
const MAX_ITEMS = 100
const MAX_PENDING = 20

export function qqScope(app, kind, peer, member) {
  if (![app, peer, member].every((id) => typeof id === 'string' && ID.test(id))
    || (kind !== 'c2c' && kind !== 'group') || (kind === 'c2c' && peer !== member)) return null
  return { app, kind, peer, member }
}

function own(scope) {
  return [scope.app, scope.kind, scope.peer, scope.member]
}

function validateEntry(category, key, value) {
  return KINDS.has(category) && typeof key === 'string' && KEY.test(key)
    && typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_VALUE
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export class QqMemory {
  constructor(path) {
    const fd = openSync(path, 'a', 0o600)
    closeSync(fd)
    chmodSync(path, 0o600)
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS roles (
        app TEXT, kind TEXT, peer TEXT, name TEXT NOT NULL, prompt TEXT NOT NULL,
        PRIMARY KEY(app, kind, peer)
      );
      CREATE TABLE IF NOT EXISTS memory_settings (
        app TEXT, member TEXT, enabled INTEGER NOT NULL, PRIMARY KEY(app, member)
      );
      CREATE TABLE IF NOT EXISTS memory (
        app TEXT, kind TEXT, peer TEXT, member TEXT, category TEXT, key TEXT, value TEXT NOT NULL,
        expires_at TEXT, PRIMARY KEY(app, kind, peer, member, category, key)
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY, app TEXT NOT NULL, kind TEXT NOT NULL, peer TEXT NOT NULL, member TEXT NOT NULL,
        category TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, op TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS imports (app TEXT PRIMARY KEY, completed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_generations (
        app TEXT, member TEXT, generation TEXT NOT NULL, PRIMARY KEY(app, member)
      );
    `)
  }

  enabled(scope) {
    return this.db.prepare('SELECT enabled FROM memory_settings WHERE app = ? AND member = ?')
      .get(scope.app, scope.member)?.enabled !== 0
  }

  context(scope) {
    const role = this.db.prepare('SELECT name, prompt FROM roles WHERE app = ? AND kind = ? AND peer = ?')
      .get(scope.app, scope.kind, scope.peer)
    const memory = this.enabled(scope)
      ? this.db.prepare(`
        SELECT category, key, value FROM memory WHERE app = ? AND kind = ? AND peer = ? AND member = ?
        AND (expires_at IS NULL OR expires_at > ?) ORDER BY category, key LIMIT 8
      `).all(...own(scope), new Date().toISOString())
      : []
    return { role: role ?? null, memory }
  }

  propose(scope, args) {
    if (!this.enabled(scope)) throw new Error('当前成员已关闭记忆')
    if (!args || (args.op !== 'upsert' && args.op !== 'delete')) throw new Error('记忆操作无效')
    const value = args.op === 'delete' ? '删除' : args.value
    if (!validateEntry(args.category, args.key, value)) throw new Error('记忆条目格式无效')
    const id = randomUUID()
    transaction(this.db, () => {
      const count = this.db.prepare('SELECT count(*) AS n FROM proposals WHERE app = ? AND kind = ? AND peer = ? AND member = ?')
        .get(...own(scope)).n
      if (count >= MAX_PENDING) throw new Error('当前作用域的待审记忆已达上限')
      this.db.prepare('INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ...own(scope), args.category, args.key, value.trim(), args.op, new Date().toISOString())
    })
    return id
  }

  review(id, approve) {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)
      if (!row) return false
      const scope = qqScope(row.app, row.kind, row.peer, row.member)
      if (approve && scope && this.enabled(scope)) {
        if (row.op === 'delete') {
          this.db.prepare('DELETE FROM memory WHERE app = ? AND kind = ? AND peer = ? AND member = ? AND category = ? AND key = ?')
            .run(...own(scope), row.category, row.key)
        } else {
          const count = this.db.prepare('SELECT count(*) AS n FROM memory WHERE app = ? AND kind = ? AND peer = ? AND member = ?')
            .get(...own(scope)).n
          const existing = this.db.prepare('SELECT 1 FROM memory WHERE app = ? AND kind = ? AND peer = ? AND member = ? AND category = ? AND key = ?')
            .get(...own(scope), row.category, row.key)
          if (count >= MAX_ITEMS && !existing) throw new Error('已达当前作用域的记忆上限')
          this.db.prepare(`INSERT INTO memory VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(app, kind, peer, member, category, key)
            DO UPDATE SET value = excluded.value, expires_at = NULL`)
            .run(...own(scope), row.category, row.key, row.value)
        }
      }
      this.db.prepare('DELETE FROM proposals WHERE id = ?').run(id)
      return true
    })
  }

  generation(app, member) {
    return this.db.prepare('SELECT generation FROM memory_generations WHERE app = ? AND member = ?')
      .get(app, member)?.generation ?? null
  }

  forget(scope) {
    if (!qqScope(scope.app, 'c2c', scope.peer, scope.member) || scope.kind !== 'c2c') {
      throw new Error('仅允许本人在私聊清除记忆')
    }
    return transaction(this.db, () => {
      const args = [scope.app, scope.member]
      const items = this.db.prepare('DELETE FROM memory WHERE app = ? AND member = ?').run(...args)
      const candidates = this.db.prepare('DELETE FROM proposals WHERE app = ? AND member = ?').run(...args)
      this.db.prepare(`
        INSERT INTO memory_generations VALUES (?, ?, ?)
        ON CONFLICT(app, member) DO UPDATE SET generation = excluded.generation
      `).run(...args, randomUUID())
      return Number(items.changes) + Number(candidates.changes)
    })
  }

  importWorkbench(sourcePath, app) {
    if (!ID.test(app)) throw new Error('QQ AppID 无效')
    const source = new DatabaseSync(sourcePath, { readOnly: true })
    try {
      const matches = source.prepare(`
        SELECT id FROM chatbots WHERE platform = 'qq' AND json_valid(config_json)
          AND json_extract(config_json, '$.appId') = ?
      `).all(app)
      if (matches.length !== 1) throw new Error('来源数据库无法唯一确认 QQ Bot')
      const bot = matches[0].id
      return transaction(this.db, () => {
        if (this.db.prepare('SELECT 1 FROM imports WHERE app = ?').get(app)) return { alreadyImported: true }
        const peers = source.prepare('SELECT target_external_id, target_kind, user_id FROM chatbot_inbound_targets WHERE chatbot_id = ?').all(bot)
        const privatePeers = new Set(peers.filter((row) => row.target_kind === 'user' && row.target_external_id === row.user_id).map((row) => row.user_id))
        const configuredGroups = new Set()
        const targets = source.prepare("SELECT kind, external_id FROM chatbot_targets WHERE chatbot_id = ? AND allow_chat = 1").all(bot)
        for (const row of targets) {
          if (row.kind === 'user') privatePeers.add(row.external_id)
          if (row.kind === 'group') configuredGroups.add(row.external_id)
        }
        const groups = new Map()
        for (const row of peers) {
          if (row.target_kind !== 'group') continue
          if (!groups.has(row.target_external_id)) groups.set(row.target_external_id, new Set())
          groups.get(row.target_external_id).add(row.user_id)
        }
        const counts = { roles: 0, memory: 0, settings: 0, skipped: 0 }
        const role = this.db.prepare('INSERT OR IGNORE INTO roles VALUES (?, ?, ?, ?, ?)')
        for (const [kind, rows] of [
          ['c2c', source.prepare('SELECT user_id AS peer, name, prompt FROM chatbot_chat_roles WHERE chatbot_id = ? AND enabled = 1').all(bot)],
          ['group', source.prepare('SELECT target_external_id AS peer, name, prompt FROM chatbot_group_roles WHERE chatbot_id = ? AND enabled = 1').all(bot)],
        ]) {
          for (const row of rows) {
            const confirmed = kind === 'group' ? groups.has(row.peer) || configuredGroups.has(row.peer) : privatePeers.has(row.peer)
            if (!ID.test(row.peer) || !confirmed) counts.skipped++
            else counts.roles += Number(role.run(app, kind, row.peer, row.name, row.prompt).changes)
          }
        }
        const setting = this.db.prepare('INSERT OR IGNORE INTO memory_settings VALUES (?, ?, ?)')
        for (const row of source.prepare('SELECT user_id, memory_enabled FROM chatbot_memory_state WHERE chatbot_id = ?').all(bot)) {
          if (!privatePeers.has(row.user_id) || !ID.test(row.user_id)) counts.skipped++
          else counts.settings += Number(setting.run(app, row.user_id, row.memory_enabled).changes)
        }
        const insert = this.db.prepare('INSERT OR IGNORE INTO memory VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        for (const row of source.prepare(`
          SELECT user_id, kind, mem_key, value, expires_at FROM chatbot_memory_items
          WHERE chatbot_id = ? AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY importance DESC, updated_at DESC
        `).all(bot, new Date().toISOString())) {
          let scope = privatePeers.has(row.user_id) ? qqScope(app, 'c2c', row.user_id, row.user_id) : null
          let key = row.mem_key
          if (row.user_id.startsWith('group:')) {
            const peer = row.user_id.slice(6)
            const split = key.indexOf(':')
            const member = split < 0 ? '' : key.slice(0, split)
            if (groups.get(peer)?.has(member)) {
              scope = qqScope(app, 'group', peer, member)
              key = key.slice(split + 1)
            }
          }
          if (!scope || !validateEntry(row.kind, key, row.value)) counts.skipped++
          else counts.memory += Number(insert.run(...own(scope), row.kind, key, row.value, row.expires_at).changes)
        }
        this.db.prepare('INSERT INTO imports VALUES (?, ?)').run(app, new Date().toISOString())
        return counts
      })
    } finally {
      source.close()
    }
  }
}
