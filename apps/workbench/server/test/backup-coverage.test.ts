/** 增量覆盖：同毫秒、时钟回拨、旧 manifest、断链、pending 丢失、乱序确认、缺失找回与混合链。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupDir, tempDataDir } from './helpers.ts'

interface BackupRun {
  status: number | null
  json: Record<string, unknown>
  stderr: string
}

function runBackup(dir: string, args: string[], env: Record<string, string> = {}): BackupRun {
  const result = spawnSync(process.execPath, [join('scripts', 'backup.mjs'), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, NODE_ENV: 'test', LOG_LEVEL: 'silent', APP_VERSION: '1.0.9-test', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
  const line = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith('{'))
    .at(-1)
  assert.ok(line, `备份没有输出 JSON：${result.stderr}`)
  return { status: result.status, json: JSON.parse(line) as Record<string, unknown>, stderr: result.stderr ?? '' }
}

function withDb(dir: string, fn: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(join(dir, 'db.sqlite'))
  try {
    fn(db)
  } finally {
    db.close()
  }
}

function writeFileRow(dir: string, id: string, createdAt: string, bytes = 'payload', options: { deleted?: boolean; origin?: string } = {}): void {
  mkdirSync(join(dir, 'files', id.slice(0, 2)), { recursive: true })
  writeFileSync(join(dir, 'files', id.slice(0, 2), id), bytes)
  withDb(dir, (db) => {
    db.prepare(
      `INSERT INTO files (id, parent_id, name, kind, size, mime, sha256, storage_key, created_at, updated_at, deleted_at, deleted_parent_id, origin)
       VALUES (?, NULL, ?, 'file', ?, 'text/plain', ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, `${id}.txt`, Buffer.byteLength(bytes), 'ab'.repeat(32), id, createdAt, createdAt, options.deleted ? createdAt : null, options.origin ?? 'user')
  })
}

function manifestOf(archive: string): { since: string | null; mode: string; createdAt: string; files: { id: string }[]; skippedMissing: string[] } {
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  assert.equal(listing.status, 0, listing.stderr)
  const name = listing.stdout.split(/\r?\n/).find((line) => /^backups\/manifest-.*\.json$/.test(line.trim()))
  assert.ok(name)
  const text = spawnSync('tar', ['-xOzf', archive, name.trim()], { encoding: 'utf8' })
  assert.equal(text.status, 0, text.stderr)
  return JSON.parse(text.stdout) as { since: string | null; mode: string; createdAt: string; files: { id: string }[]; skippedMissing: string[] }
}

function insertArchive(dir: string, row: {
  name: string
  mode: 'full' | 'inc'
  createdAt: string
  size?: number
  acked?: boolean
  deleted?: boolean
  manifest: unknown
}): void {
  withDb(dir, (db) => {
    const now = row.createdAt
    db.prepare(
      `INSERT INTO backup_archives (name, mode, created_at, sha256, size, file_count, pulled_at, acked_at, deleted_at, origin, manifest_json)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pi', ?)`,
    ).run(
      row.name,
      row.mode,
      row.createdAt,
      'cd'.repeat(32),
      row.size ?? 1,
      row.acked ? now : null,
      row.acked ? now : null,
      row.deleted ? now : null,
      JSON.stringify(row.manifest),
    )
  })
}

test('同毫秒写入、回收站和笔记附件进入下一次增量', () => {
  const dir = tempDataDir()
  try {
    const full = runBackup(dir, ['--prepare', '--full'])
    assert.equal(full.status, 0, full.stderr)
    const createdAt = String(full.json.createdAt)
    writeFileRow(dir, 'same-ms-file', createdAt)
    writeFileRow(dir, 'trash-file', '2020-01-01T00:00:00.000Z', 'trash', { deleted: true })
    writeFileRow(dir, 'note-file', '2020-01-01T00:00:00.000Z', 'note', { origin: 'note' })
    const inc = runBackup(dir, ['--prepare'])
    assert.equal(inc.status, 0, inc.stderr)
    assert.equal(inc.json.mode, 'inc')
    const manifest = manifestOf(String(inc.json.archive))
    assert.deepEqual(manifest.files.map((file) => file.id).sort(), ['note-file', 'same-ms-file', 'trash-file'])
    assert.equal(manifest.since, createdAt)
  } finally {
    cleanupDir(dir)
  }
})

test('时钟回拨仍按覆盖选文件，归档时间不早于最近本机归档', () => {
  const dir = tempDataDir()
  try {
    const full = runBackup(dir, ['--prepare', '--full'])
    assert.equal(full.status, 0, full.stderr)
    const name = String(full.json.archiveName)
    const sha = String(full.json.sha256)
    assert.equal(runBackup(dir, ['--ack', name, '--sha256', sha]).status, 0)
    const future = new Date(Date.now() + 3_600_000).toISOString()
    withDb(dir, (db) => {
      db.prepare('UPDATE backup_archives SET created_at = ? WHERE name = ?').run(future, name)
      db.prepare('UPDATE backup_state SET last_backup_at = ? WHERE id = 1').run(future)
    })
    writeFileRow(dir, 'during-rollback', new Date().toISOString())
    const inc = runBackup(dir, ['--prepare'])
    assert.equal(inc.status, 0, inc.stderr)
    assert.equal(inc.json.mode, 'inc')
    const createdAt = String(inc.json.createdAt)
    assert.ok(createdAt > future, `${createdAt} 应晚于被回拨抬高的归档 ${future}`)
    assert.equal((inc.json.clockSkew as { watermarkRollback: boolean }).watermarkRollback, true)
    assert.deepEqual(manifestOf(String(inc.json.archive)).files.map((file) => file.id), ['during-rollback'])
  } finally {
    cleanupDir(dir)
  }
})

test('旧 manifest、断链改为全量；pending 丢失时停止且保留证据', () => {
  const dir = tempDataDir()
  try {
    assert.equal(runBackup(dir, ['--pending']).status, 0)
    insertArchive(dir, {
      name: 'snapshot-20200101T000000000Z-full.tar.gz',
      mode: 'full',
      createdAt: '2020-01-01T00:00:00.000Z',
      acked: true,
      manifest: { schema: 1, mode: 'full' },
    })
    writeFileRow(dir, 'unproven-file', '2020-01-02T00:00:00.000Z')
    const full = runBackup(dir, ['--prepare'])
    assert.equal(full.status, 0, full.stderr)
    assert.equal(full.json.mode, 'full', '无法证明覆盖时生成新全量')
    assert.ok(manifestOf(String(full.json.archive)).files.some((file) => file.id === 'unproven-file'))

    const broken = tempDataDir()
    try {
      assert.equal(runBackup(broken, ['--pending']).status, 0)
      insertArchive(broken, {
        name: 'snapshot-20200101T000000000Z-full.tar.gz',
        mode: 'full',
        createdAt: '2020-01-01T00:00:00.000Z',
        acked: true,
        manifest: { schema: 1, mode: 'full', since: null, files: [] },
      })
      insertArchive(broken, {
        name: 'snapshot-20200102T000000000Z-inc.tar.gz',
        mode: 'inc',
        createdAt: '2020-01-02T00:00:00.000Z',
        acked: true,
        deleted: true,
        manifest: { schema: 1, mode: 'inc', since: '2020-01-01T00:00:00.000Z', files: [{ id: 'lost' }] },
      })
      const again = runBackup(broken, ['--prepare'])
      assert.equal(again.status, 0, again.stderr)
      assert.equal(again.json.mode, 'full', '全量之后的归档被删除即断链')
    } finally {
      cleanupDir(broken)
    }

    const missing = tempDataDir()
    try {
      assert.equal(runBackup(missing, ['--pending']).status, 0)
      insertArchive(missing, {
        name: 'snapshot-20200101T000000000Z-full.tar.gz',
        mode: 'full',
        createdAt: '2020-01-01T00:00:00.000Z',
        size: 4,
        manifest: { schema: 1, mode: 'full', since: null, files: [] },
      })
      const stopped = runBackup(missing, ['--prepare'])
      assert.notEqual(stopped.status, 0)
      assert.match(String(stopped.json.error), /已停止生成/)
      assert.match(String(stopped.json.error), /snapshot-20200101T000000000Z-full\.tar\.gz/)
      const db = new DatabaseSync(join(missing, 'db.sqlite'), { readOnly: true })
      try {
        const row = db.prepare('SELECT acked_at FROM backup_archives WHERE name = ?').get('snapshot-20200101T000000000Z-full.tar.gz') as { acked_at: string | null }
        assert.equal(row.acked_at, null)
      } finally {
        db.close()
      }
      const archives = existsSync(join(missing, 'backups'))
        ? readdirSync(join(missing, 'backups')).filter((name) => name.startsWith('snapshot-') && name.endsWith('.tar.gz'))
        : []
      assert.deepEqual(archives, [])
    } finally {
      cleanupDir(missing)
    }
  } finally {
    cleanupDir(dir)
  }
})

test('乱序确认后仍按清单覆盖，已确认归档可以不在本机', () => {
  const dir = tempDataDir()
  try {
    const full = runBackup(dir, ['--prepare', '--full'])
    assert.equal(full.status, 0, full.stderr)
    writeFileRow(dir, 'file-in-inc', new Date().toISOString())
    const inc = runBackup(dir, ['--prepare'])
    assert.equal(inc.status, 0, inc.stderr)
    assert.equal(inc.json.mode, 'inc')
    const incAck = runBackup(dir, ['--ack', String(inc.json.archiveName), '--sha256', String(inc.json.sha256)])
    assert.equal(incAck.status, 0, incAck.stderr)
    const fullAck = runBackup(dir, ['--ack', String(full.json.archiveName), '--sha256', String(full.json.sha256)])
    assert.equal(fullAck.status, 0, fullAck.stderr)
    writeFileSync(join(dir, 'backups', String(full.json.archiveName)), '')
    writeFileRow(dir, 'file-after-ack', new Date().toISOString())
    const next = runBackup(dir, ['--prepare'])
    assert.equal(next.status, 0, next.stderr)
    assert.equal(next.json.mode, 'inc')
    assert.deepEqual(manifestOf(String(next.json.archive)).files.map((file) => file.id), ['file-after-ack'])
  } finally {
    cleanupDir(dir)
  }
})

test('缺失文件找回后进入增量；明文与加密链可以混合', () => {
  const dir = tempDataDir()
  try {
    assert.equal(runBackup(dir, ['--pending']).status, 0)
    withDb(dir, (db) => {
      db.prepare(
        `INSERT INTO files (id, parent_id, name, kind, size, mime, sha256, storage_key, created_at, updated_at, deleted_at, deleted_parent_id)
         VALUES ('gone-then-back', NULL, 'gone.txt', 'file', 3, 'text/plain', ?, 'gone-then-back', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, NULL)`,
      ).run('ef'.repeat(32))
    })
    const full = runBackup(dir, ['--prepare', '--full'])
    assert.deepEqual(full.json.skippedMissing, ['gone-then-back'])
    assert.equal(runBackup(dir, ['--ack', String(full.json.archiveName), '--sha256', String(full.json.sha256)]).status, 0)
    mkdirSync(join(dir, 'files', 'go'), { recursive: true })
    writeFileSync(join(dir, 'files', 'go', 'gone-then-back'), 'yes')
    const cipherAt = new Date(Date.parse(String(full.json.createdAt)) + 1000).toISOString()
    const cipherName = 'snapshot-20200102T000000000Z-inc.tar.gz.age'
    const cipherPath = join(dir, 'backups', cipherName)
    writeFileSync(cipherPath, 'cipher-bytes')
    const cipherSize = Buffer.byteLength('cipher-bytes')
    const sidecar = {
      schema: 2,
      name: cipherName,
      mode: 'inc',
      createdAt: cipherAt,
      archiveFormat: 'tar.gz.age',
      encrypted: true,
      encryptedWith: 'age',
      recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      plainSha256: '11'.repeat(32),
      plainSize: 3,
      cipherSha256: 'ee'.repeat(32),
      cipherSize,
    }
    writeFileSync(`${cipherPath}.meta.json`, JSON.stringify(sidecar))
    insertArchive(dir, {
      name: cipherName,
      mode: 'inc',
      createdAt: cipherAt,
      size: cipherSize,
      manifest: { schema: 2, mode: 'inc', since: String(full.json.createdAt), files: [] },
    })
    const bad = runBackup(dir, ['--prepare'])
    assert.notEqual(bad.status, 0)
    assert.match(String(bad.json.error), /sidecar_invalid|已停止生成/)
    assert.equal(existsSync(cipherPath), true, '损坏的 pending 加密包必须保留')

    withDb(dir, (db) => {
      db.prepare('UPDATE backup_archives SET acked_at = created_at, pulled_at = created_at WHERE name = ?').run(cipherName)
    })
    const inc = runBackup(dir, ['--prepare'])
    assert.equal(inc.status, 0, inc.stderr)
    assert.equal(inc.json.mode, 'inc')
    assert.deepEqual(manifestOf(String(inc.json.archive)).files.map((file) => file.id), ['gone-then-back'])
  } finally {
    cleanupDir(dir)
  }
})
