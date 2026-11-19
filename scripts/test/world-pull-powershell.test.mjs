/** 只载入周期判定函数，用夹具验证 Windows 拉取与 Pi 生成的时序。 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, URL } from 'node:url'

test('世界拉取跳过上一周期，等待本周就绪并区分本周明确失败', { skip: process.platform !== 'win32' }, () => {
  const source = fileURLToPath(new URL('../world-pull.ps1', import.meta.url)).replaceAll("'", "''")
  const command = `
    $ErrorActionPreference = 'Stop'
    $errors = $null
    $code = [IO.File]::ReadAllText('${source}', [Text.Encoding]::UTF8)
    $tree = [System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$errors)
    if ($errors) { throw ($errors.Message -join '; ') }
    $functions = $tree.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
    foreach ($definition in $functions) {
      if ($definition.Name -in @('Get-WorldCycleStart','Wait-WorldCycle')) { . ([scriptblock]::Create($definition.Extent.Text)) }
    }
    $cutoff = Get-WorldCycleStart ([datetimeoffset]'2026-11-15T03:59:59Z')
    if ($cutoff.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -ne '2026-11-08T04:00:00') { throw 'Shanghai before cutoff' }
    $cutoff = Get-WorldCycleStart ([datetimeoffset]'2026-11-15T04:00:00Z')
    if ($cutoff.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -ne '2026-11-15T04:00:00') { throw 'Shanghai exact cutoff' }
    $script:cutoff = Get-WorldCycleStart ([datetimeoffset]::UtcNow)
    $script:attempt = 0
    $script:failed = $false
    function Start-Sleep { param([int]$Seconds) if ($Seconds -ne 60) { throw 'interval' } }
    function Get-RemoteSnapshot {
      $script:attempt++
      $stamp = if ($script:attempt -eq 1) { $script:cutoff.AddDays(-7) } else { $script:cutoff }
      @{ Status = @{ startedAt = $stamp.UtcDateTime; ok = (-not $script:failed); archiveName = 'world-20261115T040000Z.tar.gz'; sha256 = ('a' * 64) } }
    }
    function Throw-PullError { param($Code, $Message) throw $Code }
    $ready = Wait-WorldCycle
    if ($script:attempt -ne 2 -or $ready.Status.startedAt -ne $script:cutoff.UtcDateTime) { throw 'accepted old archive' }
    $script:failed = $true
    try { Wait-WorldCycle | Out-Null; throw 'reported success' }
    catch { if ($_.Exception.Message -ne 'world_backup_failed') { throw } }
  `
  const directory = mkdtempSync(join(tmpdir(), 'world-pull-cycle-'))
  try {
    const fixture = join(directory, 'cycle.ps1')
    writeFileSync(fixture, command)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture],
      { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message || `PowerShell ${result.signal ?? 'failed'}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
