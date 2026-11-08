#!/usr/bin/env bash
# 停机窗口的加密冷备。管理员先停止对应 Agent 并排空会话，脚本只读取固定路径。
set -euo pipefail
umask 077
[[ $(id -u) == 0 && $# == 1 ]] || { echo "用法：以 root 执行 dsh-cold-backup.sh opencode|dsh" >&2; exit 2; }
kind=$1
case "$kind" in
  opencode)
    units=(opencode.service)
    entries=(var/lib/opencode etc/opencode etc/systemd/system/opencode.service)
    if [[ -d /etc/systemd/system/opencode.service.d ]]; then entries+=(etc/systemd/system/opencode.service.d); fi
    [[ -f /var/lib/opencode/.local/share/opencode/opencode.db ]] || { echo "缺少 OpenCode 数据库" >&2; exit 1; }
    ;;
  dsh)
    units=(antifield-dsh-web.service antifield-dsh-qq.service antifield-dsh-mcbot-agent.service)
    entries=(etc/antifieldcloud/dsh var/lib/antifield-dsh-web var/lib/antifield-dsh-qq)
    [[ -f /var/lib/antifield-dsh-qq/qq-memory.sqlite ]] || { echo "缺少 QQ 记忆库" >&2; exit 1; }
    ;;
  *) echo "未知 Agent 运行时" >&2; exit 2 ;;
esac
for unit in "${units[@]}"; do
  state=$(systemctl show --property=ActiveState --value "$unit")
  [[ $state == inactive || $state == failed ]] || { echo "Agent 尚未停机，拒绝生成冷备" >&2; exit 1; }
done
key=/etc/antifieldcloud/secrets-age.pub
[[ -f $key && ! -L $key && $(stat -c '%u' -- "$key") == 0 ]] || { echo "备份公钥无效" >&2; exit 1; }
mode=$(stat -c '%a' -- "$key")
(( (8#$mode & 8#022) == 0 )) || { echo "备份公钥权限无效" >&2; exit 1; }
recipient=$(head -n 1 -- "$key")
[[ $recipient =~ ^age1[0-9a-z]{16,}$ ]] || { echo "备份公钥格式无效" >&2; exit 1; }
for entry in "${entries[@]}"; do
  [[ -e /$entry && ! -L /$entry ]] || { echo "冷备输入缺失或是链接" >&2; exit 1; }
done
destination=/var/lib/antifieldcloud/backups/agent-cold
install -d -m 0700 "$destination"
archive="$kind-$(date -u +%Y%m%dT%H%M%S%NZ).tar.age"
partial=$(mktemp -- "$destination/.agent-cold.XXXXXXXX")
trap 'rm -f -- "$partial" "$partial.sha256"' EXIT
tar -czf - --exclude='var/lib/antifield-dsh-qq/.dsh-qqbot/media' \
  --exclude='var/lib/antifield-dsh-web/profile/logs' --exclude='var/lib/antifield-dsh-qq/profile/logs' \
  -C / "${entries[@]}" | age -r "$recipient" > "$partial"
sha=$(sha256sum -- "$partial" | cut -d' ' -f1)
printf '%s  %s\n' "$sha" "$archive" > "$partial.sha256"
mv -- "$partial" "$destination/$archive"
mv -- "$partial.sha256" "$destination/$archive.sha256"
printf '冷备已生成 %s\n' "$archive"
