/** 使用临时 SQLite 与 tar 夹具运行 Windows PowerShell 演练；无主机或真实归档依赖。 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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

test('Windows 演练流式接收 age 二进制输出并拒绝失败进程', { skip: process.platform !== 'win32', timeout: 90_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'antifield-drill-age-'))
  const daily = join(root, 'daily')
  const archive = 'snapshot-20260601T000000Z-full.tar.gz'
  const age = join(root, 'fake-age.exe')
  const env = { ...process.env, LOCALAPPDATA: root, TEMP: root, TMP: root }
  const launch = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
  try {
    const fixture = `
      $ErrorActionPreference = 'Stop'
      Add-Type -OutputAssembly '${age.replaceAll("'", "''")}' -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public static class FakeAge {
  public static int Main(string[] args) {
    var remote = Environment.GetEnvironmentVariable("DRILL_FIXTURE_REMOTE");
    if (args.Length == 5 && args[0] == "lsf" && args[4] == "fixture:") {
      foreach (var path in Directory.GetFiles(remote)) Console.WriteLine(Path.GetFileName(path));
      return 0;
    }
    if (args.Length == 3 && args[0] == "copyto" && args[1].StartsWith("fixture:snapshot-")) {
      File.Copy(Path.Combine(remote, Path.GetFileName(args[1].Substring(8))), args[2]);
      return 0;
    }
    if (args.Length != 6 || args[0] != "-d" || args[1] != "-i" || args[3] != "-o" || args[4] != "-") return 2;
    using (var archive = File.OpenRead(args[5])) archive.CopyTo(Console.OpenStandardOutput());
    if (File.ReadAllText(args[2]) != "reject") return 0;
    Console.Error.WriteLine(args[2]);
    return 7;
  }
}
'@
    `
    const compiled = spawnSync('powershell.exe', [...launch, '-EncodedCommand', Buffer.from(fixture, 'utf16le').toString('base64')],
      { encoding: 'utf8', env, timeout: 15_000 })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)

    mkdirSync(daily)
    makeSnapshot(root, daily, {
      stamp: '20260601T000000Z', createdAt: '2026-06-01T00:00:00.000Z', since: null, files: [], archived: [],
    })
    const plain = join(daily, archive)
    const ciphertext = `${plain}.age`
    const payload = readFileSync(plain)
    const hash = sha256(payload)
    writeFileSync(ciphertext, payload)
    writeFileSync(`${ciphertext}.sha256`, `${hash}  ${archive}.age\n`)
    writeFileSync(`${ciphertext}.meta.json`, JSON.stringify({
      schema: 2, name: `${archive}.age`, archiveFormat: 'tar.gz.age', encrypted: true, encryptedWith: 'age',
      recipient: `age1${'a'.repeat(32)}`, plainSha256: hash, plainSize: payload.length,
      cipherSha256: hash, cipherSize: payload.length,
    }))
    unlinkSync(plain)
    unlinkSync(`${plain}.sha256`)

    copyFileSync(age, join(root, 'rclone.exe'))
    const cases = ['accept', 'reject', 'cloud']
    if (spawnSync('where.exe', ['pwsh.exe']).status === 0) cases.push('cloud-pwsh')
    else t.diagnostic('未安装 PowerShell 7，跳过其云端演练分支')
    for (const identityMode of cases) {
      const cloud = identityMode.startsWith('cloud')
      const identity = join(root, `${identityMode}-fixture-identity.txt`)
      const reports = join(root, `${identityMode}-reports`)
      writeFileSync(identity, identityMode)
      const result = spawnSync(identityMode === 'cloud-pwsh' ? 'pwsh.exe' : 'powershell.exe', [
        ...launch, '-File', drill, '-BackupRoot', cloud ? join(root, 'empty-local') : root, '-ReportRoot', reports,
        ...(cloud ? ['-CloudRemote', 'fixture'] : []),
        '-AgeExe', age, '-AgeIdentityPath', identity, '-SkipRemoteStatus',
      ], { encoding: 'utf8', env: { ...env, PATH: root + ';' + process.env.PATH, DRILL_FIXTURE_REMOTE: daily }, timeout: 30_000 })
      assert.ifError(result.error)
      const accepted = identityMode !== 'reject'
      assert.equal(result.status, accepted ? 0 : 1, result.stdout + result.stderr)
      const reportRoot = cloud ? join(reports, 'cloud') : reports
      const reportText = readFileSync(join(reportRoot, readdirSync(reportRoot)[0], 'report.json'), 'utf8')
      const report = JSON.parse(reportText)
      assert.equal(report.chainVerified, accepted)
      if (accepted) {
        assert.match(report.recoveryPoint, /^2026-06-01T00:00:00(?:\.\d+)?Z$/)
        assert.equal(Date.parse(report.recoveryPoint), Date.parse('2026-06-01T00:00:00Z'))
      }
      if (!accepted) {
        assert.ok(report.errors.some(({ code, message }) => code === 'encrypted_decrypt_failed' && message.includes('exit=7')))
        assert.ok(!reportText.includes('reject-fixture-identity.txt'))
      }
      assert.ok(!readdirSync(root).some((name) => /^antifieldcloud-drill-/.test(name)))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** 托管机临时目录可能是 8.3 短名，演练报告保存 .NET 展开后的长路径。按目录标识比较。 */
function assertSameDirectory(actual, expected) {
  const left = statSync(actual)
  const right = statSync(expected)
  assert.equal(left.isDirectory(), true)
  assert.equal(right.isDirectory(), true)
  assert.equal(`${left.dev}:${left.ino}`, `${right.dev}:${right.ino}`)
}

test('RestoreOutputDir 只在校验通过后发布，失败和已存在目录都不改归档', { skip: process.platform !== 'win32', timeout: 180_000 }, () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'antifield-drill-restore-')))
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
    assertSameDirectory(successReport.restoreOutput, output)

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
