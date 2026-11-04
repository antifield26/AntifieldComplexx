import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 周度世界拉取安装：DryRun 必须指向 LocalAppData 副本。
 * 缺少 world-pull.ps1 时在注册任务前失败。不注册真实计划任务。
 */

const INSTALLER = join(import.meta.dirname, '..', 'install-backup-task.ps1')

function runInstaller(scriptPath, extraArgs = []) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs],
    { encoding: 'utf8' },
  )
}

test('DryRun 把世界拉取任务指向 LocalAppData 副本', () => {
  const backupRoot = 'C:\\Users\\Public\\AntifieldCloudBackups'
  const result = runInstaller(INSTALLER, [
    '-DryRun',
    '-PiHost',
    '192.0.2.10',
    '-PiUser',
    'antifield',
    '-BackupRoot',
    backupRoot,
  ])
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.status, 0, output)
  assert.match(output, /AntifieldCloud-World-Pull/)
  assert.match(output, /AntifieldCloud\\world-pull\.ps1/)
  assert.match(output, /192\.0\.2\.10/)
  assert.match(output, /AntifieldCloudBackups/)
  assert.doesNotMatch(output, /projects\\AntifieldComplexx\\scripts\\world-pull\.ps1/)
  assert.doesNotMatch(output, /已注册计划任务/)
})

test('缺少 world-pull.ps1 时安装脚本在修改前失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'antifield-install-'))
  const scripts = join(root, 'scripts')
  mkdirSync(scripts)
  try {
    cpSync(INSTALLER, join(scripts, 'install-backup-task.ps1'))
    cpSync(join(import.meta.dirname, '..', 'backup-pull.ps1'), join(scripts, 'backup-pull.ps1'))
    const result = runInstaller(join(scripts, 'install-backup-task.ps1'), ['-DryRun', '-PiHost', '192.0.2.10'])
    const output = `${result.stdout}\n${result.stderr}`
    assert.notEqual(result.status, 0)
    assert.match(output, /找不到/)
    assert.match(output, /world-pull\.ps1/)
    assert.doesNotMatch(output, /已注册计划任务/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
