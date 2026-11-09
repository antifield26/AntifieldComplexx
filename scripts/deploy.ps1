param(
  [string]$PiHost = "192.0.2.10",
  [string]$PiUser = "antifield",
  [switch]$SkipChecks,
  [switch]$SkipBuild,
  [switch]$OfflineInstall,
  [switch]$AllowDirty,
  [switch]$AllowSmokeFailure,
  [switch]$DshRuntime,
  [int]$CommandTimeoutSec = 120,
  [int]$InstallTimeoutSec = 1800
)

# 构建前端 → 打包 → 上传到 Pi 的 releases/<UTC> → 安装生产依赖 → 迁移前 DB 快照 → 切换 current
# → 重启并校验版本、schema 与运行时；同 schema 支持自动回滚。
# 前置：Pi 已完成服务账号/目录/systemd 初始化（见 docs/app/DEPLOY.md），并已运行 bootstrap-env.sh。
# 约束：
# - 所有 ssh/scp 都有硬超时（Start-Process + taskkill /T /F），不会无限挂起；
# - 上传后校验远端 tar SHA-256；安装前校验远端 package.json 版本与本地一致；
# - APP_VERSION 注入 /etc/antifieldcloud/env，健康检查断言 /healthz.version（OP-04）；
# - 同 schema 回滚只还原 release 指针和配置，跨 schema 由人工维护。
# Windows PowerShell 5.1 会把原生命令的 stderr 当作错误记录；这里显式检查退出码。
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$target = "$PiUser@$PiHost"
$tag = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
$tarPath = Join-Path $env:TEMP "antifieldcloud-$tag.tar.gz"
$stageDir = Join-Path $env:TEMP "antifieldcloud-stage-$tag"
$releaseDir = "/opt/antifieldcloud/releases/$tag"
$currentLink = "/opt/antifieldcloud/current"
$envFile = "/etc/antifieldcloud/env"
$previousTarget = $null
$snapshotJson = $null
$deployState = "/var/lib/antifieldcloud/deploy-state/$tag"
$savedEnv = "$deployState/env"
$previousVersion = $null
$previousSchema = 0
$usesDsh = $false
$switched = $false
$expectedVersion = $null
$expectedSchemaVersion = $null
$expectedOpenCodeVersion = $null
$expectedDshVersion = $null
$expectedDshQqVersion = $null
$headSha = ""
$tarSha256 = $null
$tarSize = 0

# 读取 deploy/tool-versions.json：PC 侧期望 schema / OpenCode 版本的唯一来源（由 check-version 与 db.ts 交叉校验）。
function Read-ToolVersions {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "缺少 $Path（PC 侧部署需要它提供期望 schema/OpenCode 版本；见 scripts/check-version.mjs）"
  }
  try {
    return ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
  } catch {
    throw "无法解析 $Path：$($_.Exception.Message)"
  }
}

function ConvertTo-ArgumentString {
  param([string[]]$Arguments)
  $quoted = foreach ($argument in $Arguments) {
    if ($argument -match '[\s"]') { '"' + ($argument -replace '"', '\"') + '"' } else { $argument }
  }
  return ($quoted -join " ")
}

# 执行本地进程并硬超时：超时用 taskkill /T /F 杀整棵进程树。
function Invoke-NativeWithTimeout {
  param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds, [string]$Label)
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  $commandLine = ConvertTo-ArgumentString -Arguments $Arguments
  try {
    $process = Start-Process -FilePath $FilePath -ArgumentList $commandLine -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    # PS 5.1：Start-Process -PassThru 必须缓存 Handle 后 WaitForExit，ExitCode 才有值。
    $null = $process.Handle
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { & taskkill.exe /T /F /PID $process.Id 2>&1 | Out-Null } catch { try { $process.Kill() } catch { } }
      throw "命令超时（${TimeoutSeconds}s，已杀进程树）：$Label"
    }
    $stdoutRaw = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue } else { $null }
    $stderrRaw = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue } else { $null }
    $stdoutText = if ($null -eq $stdoutRaw) { "" } else { [string]$stdoutRaw }
    $stderrText = if ($null -eq $stderrRaw) { "" } else { [string]$stderrRaw }
    $exitCode = if ($null -eq $process.ExitCode) { -1 } else { [int]$process.ExitCode }
    return [pscustomobject]@{
      Label    = $Label
      ExitCode = $exitCode
      StdOut   = $stdoutText.Trim()
      StdErr   = $stderrText.Trim()
      Output   = ((@($stdoutText, $stderrText) -join "`n").Trim())
    }
  } finally {
    Remove-Item -Force $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
  }
}

function Invoke-Remote {
  param([string]$Command, [int]$Attempts = 3, [int]$TimeoutSeconds = $CommandTimeoutSec)
  $lastResult = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $lastResult = Invoke-NativeWithTimeout -FilePath "ssh.exe" -Arguments @(
      "-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=2", $target, $Command
    ) -TimeoutSeconds $TimeoutSeconds -Label "ssh: $Command"
    if ($lastResult.ExitCode -eq 0) { return $lastResult.Output }
    if ($attempt -eq $Attempts) {
      throw "远程命令失败（exit=$($lastResult.ExitCode)）：$Command`n$($lastResult.Output)"
    }
    Write-Warning "SSH 第 $attempt 次失败，5 秒后重试…"
    Start-Sleep -Seconds 5
  }
}

# 复杂远端脚本经 base64 传输，避免 Windows→PowerShell→ssh→bash 多层引号问题。
function Invoke-RemoteScript {
  param([string]$Script, [int]$Attempts = 3, [int]$TimeoutSeconds = $CommandTimeoutSec)
  # 远端 bash 只接受 LF：PowerShell 字符串可能含 CRLF，先归一化。
  $normalized = $Script -replace "`r`n", "`n"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalized))
  return Invoke-Remote "echo $b64 | base64 -d | sudo bash" -Attempts $Attempts -TimeoutSeconds $TimeoutSeconds
}

# 忽略非 JSON 日志行；解析失败时剥离非 ASCII 再试一次（OP-06）。
function ConvertFrom-JsonLine {
  param($Lines)
  $jsonLines = @($Lines | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^\s*\{.*\}\s*$' })
  if ($jsonLines.Count -eq 0) { return $null }
  $candidate = $jsonLines[$jsonLines.Count - 1]
  try { return ($candidate | ConvertFrom-Json) } catch { }
  $asciiOnly = -join ($candidate.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -lt 127 })
  try { return ($asciiOnly | ConvertFrom-Json) } catch { return $null }
}

function Copy-ToPi {
  param([string]$Local, [string]$Remote, [int]$Attempts = 3)
  $sizeMB = [Math]::Max(1, [Math]::Ceiling((Get-Item -LiteralPath $Local).Length / [double]1MB))
  $timeout = [int][Math]::Min(3600, [Math]::Max(300, $sizeMB * 20))
  $lastResult = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $lastResult = Invoke-NativeWithTimeout -FilePath "scp.exe" -Arguments @(
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=2", $Local, "${target}:$Remote"
    ) -TimeoutSeconds $timeout -Label "scp: $Local -> $Remote"
    if ($lastResult.ExitCode -eq 0) { return }
    if ($attempt -eq $Attempts) { throw "scp 失败（exit=$($lastResult.ExitCode)）：$Local -> $Remote`n$($lastResult.Output)" }
    Write-Warning "scp 第 $attempt 次失败，5 秒后重试…"
    Start-Sleep -Seconds 5
  }
}

# 健康检查同时断言版本、DB 就绪和实际 Agent 运行时。
function Test-Health {
  param([string]$Version = $expectedVersion, [int]$Schema = $expectedSchemaVersion, [int]$Attempts = 15)
  $runtimeCheck = if ($usesDsh) {
    "systemctl is-active --quiet antifield-dsh-web && systemctl is-active --quiet antifield-dsh-qq && systemctl is-active --quiet antifield-dsh-mcbot-agent && /usr/local/bin/node '$releaseDir/scripts/deploy-state.mjs' dsh-ready '$expectedDshVersion' '$expectedDshQqVersion'"
  } else {
    "systemctl is-active --quiet opencode"
  }
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $raw = Invoke-Remote "$runtimeCheck && curl -fsS --max-time 3 http://127.0.0.1:3000/healthz" -Attempts 1 -TimeoutSeconds 20
      $health = ConvertFrom-JsonLine @($raw)
      if ($health.ok -eq $true -and $health.db -eq "ok" -and $health.version -eq $Version -and $health.schemaVersion -eq $Schema) {
        Write-Host "healthz ok：version=$Version schema=$Schema"
        return $true
      }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Invoke-CleanupOldReleases {
  # 保留最新 3 个 release；current 与本次 previous 永不删除。
  $prev = if ($previousTarget) { $previousTarget } else { "" }
  $script = @"
cur=`$(readlink -f $currentLink)
prev="$prev"
ls -1dt /opt/antifieldcloud/releases/* | awk -v c="`$cur" -v p="`$prev" 'NR>3 && `$0 != c && `$0 != p' | xargs -r sudo rm -rf
"@
  Invoke-RemoteScript $script | Out-Null
}

# 同 schema 只还原配置和 release 指针，数据库与 WAL 保持原位。
function Invoke-Rollback {
  if (-not $previousTarget -or -not $previousVersion -or -not $snapshotJson) {
    Write-Warning "缺少已验证的回滚基线，请人工维护。"
    return $false
  }
  $rollbackScript = @"
set -euo pipefail
test -f '$savedEnv'
test -d '$previousTarget'
sudo -u antifieldcloud /usr/local/bin/node '$releaseDir/scripts/deploy-state.mjs' snapshot '$($snapshotJson.snapshot)' '$($snapshotJson.sha256)' >/dev/null
sudo /usr/local/bin/node '$releaseDir/scripts/deploy-state.mjs' same-schema '$savedEnv' '$previousSchema'
sudo systemctl stop antifieldcloud
sudo cp --preserve=mode,ownership '$savedEnv' '$envFile.rollback-$tag'
sudo mv -T '$envFile.rollback-$tag' '$envFile'
sudo ln -sfn '$previousTarget' '$currentLink'
sudo systemctl start antifieldcloud
"@
  try {
    Invoke-RemoteScript $rollbackScript -Attempts 1 -TimeoutSeconds 300 | Out-Null
  } catch {
    Write-Warning "自动回滚失败或涉及跨 schema。请保全现行库和 WAL，再验证恢复源后人工维护。"
    return $false
  }
  return (Test-Health -Version $previousVersion -Schema $previousSchema)
}

Push-Location $root
try {
  if (-not (Test-Path (Join-Path $root "LICENSE"))) { throw "LICENSE 不存在（发布包必须包含 MIT 许可）" }

  # 发布必须绑定干净的 commit（OPS4-04）：避免把未提交的 v0.5.0 半成品当成旧版本发布。
  if (Test-Path (Join-Path $root ".git")) {
    $dirty = @(& git -C $root status --porcelain 2>$null)
    if ($dirty.Count -gt 0 -and -not $AllowDirty) {
      throw "工作树不干净（$($dirty.Count) 个文件）；请先提交或使用 -AllowDirty 明确允许脏发布"
    }
    $headSha = (& git -C $root rev-parse --short HEAD 2>$null | Out-String).Trim()
    Write-Host "发布 commit：$headSha$(if ($dirty.Count -gt 0) { '（含未提交改动）' })"
  }

  # 期望版本来自 workbench 包（发布包内同一份文件）；根编排包版本由 check-version 强制一致。
  $packagePath = Join-Path $root "apps/workbench/package.json"
  $packageText = [System.IO.File]::ReadAllText($packagePath, [System.Text.Encoding]::UTF8)
  $packageJson = $packageText | ConvertFrom-Json
  $expectedVersion = [string]$packageJson.version
  if ($expectedVersion -notmatch '^\d+\.\d+\.\d+$') { throw "apps/workbench/package.json version 非法：$expectedVersion" }
  Write-Host "目标版本：$expectedVersion"

  # 期望 schema / OpenCode 版本来自受 CI 交叉校验的工具版本清单（避免 deploy.ps1 硬编码 schema）。
  $toolVersions = Read-ToolVersions (Join-Path $root "deploy/tool-versions.json")
  if (-not ([int]::TryParse([string]$toolVersions.schemaVersion, [ref]$expectedSchemaVersion))) {
    throw "deploy/tool-versions.json schemaVersion 非法：$($toolVersions.schemaVersion)"
  }
  $expectedOpenCodeVersion = [string]$toolVersions.opencodeVersion
  if ($toolVersions.dshVersion) {
    $expectedDshVersion = [string]$toolVersions.dshVersion
    $expectedDshQqVersion = [string]$toolVersions.dshQqPluginVersion
    if ($expectedDshVersion -notmatch '^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$' -or $expectedDshQqVersion -notmatch '^\d+\.\d+\.\d+$') {
      throw "DSH 候选版本或 QQ 插件版本无效"
    }
  }
  if ($expectedOpenCodeVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "deploy/tool-versions.json opencodeVersion 非法：$expectedOpenCodeVersion"
  }
  Write-Host "期望 schema=$expectedSchemaVersion OpenCode=$expectedOpenCodeVersion"

  # 远程环境预检（OP-24）：Node/NPM 可用、版本足够；部署前不修改任何服务状态。
  Write-Host "== 远程环境预检 =="
  $nodeVersion = (Invoke-Remote "sudo /usr/local/bin/node --version" -Attempts 3 | Out-String).Trim()
  $nodeMatch = [regex]::Match($nodeVersion, '^v(\d+)\.')
  if (-not $nodeMatch.Success) { throw "Pi 上 /usr/local/bin/node 不可用：$nodeVersion" }
  if ([int]$nodeMatch.Groups[1].Value -lt 26) { throw "Pi 上 Node 版本过低（$nodeVersion），要求 >= 26" }
  $npmVersion = (Invoke-Remote "sudo /usr/local/bin/npm --version" -Attempts 3 | Out-String).Trim()
  if ($npmVersion -notmatch '^\d+\.\d+\.\d+') { throw "Pi 上 /usr/local/bin/npm 不可用：$npmVersion（检查 nvm 链接，不要删除当前版本）" }
  Write-Host "node=$nodeVersion npm=$npmVersion"

  if (-not $SkipChecks) {
    Write-Host "== npm run check =="
    & npm run check
    if ($LASTEXITCODE -ne 0) { throw "npm run check 失败" }
    Write-Host "== 生产依赖边界检查 =="
    & node scripts/check-prod-deps.mjs --app-dir apps/workbench
    if ($LASTEXITCODE -ne 0) { throw "生产依赖边界检查失败（apps/workbench/server/src 引用了 devDependencies/未声明依赖）" }
    Write-Host "== 版本/schema/OpenCode 一致性检查 =="
    & node scripts/check-version.mjs --quiet
    if ($LASTEXITCODE -ne 0) { throw "版本一致性检查失败（package/README/文档当前事实/schema/OpenCode 不一致；见上方输出）" }
  }
  if (-not $SkipBuild) {
    Write-Host "== npm run build =="
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
  }
  $webIndex = Join-Path $root "apps/workbench/web/dist/index.html"
  if (-not (Test-Path $webIndex)) { throw "apps/workbench/web/dist/index.html 不存在" }

  Write-Host "== 打包 $tag（workspace 感知 staging）=="
  if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
  if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
  & node (Join-Path $PSScriptRoot "release-files.mjs") stage workbench $stageDir $expectedVersion $root
  if ($LASTEXITCODE -ne 0) { throw "发布文件清单校验失败" }
  & tar.exe -czf $tarPath -C $stageDir .
  if ($LASTEXITCODE -ne 0) { throw "打包失败" }
  $tarSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $tarPath).Hash.ToLower()
  $tarSize = (Get-Item -LiteralPath $tarPath).Length
  Write-Host "本地包：$tarPath（$tarSize bytes，sha256=$tarSha256）"

  # 空间预检（OP-25）：至少 2 GiB + 包体大小。
  $freeText = (Invoke-Remote "df -Pk /opt/antifieldcloud 2>/dev/null | awk 'NR==2{print `$4}'" -Attempts 3 | Out-String).Trim()
  $freeKb = [long]0
  if (-not [long]::TryParse($freeText, [ref]$freeKb)) { throw "无法读取 Pi 根分区可用空间：$freeText" }
  $requiredBytes = [long](2GB) + $tarSize
  if ($freeKb -le 0) { throw "无法读取 Pi 根分区可用空间" }
  if (($freeKb * 1024) -lt $requiredBytes) {
    throw ("Pi 磁盘空间不足：可用 {0:N1} MiB，需要 {1:N1} MiB（2 GiB 预留 + 包体）" -f ($freeKb / 1024), ($requiredBytes / 1MB))
  }
  Write-Host ("Pi 可用空间：{0:N1} MiB（需要 >= {1:N1} MiB）" -f ($freeKb / 1024), ($requiredBytes / 1MB))

  Write-Host "== 上传 =="
  Invoke-Remote "sudo install -d -o root -g root -m 0755 /opt/antifieldcloud/releases" | Out-Null
  Copy-ToPi $tarPath "/tmp/antifieldcloud-$tag.tar.gz"
  $remoteSha = (Invoke-Remote "sha256sum /tmp/antifieldcloud-$tag.tar.gz | cut -d' ' -f1" -Attempts 3 | Out-String).Trim().ToLower()
  if ($remoteSha -ne $tarSha256) {
    try { Invoke-Remote "sudo rm -f /tmp/antifieldcloud-$tag.tar.gz" | Out-Null } catch { }
    throw "上传后 SHA-256 不一致：本地 $tarSha256 / 远端 $remoteSha"
  }
  Write-Host "上传校验通过（sha256 一致）"
  $previousTarget = (Invoke-Remote "readlink -f $currentLink 2>/dev/null || true" | Out-String).Trim()
  if ($previousTarget -eq "") { $previousTarget = $null }
  if ($previousTarget -and $previousTarget -notmatch '^/opt/antifieldcloud/releases/[0-9TZ]+$') { throw "上一 release 指针不在部署目录" }
  Write-Host "上一 release：$(if ($previousTarget) { $previousTarget } else { '（无，首次部署）' })"
  if ($previousTarget) {
    $enabled = (Invoke-Remote "systemctl is-enabled antifieldcloud 2>/dev/null || true" -Attempts 1 | Out-String).Trim()
    if ($enabled -ne "enabled") { throw "antifieldcloud.service 未启用（is-enabled=$enabled），请先修复部署状态" }
  }

  Write-Host "== 解包与安装生产依赖 =="
  Invoke-Remote "sudo mkdir -p $releaseDir && sudo tar -xzf /tmp/antifieldcloud-$tag.tar.gz -C $releaseDir && sudo chown -R root:root $releaseDir && sudo chmod -R u+rwX,go-w $releaseDir && sudo rm -f /tmp/antifieldcloud-$tag.tar.gz" -TimeoutSeconds 900 | Out-Null
  Invoke-Remote "sudo /usr/local/bin/node '$releaseDir/scripts/release-files.mjs' verify workbench '$releaseDir' '$expectedVersion'" -TimeoutSeconds 120 | Out-Null
  $runtime = (Invoke-Remote "if sudo test -f '$envFile'; then sudo /usr/local/bin/node '$releaseDir/scripts/deploy-state.mjs' runtime '$envFile'; else echo first; fi" | Out-String).Trim()
  if ($runtime -notin @("first", "dsh", "opencode")) { throw "无法确定生产 Agent 运行时" }
  if ($DshRuntime -and $runtime -eq "opencode") { throw "-DshRuntime 与生产环境配置冲突" }
  $usesDsh = ($runtime -eq "dsh")
  $envReady = ($runtime -ne "first")
  $cacheFlag = if ($OfflineInstall) { " --offline" } else { "" }
  $install = "cd $releaseDir && sudo /usr/local/bin/npm ci$cacheFlag --omit=dev --ignore-scripts --no-audit --no-fund && sudo chown -R root:root $releaseDir && sudo chmod -R u+rwX,go-w $releaseDir"
  $installResult = Invoke-NativeWithTimeout -FilePath "ssh.exe" -Arguments @(
    "-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2", $target, $install
  ) -TimeoutSeconds $InstallTimeoutSec -Label "npm ci"
  $installResult.Output | Out-Host
  if ($installResult.ExitCode -ne 0) { throw "npm ci 失败（exit=$($installResult.ExitCode)）" }

  if (-not $envReady) {
    # 首次部署：env 尚未生成（bootstrap-env.sh），此时无法做 DB 快照/健康检查。
    Write-Warning "未找到 $envFile：按首次部署处理，跳过迁移前快照、重启与健康检查。"
    Invoke-Remote "sudo ln -sfn $releaseDir $currentLink" | Out-Null
    $switched = $true
    Invoke-CleanupOldReleases
    Write-Host "首次代码部署完成：$releaseDir"
    Write-Host "下一步：cd $currentLink && sudo bash scripts/bootstrap-env.sh --dry-run（确认域名后去掉 --dry-run）"
    Write-Host "然后：sudo systemctl enable --now antifieldcloud"
    return
  }

  Write-Host "== 迁移前 DB 快照 =="
  $snapshotRaw = Invoke-Remote "cd $releaseDir && sudo -u antifieldcloud -H /usr/local/bin/node scripts/backup.mjs --snapshot-db" -TimeoutSeconds 600
  $snapshotJson = ConvertFrom-JsonLine $snapshotRaw
  if (-not $snapshotJson -or -not $snapshotJson.ok) {
    throw "迁移前 DB 快照失败：$snapshotRaw`n已停止部署，current 未切换。"
  }
  $snapshotPath = [string]$snapshotJson.snapshot
  $snapshotSha = [string]$snapshotJson.sha256
  if ($snapshotPath -notmatch '^/[A-Za-z0-9_./-]+/db-predeploy-[0-9TZ-]+\.sqlite$' -or $snapshotSha -notmatch '^[0-9a-f]{64}$') {
    throw "迁移前快照元数据非法，current 保持原样"
  }
  $snapshotSchemaText = (Invoke-Remote "sudo -u antifieldcloud /usr/local/bin/node '$releaseDir/scripts/deploy-state.mjs' snapshot '$snapshotPath' '$snapshotSha'" | Out-String).Trim()
  if (-not [int]::TryParse($snapshotSchemaText, [ref]$previousSchema) -or $previousSchema -lt 1 -or $previousSchema -gt $expectedSchemaVersion) {
    throw "迁移前快照 schema 不兼容，current 保持原样"
  }
  Write-Host "已验证 DB 快照：$snapshotPath（schema=$previousSchema，sha256=$snapshotSha）"
  if ($previousTarget) {
    $oldHealth = ConvertFrom-JsonLine @(Invoke-Remote "curl -fsS --max-time 5 http://127.0.0.1:3000/healthz")
    $previousVersion = [string]$oldHealth.version
    if ($previousVersion -notmatch '^\d+\.\d+\.\d+$' -or $oldHealth.schemaVersion -ne $previousSchema -or $oldHealth.db -ne "ok") {
      throw "当前 release 的健康状态和迁移前快照不一致"
    }
  }
  Invoke-Remote "sudo install -d -m 0700 '$deployState' && sudo cp --preserve=mode,ownership '$envFile' '$savedEnv' && printf '%s\n' '$previousTarget' | sudo tee '$deployState/previous-release' >/dev/null" | Out-Null

  Write-Host "== 切换 current 并重启 =="
  $switchScript = @"
set -euo pipefail
sudo cp --preserve=mode,ownership '$savedEnv' '$envFile.next-$tag'
sudo sed -i -E '/^[[:space:]]*(APP_VERSION|WEB_DIST_DIR)[[:space:]]*=/d' '$envFile.next-$tag'
printf '\nAPP_VERSION=%s\nWEB_DIST_DIR=%s\n' '$expectedVersion' '$currentLink/apps/workbench/web/dist' | sudo tee -a '$envFile.next-$tag' >/dev/null
sudo mv -T '$envFile.next-$tag' '$envFile'
sudo ln -sfn '$releaseDir' '$currentLink'
sudo systemctl restart antifieldcloud
"@
  $switched = $true
  try {
    Invoke-RemoteScript $switchScript -Attempts 1 | Out-Null
    if (-not (Test-Health)) { throw "新 release 未通过版本、schema 和运行时就绪检查" }
  } catch {
    $failure = $_.Exception.Message
    if (Invoke-Rollback) { throw "部署失败，已恢复上一 release 和配置，保留现行库：$failure" }
    throw "部署失败，需人工维护。迁移前 DB 快照：$snapshotPath。$failure"
  }

  Write-Host "== 清理旧 release（保留 3 个，保护 current/previous）=="
  Invoke-CleanupOldReleases

  # 发布元数据（OPS-17）：记录 commit/包 SHA/版本/schema/时间，便于事后审计与回滚定位。
  $releaseInfo = [ordered]@{
    release                = $tag
    version                = $expectedVersion
    schemaVersion          = $expectedSchemaVersion
    opencodeVersion        = if ($usesDsh) { $null } else { $expectedOpenCodeVersion }
    dshVersion             = $expectedDshVersion
    dshQqPluginVersion     = $expectedDshQqVersion
    commit                 = $headSha
    tarSha256              = $tarSha256
    tarSizeBytes           = $tarSize
    snapshot               = [string]$snapshotJson.snapshot
    snapshotSha256         = [string]$snapshotJson.sha256
    deployedAt             = (Get-Date).ToUniversalTime().ToString("o")
    deployedBy             = [System.Environment]::UserName
  }
  $releaseInfoJson = $releaseInfo | ConvertTo-Json -Compress
  $releaseInfoB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($releaseInfoJson))
  try {
    Invoke-Remote "echo $releaseInfoB64 | base64 -d | sudo tee $releaseDir/release.json >/dev/null && sudo chmod 0644 $releaseDir/release.json" | Out-Null
    $historyLine = "$(Get-Date).ToUniversalTime().ToString('o') deploy version=$expectedVersion schema=$expectedSchemaVersion commit=$headSha tar=$tarSha256"
    $historyB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($historyLine))
    Invoke-Remote "echo $historyB64 | base64 -d | sudo tee -a /var/lib/antifieldcloud/deploy-history.log >/dev/null" | Out-Null
  } catch {
    Write-Warning "发布元数据写入失败（不影响运行）：$($_.Exception.Message)"
  }

  Write-Host "部署完成：$releaseDir（version=$expectedVersion）"
  Write-Host "迁移前 DB 快照：$($snapshotJson.snapshot)"

  # 只读 smoke 子集（OP-13）：公网/本地备份归档检查跳过，Pi 服务与版本必须通过。
  $smokePath = Join-Path $PSScriptRoot "smoke.ps1"
  if (Test-Path $smokePath) {
    Write-Host "== 部署后只读 smoke =="
    $runtimeChecks = if ($usesDsh) {
      @{ ExpectedDshVersion = $expectedDshVersion; ExpectedDshQqVersion = $expectedDshQqVersion }
    } else {
      @{ ExpectedOpenCodeVersion = $expectedOpenCodeVersion }
    }
    & $smokePath -PiHost $PiHost -PiUser $PiUser -SkipPublic -SkipLocalBackup -SkipLocalTaskCheck -ExpectedVersion $expectedVersion -ExpectedSchemaVersion $expectedSchemaVersion @runtimeChecks
    if ($LASTEXITCODE -ne 0) {
      if ($AllowSmokeFailure) {
        Write-Warning "部署后 smoke 失败（已使用 -AllowSmokeFailure，部署保留；请根据上方 FAIL 项排查）"
      } else {
        throw "部署后 smoke 失败；发布门禁未通过（可用 -AllowSmokeFailure 仅告警）"
      }
    }
  }
} catch {
  if (-not $switched) {
    # 切换前失败：清理不完整 release 与远端临时包，current 保持原样。
    try { Invoke-Remote "sudo rm -rf $releaseDir" | Out-Null } catch { }
    try { Invoke-Remote "sudo rm -f /tmp/antifieldcloud-$tag.tar.gz" | Out-Null } catch { }
  }
  throw
} finally {
  Pop-Location
  if (Test-Path $tarPath) { Remove-Item $tarPath -Force -ErrorAction SilentlyContinue }
  if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue }
}
