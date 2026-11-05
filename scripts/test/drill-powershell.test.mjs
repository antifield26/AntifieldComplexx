/** 使用临时 SQLite 与 tar 夹具运行 Windows PowerShell 演练；无主机或真实归档依赖。 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, URL } from 'node:url'
import { openDatabase, SUPPORTED_SCHEMA_VERSION } from '../../apps/workbench/server/src/db.ts'

const drill = fileURLToPath(new URL('../drill.ps1', import.meta.url))
const sha256 = (content) => createHash('sha256').update(content).digest('hex')

function pack(target, source, ...entries) {
  execFileSync('tar.exe', ['-czf', target, '-C', source, ...entries], { stdio: 'pipe' })
  writeFileSync(`${target}.sha256`, `${sha256(readFileSync(target))}  ${target.split(/[\\/]/).at(-1)}\n`)
}

function makeSnapshot(root, archiveDir, { stamp, createdAt, since, files, archived }) {
  const source = mkdtempSync(join(root, 'source-'))
  mkdirSync(join(source, 'backups'))
  mkdirSync(join(source, 'files', 'aa'), { recursive: true })
  const database = `backups/db-${stamp}.sqlite`
  const db = openDatabase({ path: join(source, database) })
  try {
    const insert = db.prepare(
      "INSERT INTO files (id, name, kind, size, sha256, created_at, updated_at, deleted_at, origin) VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?)",
    )
    for (const [id, data, hash, origin] of files) {
      insert.run(id, `${id}.bin`, data.length, hash, createdAt, createdAt, origin === 'user' ? createdAt : null, origin)
    }
  } finally {
    db.close()
  }
  for (const [id, data] of archived) writeFileSync(join(source, 'files', 'aa', id), data)
  const mode = since ? 'inc' : 'full'
  const manifest = {
    schema: 1, createdAt, since, mode, database,
    files: archived.map(([id, data]) => ({ id, size: data.length })),
    fileCount: archived.length,
    totalBytes: archived.reduce((sum, [, data]) => sum + data.length, 0),
  }
  writeFileSync(join(source, 'backups', `manifest-${stamp}.json`), JSON.stringify(manifest))
  pack(join(archiveDir, `snapshot-${stamp}-${mode}.tar.gz`), source, 'backups', 'files')
}

test('Windows 演练端到端校验增量覆盖、物理文件和世界解包', { skip: process.platform !== 'win32', timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'antifield-drill-test-'))
  try {
    const start = '2026-06-01T00:00:00.000Z'
    const end = '2026-06-03T00:00:00.000Z'
    const hashed = ['aa-hashed', 'keep', sha256('keep'), 'note']
    const legacy = ['aa-legacy', 'size', null, 'user']
    for (const scenario of ['continuous', 'gap', 'missing', 'corrupt']) {
      const backup = join(root, scenario)
      const daily = join(backup, 'daily')
      mkdirSync(daily, { recursive: true })
      makeSnapshot(root, daily, { stamp: '20260601T000000Z', createdAt: start, since: null, files: [hashed], archived: [hashed] })
      const archived = scenario === 'missing' ? [] : scenario === 'corrupt' ? [legacy, ['aa-hashed', 'bad!']] : [legacy]
      makeSnapshot(root, daily, {
        stamp: '20260603T000000Z', createdAt: end,
        since: scenario === 'gap' ? '2026-06-02T00:00:00.000Z' : start,
        files: [hashed, legacy], archived,
      })
      const worldSource = join(backup, 'fixture')
      mkdirSync(join(worldSource, 'world'), { recursive: true })
      writeFileSync(join(worldSource, 'world', 'level.dat'), 'world fixture')
      mkdirSync(join(backup, 'world'))
      pack(join(backup, 'world', 'world-20260601T000000Z.tar.gz'), worldSource, 'world')
      const result = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', drill, '-BackupRoot', backup,
        '-ExpectedSchemaVersion', String(SUPPORTED_SCHEMA_VERSION), '-IncludeWorld', '-RequireWorld', '-SkipRemoteStatus',
      ], { encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: backup, TEMP: backup, TMP: backup }, timeout: 20_000 })
      assert.ifError(result.error)
      assert.equal(result.status, scenario === 'continuous' ? 0 : 1, result.stdout + result.stderr)
      const reports = join(backup, 'drills')
      const report = JSON.parse(readFileSync(join(reports, readdirSync(reports)[0], 'report.json'), 'utf8'))
      assert.equal(report.world.extracted, true)
      if (scenario === 'continuous') {
        assert.equal(report.chainVerified, true)
        assert.deepEqual(report.files, { checked: 2, hashed: 1, sizeOnly: 1, missing: 0, invalid: 0 })
      } else {
        const error = { gap: 'chain_discontinuity', missing: 'restored_file_missing', corrupt: 'restored_file_sha256_mismatch' }[scenario]
        assert.ok(report.errors.some(({ code }) => code === error), result.stdout)
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
