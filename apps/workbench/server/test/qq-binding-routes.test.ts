/** 主站管理路由的权限夹具；不连接真实 QQ 或主机 socket。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import type { AuthService } from '../src/auth/service.ts'
import type { Config } from '../src/config.ts'
import type { AuthContext } from '../src/types.ts'
import { registerQqBindingRoutes } from '../src/http/routes/qq-binding.ts'
import { sha256Hex } from '../src/util/ids.ts'

test('QQ 写入要求主站登录和 CSRF，再认证数据留在 Workbench', async () => {
  const app = Fastify()
  const db = new DatabaseSync(':memory:')
  let reauth = 0
  const calls: Record<string, unknown>[] = []
  const site = 'https://app.example.test'
  const config = { appOrigin: site, dshWebUrl: 'http://127.0.0.1:3080/' } as Config
  const auth = { async confirmQqBinding() { reauth += 1 } } as unknown as AuthService
  app.addHook('onRequest', async request => {
    if (request.headers.cookie === 'fixture=yes') {
      request.auth = {
        session: { id: 'owner1', csrf_hash: sha256Hex('csrf-fixture') }, user: { username: 'fixture' },
      } as AuthContext
    }
  })
  db.exec('CREATE TABLE audit_log(ts TEXT, actor TEXT, action TEXT, target TEXT, detail_json TEXT, ip TEXT)')
  registerQqBindingRoutes(app, config, auth, db, async value => {
    calls.push(value)
    return { phase: 'ready', bound: true, ready: true, appSecret: 'fixture-leak' }
  })
  try {
    const payload = { action: 'start', kind: 'manual', password: 'fixture-password', totpCode: '000001',
      appId: 'fixture-app', appSecret: 'fixture-platform' }
    const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/qq-binding', headers, payload })
    assert.equal((await post({})).statusCode, 401)
    assert.equal((await post({ cookie: 'fixture=yes', origin: site })).statusCode, 403)
    const headers = { cookie: 'fixture=yes', 'x-csrf-token': 'csrf-fixture' }
    assert.equal((await post({ ...headers, origin: 'https://ai.example.test' })).statusCode, 403)
    assert.equal((await post({ ...headers, origin: site, authorization: 'Bearer fixture' })).statusCode, 403)
    assert.equal(reauth, 0)
    const success = await post({ ...headers, origin: site })
    assert.equal(success.statusCode, 200)
    assert.equal(success.headers['cache-control'], 'no-store')
    assert.equal(reauth, 1)
    assert.deepEqual(calls, [{ action: 'start', kind: 'manual', owner: 'owner1', appId: 'fixture-app', appSecret: 'fixture-platform' }])
    assert.doesNotMatch(success.body, /fixture-platform|fixture-leak/)
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT detail_json FROM audit_log').all()), /fixture-password|fixture-platform|000001/)
  } finally { await app.close(); db.close() }
})
