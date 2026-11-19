#!/usr/bin/env bash
# 从同一份输入装配生产及 CI 候选，输出逐文件摘要供切换前比对。
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
release=$(cd -- "$1" && pwd -P)
[[ -z "$(ls -A -- "$release")" ]]
assets=(
  package.json package-lock.json patch-qq.mjs qq-policy.mjs qq-memory.mjs qq-memory-cli.mjs
  qq-agent.mjs qq-watchdog.mjs qq-binding.mjs qq-migrate-binding.mjs qq-scan.mjs web-broker.mjs runtime-status.mjs web-policy.yml web-account.yml web-account.conf web-scope.yml web-workspace.mjs install-pnpm.sh
  pnpm-dsh.mjs external-plugins.mjs plugin-page-guard.mjs plugin-page-hook.mjs
  mcbot-agent.mjs mcbot-minimal.yml dsh-mcbot.mjs session-steps.mjs
)
for asset in "${assets[@]}"; do
  install -m 0644 -- "$source_dir/$asset" "$release/$asset"
done
(
  cd -- "$release"
  umask 022
  PATH="/usr/local/bin:$PATH" npm ci --ignore-scripts --no-audit --no-fund
  node ./patch-qq.mjs
  test "$(node ./node_modules/@deepseek-ai/dsh/lib/bin.js --version)" = 0.2.2-rc.3
  install -d -m 0755 node_modules/@antifield/dsh-qq-plugin node_modules/@antifield/dsh-mcbot-plugin
  cp -a -- "$source_dir/plugins/qq/." node_modules/@antifield/dsh-qq-plugin/
  cp -a -- "$source_dir/plugins/mcbot/." node_modules/@antifield/dsh-mcbot-plugin/
  chmod -R a+rX node_modules/@antifield
)
(
  cd -- "$release"
  if [[ -f "$source_dir/../../release-files.json" ]]; then
    commit=$(node -p 'require(process.argv[1]).sourceCommit || "unknown"' "$source_dir/../../release-files.json")
  else
    commit=$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || echo unknown)
  fi
  printf '%s\n' "$commit" > source-commit
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > "$release.sha256.tmp"
  mv -- "$release.sha256.tmp" SHA256SUMS
)
