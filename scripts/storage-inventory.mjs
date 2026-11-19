/** 每日只读统计固定目录的已分配空间；输出类别及大小，隐藏真实路径。 */
import { lstat, readdir, readFile, rename, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const data = '/var/lib/antifieldcloud'
const groups = [
  ['应用数据', [data], '活动数据库、文件及 WAL'],
  ['备份', [join(data, 'backups'), join(data, 'world-backups'), '/var/backups/antifieldcloud'], '待确认归档、完整恢复链和回滚快照'],
  ['发布目录', ['/opt/antifieldcloud/releases', '/opt/mcbot/releases', '/opt/antifield-dsh/releases'], '当前、上一版本及回滚候选'],
  ['临时文件', [join(data, 'tmp')], '可能仍被上传或维护任务引用'],
]
export async function inventory(groupsToScan = groups, volume = data, now = Date.now()) {
  const fs = await statfs(volume)
  const device = (await lstat(volume)).dev
  const roots = new Set(groupsToScan.flatMap(([, paths]) => paths))
  const seen = new Set()
  const rows = []
  for (const [label, paths, reason] of groupsToScan) {
    const row = { label, bytes: 0, reclaimable: 0, complete: true, reason }
    async function walk(path, root) {
      let stat
      try { stat = await lstat(path) } catch (error) {
        if (!(error.code === 'ENOENT' && path === root)) row.complete = false
        return
      }
      if (stat.dev !== device || stat.isSymbolicLink() || (path !== root && roots.has(path))) return
      if (stat.nlink > 1 && stat.isFile()) {
        if (seen.has(stat.ino)) return
        seen.add(stat.ino)
      }
      const bytes = stat.blocks * 512
      row.bytes += bytes
      if (stat.isFile() && /^snapshot-[\dTZ-]+-(?:full|inc)\.tar\.gz\.plain\.tmp$/.test(path.slice(root.length + 1)) &&
          root === join(volume, 'backups') && stat.mtimeMs < now - 86400000) row.reclaimable += bytes
      if (!stat.isDirectory()) return
      let names
      try { names = await readdir(path) } catch { row.complete = false; return }
      for (const name of names) await walk(join(path, name), root)
    }
    for (const path of paths) await walk(path, path)
    rows.push(row)
  }
  const total = fs.blocks * fs.bsize
  const used = total - fs.bfree * fs.bsize
  rows.push({ label: '其他占用', reason: '主机上其余已用空间', bytes: Math.max(0, used - rows.reduce((sum, row) => sum + row.bytes, 0)), complete: rows.every(row => row.complete), reclaimable: 0 })
  return { at: new Date(now).toISOString(), complete: rows.every(row => row.complete), total, used, rows }
}

export async function saveInventory(destination, scan = inventory) {
  let prior
  try { prior = JSON.parse(await readFile(destination, 'utf8')) } catch { /* 首次采样。 */ }
  const previous = prior?.lastComplete ?? null
  let snapshot
  try { snapshot = await scan() } catch { snapshot = { at: new Date().toISOString(), complete: false, rows: [] } }
  const rows = snapshot.rows.map(row => {
    const baseline = previous?.rows.find(item => item.label === row.label)
    return { ...row, delta: baseline && row.complete ? row.bytes - baseline.bytes : null }
  })
  const tmp = destination + '.' + randomUUID()
  await writeFile(tmp, JSON.stringify({ snapshot: { ...snapshot, rows }, lastComplete: snapshot.complete ? snapshot : previous }), { flag: 'wx', mode: 0o644 })
  await rename(tmp, destination)
}
if (import.meta.main) await saveInventory('/var/lib/antifield-inventory/status.json')
