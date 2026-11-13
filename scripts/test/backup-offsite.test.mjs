/**
 * backup-offsite.mjs 单元测试（纯函数 + 注入式 runner）：
 * - 归档名/时间戳解析、链感知保留、明文拒绝、状态构造/脱敏、参数校验；
 * - runOffsite 端到端使用临时目录与假 rclone（不访问网络/真实 rclone）。
 */
import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveMode,
  buildStatus,
  isEncryptedName,
  isPlaintextName,
  parseArgs,
  parseShaSidecar,
  parseStamp,
  planRetention,
  remoteBase,
  remoteJoin,
  runOffsite,
  sanitizeStatusText,
  selectUploadCandidates,
  validateMeta,
} from '../backup-offsite.mjs'

const SAMPLE_ARCHIVE = 'snapshot-20261020T040000Z-full.tar.gz.age'
const SAMPLE_INC = 'snapshot-20261021T040000Z-inc.tar.gz.age'

/** 远端夹具以密文、SHA 与元数据三件套表示已完整上传。 */
function completeSets(names) {
  return names.flatMap(name => [name, `${name}.sha256`, `${name}.meta.json`])
}

test('归档名与时间戳：6/9 位小数秒可解析，7/8 位也兼容', () => {
  assert.equal(parseStamp(SAMPLE_ARCHIVE), Date.UTC(2026, 9, 20, 4, 0, 0, 0))
  assert.equal(parseStamp('snapshot-20261020T040000123Z-full.tar.gz.age'), Date.UTC(2026, 9, 20, 4, 0, 0, 123))
  assert.equal(parseStamp('snapshot-20261020T0400001Z-inc.tar.gz.age'), Date.UTC(2026, 9, 20, 4, 0, 0, 100))
  assert.equal(parseStamp('snapshot-20261020T04000012Z-inc.tar.gz.age'), Date.UTC(2026, 9, 20, 4, 0, 0, 120))
  assert.equal(parseStamp('not-an-archive'), null)
  assert.equal(isEncryptedName(SAMPLE_ARCHIVE), true)
  assert.equal(isPlaintextName('snapshot-20261020T040000Z-full.tar.gz'), true)
  assert.equal(isEncryptedName('snapshot-20261020T040000Z-full.tar.gz'), false)
  assert.equal(archiveMode(SAMPLE_ARCHIVE), 'full')
  assert.equal(archiveMode(SAMPLE_INC), 'inc')
})

test('链感知保留：最新 full 及其后 inc + 最近 N 天保留，绝不删最新 full', () => {
  // 远端：旧 full + 旧 inc + 新 full + 新 inc（新 full 比 keepDays 早很多，只能靠链保留）
  const now = Date.UTC(2026, 10, 1)
  const remote = [
    'snapshot-20260901T040000Z-full.tar.gz.age',
    'snapshot-20260902T040000Z-inc.tar.gz.age',
    'snapshot-20260910T040000Z-full.tar.gz.age',
    'snapshot-20260911T040000Z-inc.tar.gz.age',
  ]
  const plan = planRetention(completeSets(remote), { keepDays: 5, now })
  assert.equal(plan.newestFull, 'snapshot-20260910T040000Z-full.tar.gz.age')
  assert.equal(plan.keep.includes('snapshot-20260910T040000Z-full.tar.gz.age'), true)
  assert.equal(plan.keep.includes('snapshot-20260911T040000Z-inc.tar.gz.age'), true)
  assert.equal(plan.remove.includes('snapshot-20260901T040000Z-full.tar.gz.age'), true)
  assert.equal(plan.remove.includes('snapshot-20260902T040000Z-inc.tar.gz.age'), true)
  // 最近 N 天内的旧链条目仍保留
  const recent = planRetention(completeSets(remote), { keepDays: 90, now })
  assert.equal(recent.remove.length, 0)
})

test('保留计划：远端为空/只有明文/无 full 时不误删', () => {
  assert.deepEqual(planRetention([], { keepDays: 30, now: Date.now() }), { keep: [], remove: [], newestFull: null })
  const noFull = planRetention(completeSets([SAMPLE_INC]), { keepDays: 1, now: Date.UTC(2026, 10, 1) })
  assert.equal(noFull.newestFull, null)
  assert.equal(noFull.remove.includes(SAMPLE_INC), true)
})

test('上传候选：只选未上传的加密归档，明文计入拒绝', () => {
  const local = [
    { name: SAMPLE_ARCHIVE, encrypted: true, stamp: parseStamp(SAMPLE_ARCHIVE) },
    { name: SAMPLE_INC, encrypted: true, stamp: parseStamp(SAMPLE_INC) },
    { name: 'snapshot-20261019T040000Z-full.tar.gz', encrypted: false, stamp: 1 },
  ]
  const result = selectUploadCandidates(local, completeSets([SAMPLE_ARCHIVE]))
  assert.deepEqual(result.candidates.map((item) => item.name), [SAMPLE_INC])
  assert.deepEqual(result.plaintextSkipped, ['snapshot-20261019T040000Z-full.tar.gz'])
})

test('元数据校验：与 Pi CLI sidecar schema 2 对齐（plain/cipher/recipient/name）', () => {
  const good = {
    schema: 2,
    name: SAMPLE_ARCHIVE,
    mode: 'full',
    createdAt: '2026-10-20T04:00:00.000Z',
    archiveFormat: 'tar.gz.age',
    encrypted: true,
    encryptedWith: 'age',
    recipient: 'age1qqqqqqqqqqqqqqqq',
    plainSha256: 'a'.repeat(64),
    plainSize: 123,
    cipherSha256: 'c'.repeat(64),
    cipherSize: 456,
  }
  assert.equal(validateMeta(good).ok, true)
  assert.equal(validateMeta({ ...good, schema: 1 }).error, 'meta_schema_invalid')
  assert.equal(validateMeta({ ...good, plainSha256: 'xyz' }).error, 'meta_plain_sha_invalid')
  assert.equal(validateMeta({ ...good, plainSize: -1 }).error, 'meta_plain_size_invalid')
  assert.equal(validateMeta({ ...good, recipient: 'not-age' }).error, 'meta_recipient_invalid')
  assert.equal(validateMeta({ ...good, encryptedWith: 'gpg' }).error, 'meta_encrypted_with_invalid')
  assert.equal(validateMeta({ ...good, cipherSha256: 'bad' }).error, 'meta_cipher_sha_invalid')
  assert.equal(validateMeta({ ...good, cipherSize: 0 }).error, 'meta_cipher_size_invalid')
  assert.equal(validateMeta(good, { name: SAMPLE_INC }).error, 'meta_name_mismatch')
  assert.equal(validateMeta(good, { cipherSha256: 'e'.repeat(64) }).error, 'meta_cipher_sha_mismatch')
  assert.equal(validateMeta(good, { cipherSize: 999 }).error, 'meta_cipher_size_mismatch')
  assert.equal(validateMeta(null).error, 'meta_invalid')
})

test('旁文件解析与状态脱敏：路径/凭据不进入状态文本', () => {
  assert.equal(parseShaSidecar('b'.repeat(64) + '  snapshot-x.tar.gz.age\n'), 'b'.repeat(64))
  assert.equal(parseShaSidecar('bad'), null)
  const text = 'rclone failed at C:\\Users\\me\\backups\\x and /var/lib/antifieldcloud/backups/y password=secret'
  const sanitized = sanitizeStatusText(text)
  assert.equal(sanitized.includes('C:\\Users'), false)
  assert.equal(sanitized.includes('/var/lib/antifieldcloud'), false)
  assert.equal(sanitized.includes('secret'), false)
  const status = buildStatus({ ok: false, remoteLabel: 'vps', error: text })
  assert.equal(status.ok, false)
  assert.equal(status.remoteLabel, 'vps')
  for (const field of ['lastRunAt', 'ok', 'remoteLabel', 'uploaded', 'skipped', 'failed', 'bytes', 'keptRemote', 'plaintextSkipped', 'error']) {
    assert.ok(Object.prototype.hasOwnProperty.call(status, field), `missing ${field}`)
  }
})

test('远端名称统一为 rclone 远端语法，不会落入本地目录或 Windows 盘符', () => {
  assert.equal(remoteBase('offsite', 'antifieldcloud/backups'), 'offsite:antifieldcloud/backups')
  assert.equal(remoteBase('offsite:', ''), 'offsite:')
  assert.equal(remoteBase('offsite', ''), 'offsite:')
  assert.equal(remoteBase('offsite:', '/backups/'), 'offsite:backups')
  assert.throws(() => remoteBase('offsite', '../escape'))
  for (const invalid of ['bad remote', 'C', 'C:', 'offsite:folder', 'offsite::', ':local:', '--flag', './local']) {
    assert.throws(() => remoteBase(invalid, ''), /invalid_remote/)
  }
  assert.equal(remoteJoin('offsite', 'backups', SAMPLE_ARCHIVE), `offsite:backups/${SAMPLE_ARCHIVE}`)
  assert.equal(remoteJoin('offsite', '', SAMPLE_ARCHIVE), `offsite:${SAMPLE_ARCHIVE}`)
  assert.throws(() => remoteJoin('offsite', 'backups', '../x'))
  assert.throws(() => remoteJoin('offsite', '', '..'))
})

test('CLI 参数：未知参数报错，dry-run/解析数字生效', () => {
  const options = parseArgs(['--backup-root', 'x', '--remote', 'offsite', '--keep-days', '7', '--dry-run', '--rclone-config', 'restricted config'])
  assert.equal(options.rcloneConfig, 'restricted config')
  assert.equal(options.keepDays, 7)
  assert.equal(options.dryRun, true)
  assert.throws(() => parseArgs(['--evil', 'x']))
  assert.throws(() => parseArgs(['--remote']))
})

/** 构造临时备份根：加密归档 + sidecar + meta，外加一个明文归档。 */
function makeBackupFixture() {
  const root = mkdtempSync(join(tmpdir(), 'afc-offsite-'))
  const daily = join(root, 'daily', '2026-10-20')
  mkdirSync(daily, { recursive: true })
  const encrypted = join(daily, SAMPLE_ARCHIVE)
  writeFileSync(encrypted, 'ciphertext-bytes')
  writeFileSync(`${encrypted}.sha256`, `${'c'.repeat(64)}  ${SAMPLE_ARCHIVE}\n`)
  writeFileSync(
    `${encrypted}.meta.json`,
    JSON.stringify({
      schema: 2,
      name: SAMPLE_ARCHIVE,
      mode: 'full',
      createdAt: '2026-10-20T04:00:00.000Z',
      archiveFormat: 'tar.gz.age',
      encrypted: true,
      encryptedWith: 'age',
      recipient: 'age1qqqqqqqqqqqqqqqq',
      plainSha256: 'd'.repeat(64),
      plainSize: 321,
      cipherSha256: 'c'.repeat(64),
      cipherSize: Buffer.byteLength('ciphertext-bytes'),
    }),
  )
  const plaintext = join(daily, 'snapshot-20261019T040000Z-full.tar.gz')
  writeFileSync(plaintext, 'plaintext-bytes')
  return { root, encrypted, plaintext }
}

test('runOffsite：只上传加密归档 + 伴随文件，拒绝明文，状态 ok', async () => {
  const fixture = makeBackupFixture()
  const commands = []
  const remoteNames = []
  const runRclone = async (args) => {
    assert.ok(args.at(-1).startsWith('offsite:'), '列表、上传、大小确认和删除都必须指向显式远端')
    commands.push(args)
    if (args[0] === 'lsf') return { code: 0, stdout: remoteNames.join('\n'), stderr: '' }
    if (args[0] === 'copyto') { remoteNames.push(args.at(-1).split(/[/:]/).at(-1)); return { code: 0, stdout: '', stderr: '' } }
    if (args[0] === 'size') return { code: 0, stdout: JSON.stringify({ bytes: Buffer.byteLength('ciphertext-bytes') }), stderr: '' }
    if (args[0] === 'deletefile') return { code: 0, stdout: '', stderr: '' }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
  try {
    const result = await runOffsite(
      {
        backupRoot: fixture.root,
        remote: 'offsite',
        remotePath: 'antifieldcloud/backups',
        remoteLabel: 'test-vps',
        keepDays: 30,
        maxDelete: 50,
        dryRun: false,
        verify: true,
        rcloneBin: 'rclone',
      },
      { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} },
    )
    assert.equal(result.exitCode, 0, JSON.stringify(result.status))
    assert.equal(result.status.ok, true)
    assert.equal(result.status.uploaded, 1)
    assert.equal(result.status.plaintextSkipped, 1)
    assert.equal(result.status.bytes, Buffer.byteLength('ciphertext-bytes'))
    const uploads = commands.filter((args) => args[0] === 'copyto').map((args) => args[args.length - 1])
    assert.ok(uploads.some((target) => target.endsWith(SAMPLE_ARCHIVE)))
    assert.ok(uploads.some((target) => target.endsWith(`${SAMPLE_ARCHIVE}.sha256`)))
    assert.ok(uploads.some((target) => target.endsWith(`${SAMPLE_ARCHIVE}.meta.json`)))
    assert.ok(!uploads.some((target) => target.endsWith('.tar.gz')), '不得上传明文归档')
    assert.equal(remoteNames.length, 3, '远端完整集经过上传后列表确认')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('runOffsite：缺少 sidecar/meta 的加密归档失败且不上传', async () => {
  const fixture = makeBackupFixture()
  const encrypted = fixture.encrypted
  rmSync(`${encrypted}.meta.json`)
  const commands = []
  const runRclone = async (args) => {
    commands.push(args)
    if (args[0] === 'lsf') return { code: 0, stdout: '', stderr: '' }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  try {
    const result = await runOffsite(
      { backupRoot: fixture.root, remote: 'offsite', remotePath: '', remoteLabel: 'x', keepDays: 30, maxDelete: 50, dryRun: false, verify: false, rcloneBin: 'rclone' },
      { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} },
    )
    assert.equal(result.status.failed, 1)
    assert.equal(result.status.ok, false)
    assert.equal(commands.filter((args) => args[0] === 'copyto').length, 0)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('runOffsite：远端旧链条目按保留计划删除，最新 full 永不在删除列表', async () => {
  const fixture = makeBackupFixture()
  const oldFull = 'snapshot-20260901T040000Z-full.tar.gz.age'
  const oldInc = 'snapshot-20260902T040000Z-inc.tar.gz.age'
  const remoteNames = completeSets([oldFull, oldInc, SAMPLE_ARCHIVE])
  const deleted = []
  const runRclone = async (args) => {
    if (args[0] === 'lsf') return { code: 0, stdout: remoteNames.join('\n'), stderr: '' }
    if (args[0] === 'copyto') return { code: 0, stdout: '', stderr: '' }
    if (args[0] === 'size') return { code: 0, stdout: JSON.stringify({ bytes: Buffer.byteLength('ciphertext-bytes') }), stderr: '' }
    if (args[0] === 'deletefile') { deleted.push(args[args.length - 1]); return { code: 0, stdout: '', stderr: '' } }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
  try {
    const result = await runOffsite(
      { backupRoot: fixture.root, remote: 'offsite', remotePath: 'b', remoteLabel: 'x', keepDays: 5, maxDelete: 50, dryRun: false, verify: false, rcloneBin: 'rclone' },
      { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} },
    )
    assert.equal(result.exitCode, 0, JSON.stringify(result.status))
    assert.ok(deleted.some((target) => target.endsWith(oldFull)))
    assert.ok(deleted.some((target) => target.endsWith(oldInc)))
    assert.ok(!deleted.some((target) => target.endsWith(SAMPLE_ARCHIVE)))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('runOffsite：delete 数量超过 maxDelete 时安全失败', async () => {
  const fixture = makeBackupFixture()
  const many = Array.from({ length: 5 }, (_, index) => `snapshot-2026${String(index + 1).padStart(2, '0')}01T040000Z-full.tar.gz.age`)
  const runRclone = async (args) => {
    if (args[0] === 'lsf') return { code: 0, stdout: completeSets(many).join('\n'), stderr: '' }
    if (args[0] === 'copyto') { if (!many.includes(SAMPLE_ARCHIVE)) many.push(SAMPLE_ARCHIVE); return { code: 0, stdout: '', stderr: '' } }
    if (args[0] === 'size') return { code: 0, stdout: JSON.stringify({ bytes: Buffer.byteLength('ciphertext-bytes') }), stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  try {
    const result = await runOffsite(
      { backupRoot: fixture.root, remote: 'offsite', remotePath: '', remoteLabel: 'x', keepDays: 0, maxDelete: 1, dryRun: false, verify: false, rcloneBin: 'rclone' },
      { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} },
    )
    assert.equal(result.exitCode, 1)
    assert.equal(result.status.ok, false)
    assert.match(result.status.error ?? '', /delete_limit_exceeded/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('残缺的新 full 不作为删除旧完整链的基线，并继续作为补传候选', () => {
  const oldFull = 'snapshot-20260901T040000Z-full.tar.gz.age'
  const oldInc = 'snapshot-20260902T040000Z-inc.tar.gz.age'
  const remote = [...completeSets([oldFull, oldInc]), SAMPLE_ARCHIVE, `${SAMPLE_ARCHIVE}.sha256`]
  const plan = planRetention(remote, { keepDays: 1, now: Date.UTC(2026, 10, 1) })
  assert.equal(plan.newestFull, oldFull)
  assert.deepEqual(plan.keep, [oldFull, oldInc])
  assert.deepEqual(plan.remove, [])
  const candidates = selectUploadCandidates([{ name: SAMPLE_ARCHIVE, encrypted: true, stamp: parseStamp(SAMPLE_ARCHIVE) }], remote)
  assert.equal(candidates.candidates.length, 1)
})

test('伴随文件失败时禁止删除，下一轮补齐后才允许淘汰旧链', async (t) => {
  for (const failedSuffix of ['.sha256', '.meta.json']) {
    await t.test(failedSuffix, async () => {
      const fixture = makeBackupFixture()
      const oldFull = 'snapshot-20260901T040000Z-full.tar.gz.age'
      const remote = new Set(completeSets([oldFull]))
      const commands = []
      let failOnce = true
      const runRclone = async (args) => {
        commands.push(args)
        const name = args.at(-1).split(/[/:]/).at(-1)
        if (args[0] === 'lsf') return { code: 0, stdout: [...remote].join('\n'), stderr: '' }
        if (args[0] === 'copyto') {
          assert.ok(args.includes('--checksum'))
          assert.ok(args.includes('--immutable'))
          if (failOnce && name.endsWith(failedSuffix)) {
            failOnce = false
            return { code: 1, stdout: '', stderr: 'fixture_transfer_failed' }
          }
          remote.add(name)
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'size') return { code: 0, stdout: JSON.stringify({ bytes: Buffer.byteLength('ciphertext-bytes') }), stderr: '' }
        if (args[0] === 'deletefile') { remote.delete(name); return { code: 0, stdout: '', stderr: '' } }
        return { code: 1, stdout: '', stderr: 'unexpected' }
      }
      const options = { backupRoot: fixture.root, remote: 'offsite', remotePath: '', remoteLabel: 'fixture', keepDays: 1, maxDelete: 50, dryRun: false, verify: true }
      const deps = { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} }
      try {
        const first = await runOffsite(options, deps)
        assert.equal(first.status.ok, false)
        assert.equal(first.status.error, 'partial_failure_no_retention')
        assert.equal(commands.filter(args => args[0] === 'deletefile').length, 0)
        assert.ok(remote.has(oldFull), '保留唯一完整 full')
        const offset = commands.length
        const second = await runOffsite(options, deps)
        assert.equal(second.status.ok, true, JSON.stringify(second.status))
        assert.equal(second.status.uploaded, 1)
        assert.equal(commands.slice(offset).filter(args => args[0] === 'copyto').length, 3)
        assert.ok(completeSets([SAMPLE_ARCHIVE]).every(name => remote.has(name)))
        assert.equal(remote.has(oldFull), false, '新 full 完整确认后才允许删除旧链')
        const thirdOffset = commands.length
        const third = await runOffsite(options, deps)
        assert.equal(third.status.ok, true)
        assert.equal(commands.slice(thirdOffset).filter(args => args[0] === 'copyto').length, 0, '完整集已上传后重跑幂等')
      } finally { rmSync(fixture.root, { recursive: true, force: true }) }
    })
  }
})

test('上传后列表失败或缺少新伴随文件时失败关闭，不执行保留删除', async (t) => {
  for (const fault of ['list_failed', 'missing_meta']) {
    await t.test(fault, async () => {
      const fixture = makeBackupFixture()
      const oldFull = 'snapshot-20260901T040000Z-full.tar.gz.age'
      const remote = new Set(completeSets([oldFull]))
      let lists = 0
      let deletions = 0
      const runRclone = async (args) => {
        const name = args.at(-1).split(/[/:]/).at(-1)
        if (args[0] === 'lsf') {
          lists += 1
          if (lists === 2 && fault === 'list_failed') return { code: 1, stdout: [...remote].join('\n'), stderr: 'fixture_list_failed' }
          if (lists === 2) remote.delete(`${SAMPLE_ARCHIVE}.meta.json`)
          return { code: 0, stdout: [...remote].join('\n'), stderr: '' }
        }
        if (args[0] === 'copyto') { remote.add(name); return { code: 0, stdout: '', stderr: '' } }
        if (args[0] === 'deletefile') deletions += 1
        return { code: 0, stdout: '', stderr: '' }
      }
      try {
        const result = await runOffsite(
          { backupRoot: fixture.root, remote: 'offsite', remotePath: '', remoteLabel: 'x', keepDays: 1, maxDelete: 50, dryRun: false, verify: false },
          { runRclone, sha256File: async () => 'c'.repeat(64), now: () => Date.UTC(2026, 10, 1), logger: () => {} },
        )
        assert.equal(result.status.ok, false)
        assert.equal(result.status.error, fault === 'list_failed' ? 'remote_confirmation_failed' : 'partial_failure_no_retention')
        assert.equal(deletions, 0)
        assert.ok(remote.has(oldFull))
      } finally { rmSync(fixture.root, { recursive: true, force: true }) }
    })
  }
})

test('远端大小查询失败或响应不合法时禁止删除', async (t) => {
  for (const response of [{ code: 1, stdout: '', stderr: 'fixture_size_failed' }, { code: 0, stdout: '{}', stderr: '' }]) {
    await t.test(String(response.code), async () => {
      const fixture = makeBackupFixture()
      let deletions = 0
      const runRclone = async (args) => {
        if (args[0] === 'lsf') return { code: 0, stdout: '', stderr: '' }
        if (args[0] === 'size') return response
        if (args[0] === 'deletefile') deletions += 1
        return { code: 0, stdout: '', stderr: '' }
      }
      try {
        const result = await runOffsite(
          { backupRoot: fixture.root, remote: 'offsite', remotePath: '', remoteLabel: 'x', keepDays: 1, maxDelete: 50, dryRun: false, verify: true },
          { runRclone, sha256File: async () => 'c'.repeat(64), logger: () => {} },
        )
        assert.equal(result.status.ok, false)
        assert.equal(deletions, 0)
      } finally { rmSync(fixture.root, { recursive: true, force: true }) }
    })
  }
})
