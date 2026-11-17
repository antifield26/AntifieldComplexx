#!/usr/bin/env bash
# 给 DSH Web 的插件查询安装固定的 npm 与 pnpm。只写入 /usr/local，不读取凭据，不改 profile。
# Web 服务启用 ProtectHome，不能执行指向主目录的 npm。pnpm view 会转去调用 npm。
# npm 12 不接受 view 上的 fetch-retries 参数，查询包装只在该子命令去掉它。
set -euo pipefail
npm_version=12.2.2
pnpm_version=10.34.9
prefix=/usr/local
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ "$(id -u)" != 0 ]]; then
  echo "请以 root 安装 pnpm" >&2
  exit 2
fi

npm_bin="$prefix/bin/npm"
npx_bin="$prefix/bin/npx"
node_bin="$prefix/bin/node"
home_link() {
  local path="$1" target=""
  [[ -L "$path" ]] || return 1
  target=$(readlink -f -- "$path" || true)
  [[ "$target" == /home/* || "$target" == /root/* ]]
}
installer=""
if [[ -e "$npm_bin" ]]; then
  installer=$(readlink -f -- "$npm_bin" || true)
fi
current_npm=""
if [[ -x "$npm_bin" ]]; then
  current_npm=$("$npm_bin" --version 2>/dev/null || true)
fi
if [[ ! -x "$npm_bin" || -z "$installer" || "$current_npm" != "$npm_version" ]] || home_link "$npm_bin"; then
  if [[ ! -f "$installer" || ! -x "$node_bin" ]]; then
    echo "没有可用的 npm 安装器" >&2
    exit 1
  fi
  if home_link "$npx_bin"; then rm -f -- "$npx_bin"; fi
  if home_link "$npm_bin"; then rm -f -- "$npm_bin"; fi
  "$node_bin" "$installer" install -g "npm@${npm_version}" --prefix "$prefix" --no-audit --no-fund
fi
npm_target=$(readlink -f -- "$npm_bin")
if [[ "$npm_target" == /home/* || "$npm_target" == /root/* || ! -x "$npm_bin" || "$("$npm_bin" --version)" != "$npm_version" ]]; then
  echo "npm 不可用于 Web 服务" >&2
  exit 1
fi

if [[ ! -x "$prefix/bin/pnpm" || "$("$prefix/bin/pnpm" --version)" != "$pnpm_version" ]]; then
  PATH="$prefix/bin:${PATH:-/usr/bin:/bin}" "$npm_bin" install -g "pnpm@${pnpm_version}" --prefix "$prefix" --no-audit --no-fund
fi
if [[ "$("$prefix/bin/pnpm" --version)" != "$pnpm_version" ]]; then
  echo "pnpm 不可用于 Web 服务" >&2
  exit 1
fi
wrapper="$prefix/bin/pnpm-dsh"
install -m 0755 -- "$script_dir/pnpm-dsh.mjs" "$wrapper"
if [[ ! -x "$wrapper" || "$(head -n 1 -- "$wrapper")" != "#!/usr/local/bin/node" ]]; then
  echo "pnpm 查询包装不可用" >&2
  exit 1
fi
echo "npm $npm_version 与 pnpm $pnpm_version 已在 $prefix/bin"
