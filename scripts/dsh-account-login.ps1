param(
  [string]$PiHost = "",
  [string]$PiUser = "antifield",
  [ValidateRange(1024, 65535)][int]$Port = 3180
)

# 使用受限的 Web 服务账号在临时 SSH 隧道完成浏览器授权。
# 原生启动地址仅显示在当前操作者的终端，DSH 在自己的配置目录内保存授权。
$ErrorActionPreference = "Stop"
if (!$PiHost) {
  $repo = Split-Path -Parent $PSScriptRoot
  $privateDeploy = Join-Path $repo ".local/DEPLOYMENT.md"
  if (Test-Path -LiteralPath $privateDeploy) {
    $contents = Get-Content -LiteralPath $privateDeploy -Raw -Encoding UTF8
    $entry = [regex]::Match($contents, 'SSH .?(?<user>[a-z_][a-z0-9_-]*)@(?<host>(?:\d{1,3}\.){3}\d{1,3})')
    if ($entry.Success) {
      $PiHost = $entry.Groups['host'].Value
      $PiUser = $entry.Groups['user'].Value
    }
  }
}
if ($PiHost -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$' -or $PiUser -notmatch '^[a-z_][a-z0-9_-]*$') {
  throw "请通过 -PiHost 和 -PiUser 指定树莓派的 SSH 地址"
}
$forward = "127.0.0.1:${Port}:127.0.0.1:${Port}"
$remote = @"
sudo -n /usr/bin/systemd-run --quiet --unit=antifield-dsh-account-login --pty --wait --collect --uid=antifield-dsh-web --gid=antifield-dsh-web --working-directory=/var/lib/antifield-dsh-web/workspace --property=RuntimeMaxSec=20min --property=UMask=0077 --property=ProtectHome=true --property=ProtectSystem=strict --property=PrivateTmp=true --property=NoNewPrivileges=true --property=ProtectProc=invisible --property=ReadWritePaths=/var/lib/antifield-dsh-web --property='InaccessiblePaths=-/var/lib/antifieldcloud -/var/lib/mcbot -/var/lib/opencode -/etc/antifieldcloud -/etc/mcbot' --setenv=HOME=/var/lib/antifield-dsh-web --setenv=DSH_HOME=/var/lib/antifield-dsh-web/profile /usr/local/bin/node /opt/antifield-dsh/current/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --patch /opt/antifield-dsh/current/web-policy.yml --no-open --host 127.0.0.1 --port $Port --public-url http://127.0.0.1:$Port
"@
Write-Host "打开终端内 DSH 打印的本机地址。在 DSH 设置中登录 DeepSeek，登录完成后按 Ctrl+C 关闭临时入口。"
& ssh.exe -tt -o ExitOnForwardFailure=yes -L $forward "$PiUser@$PiHost" $remote
exit $LASTEXITCODE
