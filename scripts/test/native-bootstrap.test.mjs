/** 用离线页环境验证原生静态缓存迁移，账号存储不提供给脚本；不访问系统浏览器或网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { URL } from 'node:url'

const source = readFileSync(new URL('../../apps/client/src-tauri/src/native-bootstrap.js', import.meta.url), 'utf8')

test('旧原生离线页解除静态缓存后仅刷新一次，保留其他缓存', async () => {
  const removed = []
  let reloads = 0
  let unregisters = 0
  await runInNewContext(source, {
    navigator: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregisters++; return true } }] } },
    caches: { keys: async () => ['antifieldcloud-static-old', 'unrelated'], delete: async (key) => { removed.push(key); return true } },
    location: { reload: () => reloads++ },
    console: { warn: () => assert.fail('不应失败') },
  })
  assert.equal(unregisters, 1)
  assert.deepEqual(removed, ['antifieldcloud-static-old'])
  assert.equal(reloads, 1)
})

test('没有旧 Worker 不触碰缓存，注销失败不循环刷新', async () => {
  for (const registrations of [[], [{ unregister: async () => false }]]) {
    let warnings = 0
    await runInNewContext(source, {
      navigator: { serviceWorker: { getRegistrations: async () => registrations } },
      caches: { keys: () => assert.fail('不应清理缓存') },
      location: { reload: () => assert.fail('不应刷新') },
      console: { warn: () => warnings++ },
    })
    assert.equal(warnings, registrations.length)
  }
})
