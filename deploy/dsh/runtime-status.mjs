/** 发布无凭据的 DSH 服务就绪信息，供 Workbench 与运维脚本只读检查。 */
import { chmodSync, renameSync, writeFileSync } from 'node:fs'

export function publishRuntimeStatus(path, ready, pluginVersion) {
  if (!path) return
  const temporary = `${path}.${process.pid}.tmp`
  const state = { ready, version: '0.2.2-rc.3', ...(pluginVersion ? { pluginVersion } : {}) }
  writeFileSync(temporary, JSON.stringify(state) + '\n', { mode: 0o644 })
  chmodSync(temporary, 0o644)
  renameSync(temporary, path)
}
