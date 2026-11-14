#!/usr/bin/env bash
# 安装已锁定的候选运行时与系统隔离配置。管理员在验收前独立提供凭据并启用单元。
set -euo pipefail
umask 027
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
base=/opt/antifield-dsh
[[ $(id -u) == 0 && $(uname -m) == aarch64 && $# == 0 ]] || {
  echo "请在 ARM64 Pi 上以 root 执行，不接受路径参数" >&2
  exit 2
}
release="$base/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0755 "$base/releases"
mkdir -m 0755 -- "$release"
trap 'echo "DSH 候选安装失败，检查受限 release 与安装日志" >&2' ERR
assets=(
  package.json package-lock.json patch-qq.mjs qq-policy.mjs qq-memory.mjs qq-memory-cli.mjs
  qq-agent.mjs qq-watchdog.mjs web-broker.mjs runtime-status.mjs web-policy.yml web-account.yml web-account.conf web-scope.yml web-workspace.mjs
  mcbot-agent.mjs mcbot-minimal.yml dsh-mcbot.mjs
)
for asset in "${assets[@]}"; do
  install -m 0644 -- "$source_dir/$asset" "$release/$asset"
done
(
  cd -- "$release"
  umask 022
  PATH="/usr/local/bin:$PATH" npm ci --ignore-scripts --no-audit --no-fund
  /usr/local/bin/node ./patch-qq.mjs
  test "$(/usr/local/bin/node ./node_modules/@deepseek-ai/dsh/lib/bin.js --version)" = 0.2.2-rc.3
)
# 专用 socket 组和无登录系统账号。
getent passwd antifieldcloud >/dev/null
getent passwd mcbot >/dev/null
for group in dsh-web-link dsh-mcbot-link; do
  getent group "$group" >/dev/null || groupadd --system "$group"
done
for entry in web:web qq:qq mcbot-agent:agent; do
  kind=${entry%:*}
  user="antifield-dsh-${entry#*:}"
  home="/var/lib/antifield-dsh-$kind"
  getent group "$user" >/dev/null || groupadd --system "$user"
  getent passwd "$user" >/dev/null || useradd --system --gid "$user" --home-dir "$home" --shell /usr/sbin/nologin "$user"
  install -d -o "$user" -g "$user" -m 0700 "$home" "$home/profile" "$home/workspace"
  install -m 0644 -- "$source_dir/antifield-dsh-$kind.service" /etc/systemd/system/
done
install -d -m 0700 /etc/antifieldcloud/dsh
install -m 0644 -- "$source_dir/antifield-dsh-tmpfiles.conf" /etc/tmpfiles.d/
systemd-tmpfiles --create /etc/tmpfiles.d/antifield-dsh-tmpfiles.conf
systemctl daemon-reload
if [[ ! -e "$base/current" && ! -L "$base/current" ]]; then
  ln -s -- "$release" "$base/current"
fi
printf 'DSH 候选已安装 %s\n' "$release"
