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
bash "$source_dir/install-pnpm.sh"
release="$base/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0755 "$base/releases"
mkdir -m 0755 -- "$release"
trap 'echo "DSH 候选安装失败，检查受限 release 与安装日志" >&2' ERR
bash "$source_dir/assemble.sh" "$release"
# 专用 socket 组和无登录系统账号。
getent passwd antifieldcloud >/dev/null
getent passwd mcbot >/dev/null
for group in dsh-web-link dsh-mcbot-link dsh-qq-link; do
  getent group "$group" >/dev/null || groupadd --system "$group"
done
usermod -aG dsh-qq-link antifieldcloud
for entry in web:web qq:qq mcbot-agent:agent; do
  kind=${entry%:*}
  user="antifield-dsh-${entry#*:}"
  home="/var/lib/antifield-dsh-$kind"
  getent group "$user" >/dev/null || groupadd --system "$user"
  getent passwd "$user" >/dev/null || useradd --system --gid "$user" --home-dir "$home" --shell /usr/sbin/nologin "$user"
  install -d -o "$user" -g "$user" -m 0700 "$home" "$home/profile" "$home/workspace"
done
install -d -m 0700 /etc/antifieldcloud/dsh
/usr/local/bin/node "$release/qq-migrate-binding.mjs"
for kind in web qq mcbot-agent; do
  install -m 0644 -- "$source_dir/antifield-dsh-$kind.service" /etc/systemd/system/
done
install -m 0644 -- "$source_dir/antifield-dsh-tmpfiles.conf" /etc/tmpfiles.d/
systemd-tmpfiles --create /etc/tmpfiles.d/antifield-dsh-tmpfiles.conf
systemctl daemon-reload
if [[ ! -e "$base/current" && ! -L "$base/current" ]]; then
  ln -s -- "$release" "$base/current"
fi
printf 'DSH 候选已安装 %s\n' "$release"
