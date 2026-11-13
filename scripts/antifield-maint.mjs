#!/usr/local/bin/node
/** 固定维护动词的提权边界。拒绝任意命令、环境覆盖、路径和脚本；不提供部署或配置写权限。 */
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, readdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = '/var/lib/antifieldcloud'
const MAX_STATUS = 64 * 1024
const STATE_NAMES = { pull: 'backup-pull.json', world: 'world-pull-status.json', drill: 'drill-status.json', offsite: 'backup-offsite-status.json' }
const READ_STATES = new Set([...Object.values(STATE_NAMES), 'world-backup-status.json'].map(name => `${BASE}/${name}`))
const PUBLIC_KEYS = new Set(['BACKUP_ARCHIVE_ENCRYPTION', 'BACKUP_AGE_RECIPIENT_FILE', 'BACKUP_OFFSITE_STATUS_FILE', 'ALERT_OFFSITE_MAX_AGE_HOURS', 'CHATBOT_AI_CONTEXT_READ_ENABLED', 'CHATBOT_CONTEXT_DIR'])
const HASH_PATHS = new Set([
  '/etc/systemd/system/antifieldcloud.service', '/etc/systemd/system/antifieldcloud-world.service',
  '/etc/systemd/system/antifieldcloud-world.timer', '/etc/systemd/system/antifieldcloud-health.service',
  '/etc/systemd/system/antifieldcloud-health.timer', '/etc/systemd/system/searxng.service',
  '/etc/systemd/system/nftables.service.d/10-fail2ban-restore.conf',
  '/usr/local/libexec/antifieldcloud-health.sh', '/usr/local/libexec/antifield-maint.mjs',
  '/usr/local/libexec/antifield-backup-secrets.sh', '/usr/local/sbin/antifield-maint',
])
const ARCHIVE = /^snapshot-\d{8}T\d{6,9}Z(?:-\d+)?-(?:full|inc)\.tar\.gz(?:\.age)?$/
const WORLD = /^world-\d{8}T\d{6}Z\.tar\.gz$/
const SHA = /^[a-f0-9]{64}$/

/** 在打开的同一普通文件句柄上限长读取，拒绝链接、设备和读取期间增长。 */
export function boundedFile(file, max = MAX_STATUS, owner) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > max || (owner !== undefined && stat.uid !== owner)) throw new Error('invalid_file')
    const buffer = Buffer.alloc(max + 1)
    let size = 0
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null)
      if (!n) break
      size += n
    }
    if (size > max) throw new Error('file_too_large')
    return buffer.subarray(0, size)
  } finally { closeSync(fd) }
}

/** 只有这些参数能抵达子进程；不使用 shell，也不接受可执行文件或用户指定环境。 */
export function maintenanceCommand(args) {
  const [verb, ...rest] = args
  if (verb === 'read-status' && rest.length === 1 && READ_STATES.has(rest[0])) { process.stdout.write(boundedFile(rest[0])); return }
  const backup = ['--pending', '--prepare', '--snapshot-db']
  if (verb === 'backup') {
    const valid = rest.length === 1 && backup.includes(rest[0]) ||
      rest.length === 2 && rest[0] === '--prepare' && rest[1] === '--full' ||
      rest.length === 4 && rest[0] === '--ack' && ARCHIVE.test(rest[1]) && rest[2] === '--sha256' && SHA.test(rest[3])
    if (valid) return ['/usr/sbin/runuser', ['-u', 'antifieldcloud', '--', '/usr/local/bin/node', '/opt/antifieldcloud/current/scripts/backup.mjs', ...rest, '--no-warnings']]
  }
  if (verb === 'secrets' && (!rest.length || rest.length === 1 && rest[0] === '--include-host-config')) {
    return ['/usr/bin/flock', ['-n', '/run/lock/antifield-secrets.lock', '/usr/bin/timeout', '-k', '10', '300', '/bin/bash', '/usr/local/libexec/antifield-backup-secrets.sh', ...rest]]
  }
  if (verb === 'nft' && !rest.length) return ['/usr/sbin/nft', ['list', 'ruleset']]
  if (verb === 'fail2ban' && rest.length === 1 && ['status', 'bantime'].includes(rest[0])) {
    return ['/usr/bin/fail2ban-client', rest[0] === 'status' ? ['status', 'sshd'] : ['get', 'sshd', 'bantime']]
  }
  throw new Error('command_denied')
}

export function validateState(kind, raw) {
  if (!Object.hasOwn(STATE_NAMES, kind) || raw.length > MAX_STATUS) throw new Error('invalid_status')
  const value = JSON.parse(raw.toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_status')
  const normalized = Buffer.from(JSON.stringify(value) + '\n')
  if (normalized.length > MAX_STATUS) throw new Error('invalid_status')
  return normalized
}

function trusted(file) {
  // 固定脚本和所有祖先必须由 root 持有且不可被组或其他用户写入。
  let cursor = resolve(file)
  for (;;) {
    const stat = lstatSync(cursor)
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022)) throw new Error('untrusted_maintenance_file')
    if (cursor === '/') break
    cursor = dirname(cursor)
  }
}

function writeState(kind, source) {
  if (!/^\/tmp\/antifieldcloud-(?:pull|world-pull|drill|offsite)-[a-f0-9]{8,32}\.json$/.test(source)) throw new Error('invalid_status_source')
  const uid = Number(process.env.SUDO_UID)
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('invalid_caller')
  const raw = validateState(kind, boundedFile(source, MAX_STATUS, uid))
  const temp = `${BASE}/.maintenance-${randomUUID()}.tmp`
  try {
    writeFileSync(temp, raw, { flag: 'wx', mode: 0o644 })
    renameSync(temp, `${BASE}/${STATE_NAMES[kind]}`)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* 原始失败由稳定错误码返回；随机临时文件不复用。 */ }
    throw error
  }
  unlinkSync(source)
}

function removeArchive(kind, name) {
  const pattern = kind === 'world' ? WORLD : kind === 'app' ? ARCHIVE : null
  if (!pattern?.test(name)) throw new Error('invalid_archive')
  const directory = `${BASE}/${kind === 'world' ? 'world-backups' : 'backups'}`
  // 固定目录不能被换成链接，逐个 unlink 仅移除条目本身，不递归或跟随链接。
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('invalid_archive_directory')
  for (const suffix of ['', '.sha256', ...(kind === 'app' && name.endsWith('.age') ? ['.meta.json'] : [])]) {
    try { unlinkSync(`${directory}/${name}${suffix}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export function main(args) {
  if (process.getuid?.() !== 0) throw new Error('root_required')
  const [verb, ...rest] = args
  if (verb === 'write-status' && rest.length === 2) { writeState(...rest); return }
  if (verb === 'remove-archive' && rest.length === 2) { removeArchive(...rest); return }
  if (verb === 'env-keys' && !rest.length) {
    console.log(Object.keys(parseEnv(boundedFile('/etc/antifieldcloud/env').toString('utf8'))).sort().join('\n'))
    return
  }
  if (verb === 'env-value' && rest.length === 1 && PUBLIC_KEYS.has(rest[0])) {
    console.log(parseEnv(boundedFile('/etc/antifieldcloud/env').toString('utf8'))[rest[0]] ?? '')
    return
  }
  if (verb === 'hash' && rest.length === 1 && HASH_PATHS.has(rest[0])) {
    console.log(createHash('sha256').update(boundedFile(rest[0], 1024 * 1024)).digest('hex'))
    return
  }
  if (verb === 'encryption-info' && !rest.length) {
    const file = '/etc/antifieldcloud/backup-age.pub'
    trusted(file)
    const stat = lstatSync(file)
    const recipient = boundedFile(file, 256).toString('utf8').trim()
    if (!/^age1[0-9a-z]{16,}$/.test(recipient)) throw new Error('invalid_recipient')
    const oldTemps = readdirSync(`${BASE}/backups`).filter(name => name.endsWith('.plain.tmp') && Date.now() - lstatSync(`${BASE}/backups/${name}`).mtimeMs > 86400000).length
    console.log(JSON.stringify({ mode: (stat.mode & 0o777).toString(8), owner: stat.uid, recipient, oldTemps }))
    return
  }
  const [command, commandArgs] = maintenanceCommand(args)
  if (verb === 'secrets') trusted('/usr/local/libexec/antifield-backup-secrets.sh')
  execFileSync(command, commandArgs, { stdio: 'inherit', env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8' } })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch { console.error('{"ok":false,"error":"maintenance_failed"}'); process.exitCode = 1 }
}
