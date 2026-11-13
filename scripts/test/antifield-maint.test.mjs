/** 提权入口的参数矩阵与文件读取夹具，不运行 root 操作或真实系统命令。 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { URL } from 'node:url'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boundedFile, maintenanceCommand, validateState } from '../antifield-maint.mjs'

test('维护参数只映射固定可执行文件与参数，不提供 shell、配置或部署能力', () => {
  assert.equal(maintenanceCommand(['backup', '--prepare', '--full'])[0], '/usr/sbin/runuser')
  assert.deepEqual(maintenanceCommand(['secrets', '--include-host-config'])[1].slice(-2), ['/usr/local/libexec/antifield-backup-secrets.sh', '--include-host-config'])
  assert.deepEqual(maintenanceCommand(['fail2ban', 'bantime']), ['/usr/bin/fail2ban-client', ['get', 'sshd', 'bantime']])
  assert.deepEqual(maintenanceCommand(['nft'])[1], ['list', 'ruleset'])
  const name = 'snapshot-20261113T000000123Z-full.tar.gz.age'
  assert.equal(maintenanceCommand(['backup', '--ack', name, '--sha256', 'a'.repeat(64)])[0], '/usr/sbin/runuser')
  for (const args of [['bash'], ['read-status', '/var/lib/antifieldcloud/backup-pull.json'], ['backup', '--prepare', '--full', '--env', '/tmp/env'], ['backup', '--ack', '../../etc/passwd', '--sha256', 'a'.repeat(64)], ['secrets', '--output', '/root/x'], ['nft', 'flush', 'ruleset'], ['fail2ban', 'set'], ['deploy'], ['backup', '--ack', name, '--sha256', 'x']]) {
    assert.throws(() => maintenanceCommand(args), /command_denied/)
  }
})

test('维护状态只接受固定种类和限长对象，普通文件使用同句柄有界读取', t => {
  const dir = mkdtempSync(join(tmpdir(), 'antifield-maint-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'state')
  writeFileSync(file, '{}')
  assert.equal(boundedFile(file).toString(), '{}')
  writeFileSync(file, '中'.repeat(22000))
  assert.throws(() => boundedFile(file), /invalid_file/)
  mkdirSync(join(dir, 'directory'))
  assert.throws(() => boundedFile(join(dir, 'directory')), /invalid_file/)
  if (process.platform !== 'win32') {
    symlinkSync(file, join(dir, 'link'))
    assert.throws(() => boundedFile(join(dir, 'link')))
  }
  assert.equal(validateState('offsite', Buffer.from('{"ok":true}')).toString(), '{"ok":true}\n')
  for (const kind of ['__proto__', 'constructor', '/etc/sudoers']) assert.throws(() => validateState(kind, Buffer.from('{}')))
  for (const raw of ['[]', 'null', 'false', '{', ' '.repeat(65537)]) assert.throws(() => validateState('pull', Buffer.from(raw)))
})

test('Windows autocrlf 导出的维护入口与 sudoers 仍保持 LF', t => {
  const dir = mkdtempSync(join(tmpdir(), 'antifield-maint-archive-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet', dir])
  writeFileSync(join(dir, '.gitattributes'), readFileSync(new URL('../../.gitattributes', import.meta.url)))
  mkdirSync(join(dir, 'deploy', 'host'), { recursive: true })
  const paths = ['deploy/host/antifield-maint', 'deploy/host/020-antifield-maint.sudoers']
  for (const file of paths) writeFileSync(join(dir, file), '# fixture\nsecond line\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  const tree = execFileSync('git', ['-C', dir, 'write-tree'], { encoding: 'utf8' }).trim()
  const archive = join(dir, 'candidate.tar')
  execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=true', 'archive', '--format=tar', `--output=${archive}`, tree])
  for (const file of paths) {
    assert.equal(execFileSync('tar', ['-xOf', archive, file]).includes(13), false, file)
  }
})
