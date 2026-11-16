/** schema 22：删除 Workbench 旧 QQ 表，外部告警只保留 webhook。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { MIGRATIONS, SUPPORTED_SCHEMA_VERSION, openDatabase } from '../src/db.ts'
import { cleanupDir, tempDataDir } from './helpers.ts'

test('schema 22 迁移删除旧 QQ 表，并丢弃 qq 告警通道', () => {
  assert.equal(SUPPORTED_SCHEMA_VERSION, 22)
  assert.equal(MIGRATIONS.length, 22)
  const dir = tempDataDir()
  const path = join(dir, 'v21.sqlite')
  const legacy = new DatabaseSync(path)
  try {
    legacy.exec('PRAGMA foreign_keys = ON')
    legacy.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    for (const sql of MIGRATIONS.slice(0, 21)) legacy.exec(sql)
    legacy.prepare(
      `INSERT INTO meta (key, value) VALUES ('schema_version', '21')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run()
    legacy.prepare(
      `INSERT INTO alert_events (event, severity, status, title, message, created_at)
       VALUES ('disk_low', 'warning', 'firing', '磁盘', '低', '2026-01-01T00:00:00.000Z')`,
    ).run()
    const insert = legacy.prepare(
      `INSERT INTO external_alert_deliveries
       (event_id, channel, delivery_key, status, attempts, next_attempt_at, last_error)
       VALUES (1, ?, ?, 'pending', 0, '2026-01-01T00:00:00.000Z', NULL)`,
    )
    insert.run('webhook', 'keep-webhook')
    insert.run('qq', 'drop-qq')
    legacy.prepare(
      `INSERT INTO chatbots (id, platform, name, enabled, config_json, secret_ciphertext, secret_iv, secret_tag, key_version, created_at, updated_at)
       VALUES ('bot-1', 'qq', '旧机器人', 0, '{}', 'x', 'y', 'z', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run()
    legacy.prepare(
      `INSERT INTO meta (key, value) VALUES ('chatbot_ai_tool_mode', 'legacy')`,
    ).run()
  } finally {
    legacy.close()
  }

  const db = openDatabase({ path })
  try {
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
    assert.equal(version.value, '22')
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chatbot%'`,
    ).all() as unknown as { name: string }[]
    assert.deepEqual(tables, [])
    const channels = db.prepare(
      `SELECT channel, delivery_key FROM external_alert_deliveries ORDER BY channel`,
    ).all() as unknown as { channel: string; delivery_key: string }[]
    assert.deepEqual(
      channels.map((row) => ({ channel: row.channel, delivery_key: row.delivery_key })),
      [{ channel: 'webhook', delivery_key: 'keep-webhook' }],
    )
    assert.equal(
      (db.prepare(`SELECT value FROM meta WHERE key = 'chatbot_ai_tool_mode'`).get() as { value: string } | undefined),
      undefined,
    )
    assert.throws(
      () => db.prepare(
        `INSERT INTO external_alert_deliveries
         (event_id, channel, delivery_key, status, attempts, next_attempt_at)
         VALUES (1, 'qq', 'rejected', 'pending', 0, '2026-01-01T00:00:00.000Z')`,
      ).run(),
      /CHECK constraint failed/,
    )
  } finally {
    db.close()
    cleanupDir(dir)
  }
})
