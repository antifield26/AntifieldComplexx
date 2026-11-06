/** 使用临时 SQLite 与 tar 夹具运行 Windows PowerShell 演练；无主机或真实归档依赖。 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
        assert.equal(report.restoreOutput, null)
      } else {
        const error = { gap: 'chain_discontinuity', missing: 'restored_file_missing', corrupt: 'restored_file_sha256_mismatch' }[scenario]
        assert.ok(report.errors.some(({ code }) => code === error), result.stdout)
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('RestoreOutputDir 只在校验通过后发布，失败和已存在目录都不改归档', { skip: process.platform !== 'win32', timeout: 180_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'antifield-drill-restore-'))
  const start = '2026-06-01T00:00:00.000Z'
  const end = '2026-06-03T00:00:00.000Z'
  const hashed = ['aa-hashed', 'keep', sha256('keep'), 'note']
  const legacy = ['aa-legacy', 'size', null, 'user']
  function chain(backup, since) {
    const daily = join(backup, 'daily')
    mkdirSync(daily, { recursive: true })
    makeSnapshot(root, daily, { stamp: '20260601T000000Z', createdAt: start, since: null, files: [hashed], archived: [hashed] })
    makeSnapshot(root, daily, { stamp: '20260603T000000Z', createdAt: end, since, files: [hashed, legacy], archived: [legacy] })
  }
  function archiveHash(backup) {
    const daily = join(backup, 'daily')
    return readdirSync(daily).filter((name) => name.endsWith('.tar.gz')).sort().map((name) => sha256(readFileSync(join(daily, name))))
  }
  function run(backup, output) {
    return spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', drill,
      '-BackupRoot', backup,
      '-ExpectedSchemaVersion', String(SUPPORTED_SCHEMA_VERSION),
      '-SkipRemoteStatus',
      '-RestoreOutputDir', output,
    ], { encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: backup, TEMP: backup, TMP: backup }, timeout: 40_000 })
  }
  try {
    const successBackup = join(root, 'success')
    chain(successBackup, start)
    const before = archiveHash(successBackup)
    const output = join(root, 'restore-out')
    const success = run(successBackup, output)
    assert.ifError(success.error)
    assert.equal(success.status, 0, success.stdout + success.stderr)
    assert.deepEqual(archiveHash(successBackup), before)
    assert.equal(readFileSync(join(output, 'files', 'aa', 'aa-hashed'), 'utf8'), 'keep')
    assert.equal(readFileSync(join(output, 'files', 'aa', 'aa-legacy'), 'utf8'), 'size')
    assert.equal(existsSync(join(output, 'db.sqlite')), true)
    assert.equal(existsSync(join(output, 'backups')), false)
    const successReport = JSON.parse(readFileSync(join(successBackup, 'drills', readdirSync(join(successBackup, 'drills'))[0], 'report.json'), 'utf8'))
    assert.equal(realpathSync(successReport.restoreOutput).toLowerCase(), realpathSync(output).toLowerCase())

    const gapBackup = join(root, 'gap')
    chain(gapBackup, '2026-06-02T00:00:00.000Z')
    const gapBefore = archiveHash(gapBackup)
    const gapOutput = join(root, 'gap-out')
    const gap = run(gapBackup, gapOutput)
    assert.equal(gap.status, 1, gap.stdout)
    assert.equal(existsSync(gapOutput), false)
    assert.deepEqual(archiveHash(gapBackup), gapBefore)

    const existingBackup = join(root, 'existing')
    chain(existingBackup, start)
    const existingOutput = join(root, 'existing-out')
    mkdirSync(existingOutput)
    writeFileSync(join(existingOutput, 'marker.txt'), 'keep-me')
    const existingBefore = archiveHash(existingBackup)
    const existing = run(existingBackup, existingOutput)
    assert.equal(existing.status, 1, existing.stdout)
    assert.equal(readFileSync(join(existingOutput, 'marker.txt'), 'utf8'), 'keep-me')
    assert.equal(existsSync(join(existingOutput, 'db.sqlite')), false)
    assert.deepEqual(archiveHash(existingBackup), existingBefore)
    const existingReport = JSON.parse(readFileSync(join(existingBackup, 'drills', readdirSync(join(existingBackup, 'drills'))[0], 'report.json'), 'utf8'))
    assert.ok(existingReport.errors.some(({ code }) => code === 'restore_output_exists'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
