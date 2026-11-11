/** Tauri 源的预检与跨源头。其它源不反射。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.ts'
import { CLIENT_ORIGINS } from '../src/http/client-cors.ts'
import { cleanupDir, tempDataDir, testConfig, testDb } from './helpers.ts'

test('只为 Tauri 源返回跨源头，预检不要求登录', async () => {
  const dir = tempDataDir()
  const db = testDb(dir)
  const context = await buildApp(testConfig(dir), db)
  try {
    for (const origin of CLIENT_ORIGINS) {
      const preflight = await context.app.inject({
        method: 'OPTIONS',
        url: '/api/devices',
        headers: { origin, 'access-control-request-method': 'GET' },
      })
      assert.equal(preflight.statusCode, 204)
      assert.equal(preflight.headers['access-control-allow-origin'], origin)
      assert.equal(preflight.headers['access-control-allow-credentials'], undefined)
      assert.match(String(preflight.headers['access-control-allow-headers']), /X-Device-Signature/)
      assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/)

      const health = await context.app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin },
      })
      assert.equal(health.statusCode, 200)
      assert.equal(health.headers['access-control-allow-origin'], origin)
    }

    const evil = await context.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    })
    assert.equal(evil.statusCode, 200)
    assert.equal(evil.headers['access-control-allow-origin'], undefined)

    const browser = await context.app.inject({ method: 'GET', url: '/healthz' })
    assert.equal(browser.statusCode, 200)
    assert.equal(browser.headers['access-control-allow-origin'], undefined)

    const evilPreflight = await context.app.inject({
      method: 'OPTIONS',
      url: '/api/devices',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' },
    })
    assert.notEqual(evilPreflight.statusCode, 204)
    assert.equal(evilPreflight.headers['access-control-allow-origin'], undefined)
  } finally {
    await context.app.close()
    db.close()
    cleanupDir(dir)
  }
})
