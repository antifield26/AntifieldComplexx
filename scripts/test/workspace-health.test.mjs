/** 只读恢复链、状态证据和磁盘快照的离线成功与失败夹具。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloudChain, downloadChain } from '../cloud-drill.mjs'
import { inventory, saveInventory } from '../storage-inventory.mjs'
import { backupHealth } from '../../apps/workbench/server/src/backups/health.ts'
import { preserveSuccessfulStatus } from '../antifield-maint.mjs'

const full = 'snapshot-20260601T000000Z-full.tar.gz.age'
const inc = 'snapshot-20260602T000000Z-inc.tar.gz.age'
const listing = [full, inc].flatMap(name => [name, name + '.sha256', name + '.meta.json'])

test('云端取回只下载最新链，拒绝缺件和下载失败', async t => {
  assert.deepEqual(cloudChain([...listing].reverse()), [full, inc])
  assert.throws(() => cloudChain(listing.slice(0, -1)), /incomplete/)
  assert.throws(() => cloudChain([inc]), /full_missing/)
  const root = await mkdtemp(join(tmpdir(), 'cloud-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const copied = []
  const list = { code: 0, stdout: listing.join('\n') }
  await downloadChain('cloud', '', join(root, 'good'), async args => {
    if (args[0] === 'lsf') return list
    assert.equal(args[0], 'copyto')
    copied.push(args[1])
    return { code: 0 }
  })
  assert.deepEqual(copied, listing.map(name => 'cloud:' + name))
  await assert.rejects(downloadChain('cloud', '', join(root, 'bad'), async args => args[0] === 'lsf' ? list : { code: 1 }), /download_failed/)
})

test('采样中断保留完整快照，增长以完整采样为基线', async t => {
  const root = await mkdtemp(join(tmpdir(), 'inventory-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'status.json')
  const scan = bytes => ({ complete: true, at: new Date().toISOString(), rows: [{ label: '应用', bytes, complete: true }] })
  await saveInventory(file, () => scan(10))
  await saveInventory(file, () => { throw new Error('io') })
  let data = JSON.parse(await readFile(file))
  assert.equal(data.lastComplete.rows[0].bytes, 10)
  assert.equal(data.snapshot.complete, false)
  await saveInventory(file, () => scan(22))
  data = JSON.parse(await readFile(file))
  assert.equal(data.snapshot.rows[0].delta, 12)
})

test('失败保留恢复水位，未知证据优先于已成功项目', () => {
  const at = '2026-06-01T00:00:00.000Z'
  const state = preserveSuccessfulStatus({ ok: false }, { recoveryPoint: at }, 'cloud-drill')
  assert.equal(state.recoveryPoint, at)
  const base = { severity: 'warning', title: '演练', message: '演练结果', details: {} }
  const items = backupHealth([{ ...base, event: 'world_backup_stale', status: 'ok' }, { ...base, event: 'drill_stale', status: 'unknown' }])
  assert.deepEqual(items.map(item => item.state), ['尚无证据', '正常', '未启用'])
})

test('盘点按目录归类，保留当前归档并跳过链接', { skip: process.platform !== 'linux' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'scan-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const backups = join(root, 'backups')
  await mkdir(backups)
  const old = join(backups, full.replace('.age', '.plain.tmp'))
  await writeFile(old, 'expired')
  await utimes(old, 0, 0)
  await writeFile(join(backups, full), 'protected')
  await symlink(backups, join(root, 'link'))
  const result = await inventory([['数据', [root], '活动文件'], ['归档', [backups], '保护恢复链']], root)
  assert.equal(result.complete, true)
  assert.ok(result.rows[1].reclaimable > 0 && result.rows[1].reclaimable < result.rows[1].bytes)
  assert.equal(result.rows[0].reclaimable, 0)
  assert.equal(await readFile(join(backups, full), 'utf8'), 'protected')
})
