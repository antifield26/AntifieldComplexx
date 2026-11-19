/** 只读下载应用密文及旁文件，交由 Windows 隔离演练核验。 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ENCRYPTED_PATTERN, archiveMode, parseStamp, remoteJoin, remoteBase, createRcloneRunner } from './backup-offsite.mjs'

export function cloudChain(names) {
  const found = new Set(names)
  const bases = [...new Set(names.map(name => name.replace(/(?:\.sha256|\.meta\.json)$/, '')).filter(name => ENCRYPTED_PATTERN.test(name)))]
  bases.sort((a, b) => parseStamp(a) - parseStamp(b) || a.localeCompare(b))
  const full = bases.findLastIndex(name => archiveMode(name) === 'full')
  if (full < 0) throw new Error('cloud_full_missing')
  const selected = bases.slice(full)
  for (const name of selected) {
    for (const suffix of ['', '.sha256', '.meta.json']) if (!found.has(name + suffix)) throw new Error('cloud_chain_incomplete')
  }
  return selected
}

export async function downloadChain(remote, path, destination, run) {
  const base = remoteBase(remote, path)
  const listed = await run(['lsf', '--files-only', '--max-depth', '1', base])
  if (listed.code !== 0) throw new Error('cloud_list_failed')
  const selected = cloudChain(listed.stdout.split(/\r?\n/))
  await mkdir(destination)
  for (const name of selected) {
    for (const suffix of ['', '.sha256', '.meta.json']) {
      const file = name + suffix
      const result = await run(['copyto', remoteJoin(remote, path, file), join(destination, file)])
      if (result.code !== 0) throw new Error('cloud_download_failed')
    }
  }
}
if (import.meta.main) {
  const [remote, path, destination, config] = process.argv.slice(2)
  try { await downloadChain(remote, path, destination, createRcloneRunner('rclone', config)) }
  catch (error) { console.error(/^cloud_[a-z_]+$/.test(error.message) ? error.message : 'cloud_download_failed'); process.exitCode = 1 }
}
