#!/usr/bin/env bash
# 管理员安装固定维护入口；不自动收权。先验证任务，再单独移除旧 NOPASSWD ALL。
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo '需要管理员权限' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
for file in scripts/antifield-maint.mjs scripts/backup-secrets.sh deploy/host/antifield-maint deploy/host/020-antifield-maint.sudoers; do
  if LC_ALL=C grep -q $'\r' "$root/$file"; then
    echo '维护输入必须使用 LF 行尾，未替换已安装入口' >&2
    exit 1
  fi
done
candidate=$(mktemp /etc/sudoers.d/.antifield-maint.XXXXXX)
trap 'rm -f -- "$candidate"' EXIT
install -o root -g root -m 0440 "$root/deploy/host/020-antifield-maint.sudoers" "$candidate"
visudo -cf "$candidate"
install -d -o root -g root -m 0755 /usr/local/libexec /usr/local/sbin
install -o root -g root -m 0755 "$root/scripts/antifield-maint.mjs" /usr/local/libexec/antifield-maint.mjs
install -o root -g root -m 0755 "$root/scripts/backup-secrets.sh" /usr/local/libexec/antifield-backup-secrets.sh
install -o root -g root -m 0755 "$root/deploy/host/antifield-maint" /usr/local/sbin/antifield-maint
mv -T -- "$candidate" /etc/sudoers.d/020-antifield-maint
visudo -c
echo '固定维护入口已安装；旧权限尚未变更。'
