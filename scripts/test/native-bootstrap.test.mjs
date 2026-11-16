/** 确认原生壳不再注入 Service Worker 清理脚本。不访问浏览器或网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const tauriSrc = join(import.meta.dirname, '..', '..', 'apps', 'client', 'src-tauri', 'src')

test('原生壳不再携带 Service Worker 清理脚本', () => {
  assert.equal(existsSync(join(tauriSrc, 'native-bootstrap.js')), false)
  const rust = readdirSync(tauriSrc)
    .filter((name) => name.endsWith('.rs'))
    .map((name) => readFileSync(join(tauriSrc, name), 'utf8'))
    .join('\n')
  assert.equal(rust.includes('native-bootstrap'), false)
  assert.equal(rust.includes('serviceWorker'), false)
  assert.equal(rust.includes('antifieldcloud-static'), false)
})
