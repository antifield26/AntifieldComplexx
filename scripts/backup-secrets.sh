#!/usr/bin/env bash
# 以 root 生成加密密钥备份（age）：
# - 打包应用、Cloudflare 与 Minecraft 配置，以及当前 Agent 的凭据与一致性数据库快照；
# - 明文只在 0700 临时目录内存在，trap 清理；失败不留下未加密产物；
# - 用 age 公钥加密为 secrets-<UTC>.tar.age，并写 .sha256 旁文件；保留最近 N 份并清理孤儿 sidecar；
# - 公钥：/etc/antifieldcloud/secrets-age.pub（一行 age1...，root 所有、组/其他不可写；私钥离机保存）；
# - 可选 --include-host-config：额外打包 deploy.conf、nftables、sshd drop-in、fail2ban、systemd drop-in 等
#   主机级配置（纯配置、无密钥；用于 Pi 重建，默认关闭，打包后仍受 age 加密保护）；
# - opencode 已安装但数据库缺失/快照失败时直接失败（不允许生成缺 opencode DB 的“成功”密钥包）；
# - stdout 单行 JSON；失败输出 {ok:false,error} 且退出码 1；绝不输出密码/密钥。
set -euo pipefail

INCLUDE_HOST_CONFIG=""
for arg in "$@"; do
  case "$arg" in
    --include-host-config) INCLUDE_HOST_CONFIG="1" ;;
    --help)
      printf '用法：sudo bash scripts/backup-secrets.sh [--include-host-config]\n'
      exit 0
      ;;
    *)
      printf '{"ok":false,"error":"unknown_argument"}\n'
      exit 2
      ;;
  esac
done

BACKUP_DIR=${SECRETS_BACKUP_DIR:-/var/lib/antifieldcloud/backups/secrets}
RECIPIENT_FILE=${SECRETS_AGE_RECIPIENT_FILE:-/etc/antifieldcloud/secrets-age.pub}
KEEP=${SECRETS_KEEP:-2}
GROUP=${SECRETS_GROUP:-antifield}
NODE_BIN=${NODE_BIN:-/usr/local/bin/node}
DSH_CONFIG=/etc/antifieldcloud/dsh
DSH_QQ_DB=/var/lib/antifield-dsh-qq/qq-memory.sqlite
OPENCODE_HOME=${OPENCODE_HOME:-/var/lib/opencode}
OPENCODE_DB=${OPENCODE_DB:-$OPENCODE_HOME/.local/share/opencode/opencode.db}
OPENCODE_CONFIG_DIR=${OPENCODE_CONFIG_DIR:-$OPENCODE_HOME/.config/opencode}
# 明文临时目录优先放 /run（tmpfs，重启即清）；不可用时回退 /tmp 并保持 0700（OP-10）。
SECRETS_TMP_DIR=${SECRETS_TMP_DIR:-/run/antifieldcloud/secrets-tmp}
opencode_warning=""

json_error() {
  printf '{"ok":false,"error":"%s"}\n' "$1"
  exit 1
}

if [[ "$(id -u)" -ne 0 ]]; then
  json_error "需要 root 权限"
fi
if ! command -v age >/dev/null 2>&1; then
  json_error "age 未安装（apt-get install -y age 后重试）"
fi
if [[ ! -f "$RECIPIENT_FILE" ]]; then
  json_error "缺少 age 公钥文件：$RECIPIENT_FILE（age-keygen 生成后把 age1... 写入该文件）"
fi

# 公钥文件安全校验：必须 root 所有，且组/其他不可写（防止被篡改后加密到攻击者密钥）。
key_mode=$(stat -c '%a' "$RECIPIENT_FILE")
key_owner=$(stat -c '%u' "$RECIPIENT_FILE")
if [[ "$key_owner" -ne 0 ]]; then
  json_error "age 公钥文件必须由 root 所有：$RECIPIENT_FILE"
fi
if (( (8#$key_mode & 8#022) != 0 )); then
  json_error "age 公钥文件权限过宽（$key_mode），要求组/其他不可写：$RECIPIENT_FILE"
fi
RECIPIENT=$(head -n 1 "$RECIPIENT_FILE" | tr -d '\r\n')
if [[ ! "$RECIPIENT" =~ ^age1[0-9a-z]{16,}$ ]]; then
  json_error "age 公钥格式无效：$RECIPIENT_FILE"
fi

umask 027
mkdir -p "$BACKUP_DIR"
if getent group "$GROUP" >/dev/null 2>&1; then
  chgrp "$GROUP" "$BACKUP_DIR" 2>/dev/null || true
fi
chmod 2750 "$BACKUP_DIR" 2>/dev/null || chmod 0750 "$BACKUP_DIR"

# 所有明文只允许出现在 0700 临时目录；任何退出路径都清理，失败不留下未加密产物。
# 优先使用 tmpfs（/run/antifieldcloud），避免明文短暂落盘；启动前清理上次残留。
tmp_parent="$SECRETS_TMP_DIR"
if ! mkdir -p "$tmp_parent" 2>/dev/null; then
  tmp_parent="${TMPDIR:-/tmp}/antifieldcloud-secrets-tmp"
  mkdir -p "$tmp_parent"
fi
chmod 0700 "$tmp_parent"
find "$tmp_parent" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
# opencode 快照需要以 opencode 用户写入，且其父目录必须可被 opencode 用户遍历：
# tmp_parent/work 都是 0700 root，直接在其下创建快照目录会阻断 opencode 的路径遍历。
# 因此单独使用 0711 父目录（其他用户可进入但不可列目录），快照子目录 0700 归 opencode。
snapshot_parent="${tmp_parent%/}-opencode"
if ! mkdir -p "$snapshot_parent" 2>/dev/null; then
  snapshot_parent="${TMPDIR:-/tmp}/antifieldcloud-secrets-opencode"
  mkdir -p "$snapshot_parent"
fi
chmod 0711 "$snapshot_parent"
find "$snapshot_parent" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
work=$(mktemp -d "$tmp_parent/work.XXXXXX")
chmod 0700 "$work"
snapshot_root=""
mcbot_snapshot=""
archive=""
tmp_tar="$work/secrets.tar.gz"
cleanup() {
  rm -rf "$work"
  if [[ -n "$snapshot_root" ]]; then rm -rf "$snapshot_root"; fi
  if [[ -n "$mcbot_snapshot" ]]; then rm -rf "$mcbot_snapshot"; fi
  if [[ -n "${snapshot_parent:-}" ]]; then rmdir "$snapshot_parent" 2>/dev/null || true; fi
  if [[ -n "$archive" && -e "$archive" && -z "${archive_committed:-}" ]]; then
    rm -f "$archive" "$archive.sha256"
  fi
}
trap cleanup EXIT

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive_name="secrets-${stamp}.tar.age"
archive="$BACKUP_DIR/$archive_name"
sha_file="$archive.sha256"

# opencode 用户执行固定 node:sqlite 快照命令（不用 shell 拼接用户输入）。
run_as_opencode() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u opencode -- "$@"
  else
    sudo -n -u opencode -H "$@"
  fi
}

# 密钥包按当前 QQ 接收者选择 Agent 运行时。切换前仍保存 OpenCode 备份。
agent_runtime=opencode
if [[ ! -f /etc/antifieldcloud/env ]]; then
  json_error "缺少 /etc/antifieldcloud/env，无法做密钥备份"
fi
qq_managed=$(sed -nE 's/^[[:space:]]*DSH_QQ_MANAGED[[:space:]]*=//p' /etc/antifieldcloud/env | tail -n 1 | tr -d "'\"[:space:]")
case "${qq_managed,,}" in
  1|true|yes|on) agent_runtime=dsh ;;
  ""|0|false|no|off) ;;
  *) json_error "DSH_QQ_MANAGED 配置无效" ;;
esac

read_setting() {
  sed -nE "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" |
    tail -n 1 | sed -E "s/[[:space:]]+$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

mcbot_required=false
mcbot_included=false
mcbot_files='null'
mcbot_enabled=$(read_setting /etc/antifieldcloud/env MCBOT_ENABLED)
case "${mcbot_enabled,,}" in
  1|true|yes|on)
    mcbot_required=true
    [[ -f /etc/mcbot/env ]] || json_error "缺少 mcbot 生产配置"
    data=$(read_setting /etc/mcbot/env DATA_DIR)
    data=${data:-/var/lib/mcbot}
    goals=$(read_setting /etc/mcbot/env GOALS_FILE)
    task=$(read_setting /etc/mcbot/env TASK_STATE_FILE)
    mcbot_snapshot=$(mktemp -d "$snapshot_parent/mcbot.XXXXXX")
    chown mcbot:mcbot "$mcbot_snapshot"
    # 固定维护副本与 release 目录均使用这个非 root 快照入口；不得加载调用者指定脚本。
    helper=/opt/antifieldcloud/current/scripts/backup-mcbot-state.mjs
    if ! result=$(runuser -u mcbot -- "$NODE_BIN" "$helper" capture "$mcbot_snapshot/mcbot-state" \
        "$data" "${goals:-$data/goals.db}" "${task:-$data/task-state.json}" 2>/dev/null); then
      printf '%s\n' "$result" >&2
      json_error "mcbot 状态读取或一致性快照失败"
    fi
    mcbot_files=$("$NODE_BIN" -p 'JSON.stringify(JSON.parse(require("node:fs").readFileSync(0, "utf8")).files)' <<< "$result")
    mcbot_included=true
    ;;
  ""|0|false|no|off) ;;
  *) json_error "MCBOT_ENABLED 配置无效" ;;
esac

# 汇总要加密的根文件；env 必须存在，其它缺失时跳过并计数。
root_files=()
for candidate in \
  /etc/antifieldcloud/env \
  /etc/cloudflared/config.yml \
  /etc/cloudflared/cert.pem \
  /home/antifield/minecraft-server/server.properties; do
  if [[ -f "$candidate" ]]; then
    root_files+=("${candidate#/}")
  fi
done
for candidate in /etc/cloudflared/*.json; do
  if [[ -f "$candidate" ]]; then
    root_files+=("${candidate#/}")
  fi
done
if [[ "$agent_runtime" == "opencode" ]]; then
  for candidate in /etc/opencode/opencode.env "$OPENCODE_CONFIG_DIR/opencode.json" "$OPENCODE_CONFIG_DIR/service.json"; do
    if [[ -f "$candidate" ]]; then root_files+=("${candidate#/}"); fi
  done
else
  dsh_files=(web.env qq-deepseek-key mcbot-agent-deepseek-key qq-app-id qq-app-secret qq-access.json)
  web_auth=$(sed -nE 's/^[[:space:]]*DSH_WEB_AUTH[[:space:]]*=//p' "$DSH_CONFIG/web.env" | tail -n 1 | tr -d "'\"[:space:]")
  case "$web_auth" in
    account) ;;
    ""|api-key) dsh_files+=(web-deepseek-key) ;;
    *) json_error "DSH Web 登录模式无效" ;;
  esac
  for credential_name in "${dsh_files[@]}"; do
    candidate="$DSH_CONFIG/$credential_name"
    if [[ ! -f "$candidate" || -L "$candidate" || ! -s "$candidate" ]]; then
      json_error "DSH 配置或凭据缺失"
    fi
    mode=$(stat -c '%a' -- "$candidate")
    if [[ "$(stat -c '%u' -- "$candidate")" != "0" ]] || (( (8#$mode & 8#077) != 0 )); then
      json_error "DSH 配置或凭据的权限无效"
    fi
    root_files+=("${candidate#/}")
  done
  browser_credentials=/var/lib/antifield-dsh-web/profile/.credentials.yaml
  if [[ ! -f "$browser_credentials" || -L "$browser_credentials" || ! -s "$browser_credentials" ]]; then
    json_error "DSH Web 签名凭据缺失"
  fi
  if [[ "$web_auth" == "account" ]] && ! grep -Fq 'deepseek-account-platform/default:' "$browser_credentials"; then
    json_error "DSH Web 账号授权缺失"
  fi
  root_files+=("${browser_credentials#/}")
fi
# 可选主机级配置（默认关闭）：Pi 重建所需、但不在应用归档/常规密钥包内的配置。
host_files_count=0
if [[ "$INCLUDE_HOST_CONFIG" == "1" ]]; then
  for candidate in \
    /etc/antifieldcloud/deploy.conf \
    /etc/nftables.conf \
    /etc/log2ram.conf \
    /etc/ssh/sshd_config \
    /etc/ssh/sshd_config.d/* \
    /etc/fail2ban/jail.local \
    /etc/fail2ban/jail.d/* \
    /etc/systemd/system/cloudflared.service.d/* \
    /etc/systemd/system/nftables.service.d/* \
    /etc/systemd/journald.conf.d/* \
    /etc/systemd/system/antifieldcloud.service \
    /etc/systemd/system/antifieldcloud-world.service \
    /etc/systemd/system/antifieldcloud-world.timer \
    /etc/systemd/system/antifieldcloud-health.service \
    /etc/systemd/system/antifieldcloud-health.timer \
    /etc/systemd/system/searxng.service \
    /etc/systemd/system/antifield-dsh-*.service \
    /etc/systemd/system/antifieldcloud.service.d/*dsh*.conf \
    /etc/systemd/system/mcbot.service.d/*dsh*.conf \
    /etc/tmpfiles.d/antifield-dsh-tmpfiles.conf; do
    if [[ -f "$candidate" ]]; then
      root_files+=("${candidate#/}")
      host_files_count=$((host_files_count + 1))
    fi
  done
fi
if [[ ${#root_files[@]} -eq 0 ]]; then
  json_error "没有可备份的密钥文件"
fi

# opencode 一致性快照：已安装 opencode（存在 opencode 用户或数据目录）时，数据库必须存在且快照成功。
# 失败直接退出：避免 PC 侧 secretsOk=true 但 includesOpencode=false 的静默漏备（OPS-03）。
opencode_included=false
dsh_included=false
opencode_present=false
if [[ "$agent_runtime" == "opencode" ]] && { getent passwd opencode >/dev/null 2>&1 || [[ -d "$OPENCODE_HOME" ]]; }; then
  opencode_present=true
fi
if [[ "$opencode_present" == "true" ]]; then
  if [[ ! -f "$OPENCODE_DB" ]]; then
    json_error "opencode 已安装但数据库不存在：$OPENCODE_DB（拒绝生成缺 opencode DB 的密钥包；请检查 OpenCode 版本/路径）"
  fi
  if [[ ! -x "$NODE_BIN" ]]; then
    json_error "opencode 已安装但 Node 不可执行：$NODE_BIN（无法做一致性快照）"
  fi
  snapshot_root=$(mktemp -d "$snapshot_parent/opencode.XXXXXX")
  snapshot_dir="$snapshot_root/opencode"
  mkdir -p "$snapshot_dir"
  chown opencode:opencode "$snapshot_root" "$snapshot_dir"
  chmod 0700 "$snapshot_root" "$snapshot_dir"
  snapshot_db="$snapshot_dir/opencode.db"
  if ! run_as_opencode sh -c 'test -w "$0"' "$snapshot_dir" >/dev/null 2>&1; then
    json_error "opencode 快照目录不可写（opencode 用户无法访问临时目录）"
  fi
  # node:sqlite 的 backup() 对运行中的 WAL 库做一致性快照；命令固定、无用户输入拼接。
  if ! run_as_opencode env SOURCE_OC_DB="$OPENCODE_DB" TARGET_OC_DB="$snapshot_db" "$NODE_BIN" --input-type=module -e '
    import { DatabaseSync, backup } from "node:sqlite"
    const source = new DatabaseSync(process.env.SOURCE_OC_DB, { readOnly: true })
    try {
      await backup(source, process.env.TARGET_OC_DB)
    } finally {
      source.close()
    }
  ' >/dev/null 2>&1; then
    json_error "opencode 数据库一致性快照失败（密钥包未生成；请检查 opencode 用户/数据库权限）"
  fi
  chmod 0600 "$snapshot_db" 2>/dev/null || true
  opencode_included=true
fi

if [[ "$agent_runtime" == "dsh" ]]; then
  if [[ ! -f "$DSH_QQ_DB" || -L "$DSH_QQ_DB" || ! -x "$NODE_BIN" ]]; then
    json_error "DSH QQ 记忆库不可用"
  fi
  snapshot_root=$(mktemp -d "$snapshot_parent/dsh.XXXXXX")
  snapshot_dir="$snapshot_root/dsh"
  install -d -o antifield-dsh-qq -g antifield-dsh-qq -m 0700 "$snapshot_dir"
  chown antifield-dsh-qq:antifield-dsh-qq "$snapshot_root"
  if ! runuser -u antifield-dsh-qq -- env SOURCE_DSH_DB="$DSH_QQ_DB" TARGET_DSH_DB="$snapshot_dir/qq-memory.sqlite" \
    "$NODE_BIN" --input-type=module -e '
    import { DatabaseSync, backup } from "node:sqlite"
    process.umask(0o077)
    const source = new DatabaseSync(process.env.SOURCE_DSH_DB, { readOnly: true })
    try {
      const count = source.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = ? AND name IN (?, ?, ?, ?, ?, ?)")
        .get("table", "roles", "memory", "memory_settings", "proposals", "imports", "memory_generations").n
      if (count !== 6) throw new Error()
      await backup(source, process.env.TARGET_DSH_DB)
    } finally {
      source.close()
    }
  ' >/dev/null 2>&1; then
    json_error "DSH QQ 记忆库一致性快照失败"
  fi
  dsh_included=true
fi
tar_args=(-C / "${root_files[@]}")
if [[ "$dsh_included" == "true" ]]; then
  tar_args+=(-C "$snapshot_root" dsh)
elif [[ "$opencode_included" == "true" ]]; then
  tar_args+=(-C "$snapshot_root" opencode)
fi
if [[ "$mcbot_included" == "true" ]]; then
  tar_args+=(-C "$mcbot_snapshot" mcbot-state)
fi
tar -czf "$tmp_tar" "${tar_args[@]}"

age -r "$RECIPIENT" -o "$archive" "$tmp_tar"
chmod 0640 "$archive"
if getent group "$GROUP" >/dev/null 2>&1; then
  chgrp "$GROUP" "$archive" 2>/dev/null || true
fi
sha256=$(sha256sum "$archive" | cut -d' ' -f1)
printf '%s  %s\n' "$sha256" "$archive_name" > "$sha_file"
chmod 0640 "$sha_file"
if getent group "$GROUP" >/dev/null 2>&1; then
  chgrp "$GROUP" "$sha_file" 2>/dev/null || true
fi
archive_committed=1

# 保留最近 KEEP 份（含本次），删除更旧的归档与旁文件；清理无 .age 对应的 .sha256 孤儿。
mapfile -t stale < <(find "$BACKUP_DIR" -maxdepth 1 -name 'secrets-*.tar.age' -printf '%f\n' | sort -r | tail -n +$((KEEP + 1)))
for old in "${stale[@]}"; do
  rm -f "$BACKUP_DIR/$old" "$BACKUP_DIR/$old.sha256"
done
while IFS= read -r orphan_sha; do
  [[ -n "$orphan_sha" ]] || continue
  [[ -f "${orphan_sha%.sha256}" ]] || rm -f "$orphan_sha"
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'secrets-*.tar.age.sha256' -print)

size=$(stat -c '%s' "$archive")
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
extra_files=0
if [[ "$opencode_included" == "true" || "$dsh_included" == "true" ]]; then
  extra_files=1
fi
file_count=$(( ${#root_files[@]} + extra_files ))
if [[ "$mcbot_included" == "true" ]]; then
  file_count=$((file_count + 1))
fi
warnings_json="[]"
if [[ -n "$opencode_warning" ]]; then
  warnings_json="[\"$opencode_warning\"]"
fi
printf '{"ok":true,"archive":"%s","archiveName":"%s","sha256":"%s","sizeBytes":%s,"fileCount":%s,"agentRuntime":"%s","includesOpencode":%s,"includesDsh":%s,"includesHostConfig":%s,"hostConfigFileCount":%s,"createdAt":"%s","keep":%s,"warnings":%s,"mcbotStateRequired":%s,"includesMcbotState":%s,"mcbotStateFiles":%s}\n' \
  "$archive" "$archive_name" "$sha256" "$size" "$file_count" "$agent_runtime" "$opencode_included" "$dsh_included" "$([[ "$INCLUDE_HOST_CONFIG" == "1" ]] && printf true || printf false)" "$host_files_count" "$created_at" "$KEEP" "$warnings_json" "$mcbot_required" "$mcbot_included" "$mcbot_files"
