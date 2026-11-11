/**
 * 设备登记与请求签名。
 * 浏览器登录仍只发 Cookie；Bearer 覆盖方法、路径与原始请求体。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { canonicalDeviceRequest, DEVICE_ACTIVE_LIMIT, DEVICE_BODY_LIMIT } from '../src/auth/device-sign.ts'
import { registerDevice } from '../src/auth/devices.ts'
import { createUser } from '../src/auth/users.ts'
import { AppError } from '../src/util/errors.ts'
import { cleanupDir, cookieHeader, currentCode, parseSetCookies, seedAdmin, tempDataDir, testConfig, testDb } from './helpers.ts'

interface DeviceKey {
  publicKey: string
  privateKey: KeyObject
}

interface Enrolled {
  id: string
  token: string
  name: string
}

function createDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  assert.equal(jwk.x?.length, 43)
  return { publicKey: jwk.x!, privateKey }
}

function resetTotp(db: DatabaseSync, userId: string): void {
  db.prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(userId)
}

function deviceHeaders(
  key: DeviceKey,
  deviceId: string,
  token: string,
  method: string,
  url: string,
  body: Buffer,
  overrides: { timestamp?: string; nonce?: string; signature?: string } = {},
): Record<string, string> {
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = overrides.nonce ?? randomBytes(18).toString('base64url')
  const message = canonicalDeviceRequest({ deviceId, timestamp, nonce, method, path: url, body })
  const signature = overrides.signature ?? sign(null, Buffer.from(message, 'utf8'), key.privateKey).toString('base64url')
  return {
    authorization: `Bearer ${token}`,
    'x-device-id': deviceId,
    'x-device-timestamp': timestamp,
    'x-device-nonce': nonce,
    'x-device-signature': signature,
  }
}

async function passwordChallenge(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: { username, password },
  })
  assert.equal(response.statusCode, 200, response.body)
  return response.json().challenge as string
}

test('浏览器登录不返回会话原文，设备签名覆盖读写与失败路径', async () => {
  const dir = tempDataDir()
  const db = testDb(dir)
  const seeded = await seedAdmin(db)
  const context = await buildApp(testConfig(dir), db)
  const app = context.app
  let password = seeded.password
  try {
    const health = await app.inject({ method: 'GET', url: '/healthz' })
    assert.equal(health.json().schemaVersion, 21)

    const challenge = await passwordChallenge(app, seeded.username, password)
    const invalidDevice = await app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      payload: { challenge, code: currentCode(seeded.secret), device: { name: '  ' } },
    })
    assert.equal(invalidDevice.statusCode, 400)
    assert.equal(invalidDevice.json().error.code, 'invalid_device')

    const web = await app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      payload: { challenge, code: currentCode(seeded.secret) },
    })
    assert.equal(web.statusCode, 200, web.body)
    const webBody = web.json() as { sessionToken?: string; csrfToken: string }
    assert.equal(Object.hasOwn(webBody, 'sessionToken'), false)
    const cookies = parseSetCookies(web.headers['set-cookie'] as string[] | undefined)
    const cookie = cookieHeader(cookies)
    const csrf = cookies.af_csrf!

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/devices/not-a-device',
      headers: { cookie },
      payload: { name: '浏览器' },
    })
    assert.equal(noCsrf.statusCode, 403)
    assert.equal(noCsrf.json().error.code, 'csrf_failed')

    const browserHeartbeat = await app.inject({
      method: 'POST',
      url: '/api/devices/heartbeat',
      headers: { cookie, 'x-csrf-token': csrf },
    })
    assert.equal(browserHeartbeat.statusCode, 403)
    assert.equal(browserHeartbeat.json().error.code, 'device_required')

    resetTotp(db, seeded.userId)
    const key = createDeviceKey()
    const first = await enroll(app, db, seeded, password, key, '书房电脑')
    const listed = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(listed.statusCode, 200, listed.body)
    const devices = listed.json().devices as Array<Record<string, unknown>>
    assert.equal(devices.length, 1)
    assert.equal(devices[0]?.current, true)
    assert.equal(devices[0]?.online, false)
    assert.equal(Object.hasOwn(devices[0] ?? {}, 'publicKey'), false)

    const browserList = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })
    assert.equal(browserList.statusCode, 200)
    assert.equal(browserList.json().devices[0].current, false)

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/devices/heartbeat',
      headers: deviceHeaders(key, first.id, first.token, 'POST', '/api/devices/heartbeat', Buffer.alloc(0)),
    })
    assert.equal(heartbeat.statusCode, 200, heartbeat.body)
    const online = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(online.json().devices[0].online, true)

    db.prepare("UPDATE devices SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(first.id)
    const offline = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(offline.json().devices[0].online, false)

    const renameBody = Buffer.from(JSON.stringify({ name: '客厅电脑' }))
    const renamed = await app.inject({
      method: 'POST',
      url: `/api/devices/${first.id}`,
      headers: {
        ...deviceHeaders(key, first.id, first.token, 'POST', `/api/devices/${first.id}`, renameBody),
        'content-type': 'application/json',
      },
      payload: renameBody,
    })
    assert.equal(renamed.statusCode, 200, renamed.body)

    const bad = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0), {
        signature: 'A'.repeat(86),
      }),
    })
    assert.equal(bad.statusCode, 401)
    assert.equal(bad.json().error.code, 'device_signature_invalid')
    const auditRow = db.prepare("SELECT detail_json FROM audit_log WHERE action = 'device.auth_failed'").get() as { detail_json: string }
    assert.match(auditRow.detail_json, /bad_signature/)
    assert.doesNotMatch(auditRow.detail_json, /A{20}/)

    const replayHeaders = deviceHeaders(key, first.id, first.token, 'POST', '/api/devices/heartbeat', Buffer.alloc(0))
    const replayFirst = await app.inject({ method: 'POST', url: '/api/devices/heartbeat', headers: replayHeaders })
    assert.equal(replayFirst.statusCode, 200, replayFirst.body)
    const replaySecond = await app.inject({ method: 'POST', url: '/api/devices/heartbeat', headers: replayHeaders })
    assert.equal(replaySecond.statusCode, 401)
    assert.equal(replaySecond.json().error.code, 'device_replay')

    const skewed = String(Math.floor(Date.now() / 1000) - 600)
    const skew = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0), { timestamp: skewed }),
    })
    assert.equal(skew.statusCode, 401)
    assert.equal(skew.json().error.code, 'device_clock_skew')

    const fallback = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { cookie, authorization: 'Basic abc' },
    })
    assert.equal(fallback.statusCode, 401)
    assert.equal(fallback.json().error.code, 'invalid_authorization')

    const missing = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${first.token}` },
    })
    assert.equal(missing.statusCode, 401)
    assert.equal(missing.json().error.code, 'device_headers_required')

    resetTotp(db, seeded.userId)
    const again = await enroll(app, db, seeded, password, key, '书房电脑')
    assert.equal(again.id, first.id)
    const stale = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, first.id, first.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(stale.statusCode, 401)
    assert.equal(stale.json().error.code, 'device_mismatch')

    resetTotp(db, seeded.userId)
    const otherKey = createDeviceKey()
    const second = await enroll(app, db, seeded, password, otherKey, '手机')
    const changeBody = Buffer.from(JSON.stringify({
      currentPassword: password,
      newPassword: 'new-password-1234',
      totpCode: currentCode(seeded.secret),
    }))
    const changed = await app.inject({
      method: 'POST',
      url: '/api/account/password',
      headers: {
        ...deviceHeaders(otherKey, second.id, second.token, 'POST', '/api/account/password', changeBody),
        'content-type': 'application/json',
      },
      payload: changeBody,
    })
    assert.equal(changed.statusCode, 200, changed.body)
    password = 'new-password-1234'
    const otherDead = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(key, again.id, again.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(otherDead.statusCode, 401)
    assert.equal(otherDead.json().error.code, 'device_mismatch')
    const still = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(otherKey, second.id, second.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(still.statusCode, 200, still.body)

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${second.id}`,
      headers: deviceHeaders(otherKey, second.id, second.token, 'DELETE', `/api/devices/${second.id}`, Buffer.alloc(0)),
    })
    assert.equal(revoked.statusCode, 200, revoked.body)
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: deviceHeaders(otherKey, second.id, second.token, 'GET', '/api/devices', Buffer.alloc(0)),
    })
    assert.equal(afterRevoke.statusCode, 401)
    assert.equal(afterRevoke.json().error.code, 'device_revoked')

    resetTotp(db, seeded.userId)
    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      payload: {
        challenge: await passwordChallenge(app, seeded.username, password),
        code: currentCode(seeded.secret),
        device: { name: '手机', platform: 'android', publicKey: otherKey.publicKey, appVersion: '1.1.1' },
      },
    })
    assert.equal(reused.statusCode, 401)
    assert.equal(reused.json().error.code, 'device_revoked')

    const otherUser = createUser(db, {
      username: 'other',
      passwordHash: 'x',
      passwordSalt: 'y',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      recoveryCodeHashes: [],
    })
    assert.throws(
      () => registerDevice(db, otherUser.id, { name: '占用', platform: 'windows', publicKey: key.publicKey, appVersion: '1.1.1' }),
      (error: unknown) => error instanceof AppError && error.code === 'device_key_in_use',
    )
    const active = db.prepare('SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND revoked_at IS NULL').get(seeded.userId) as { c: number }
    for (let index = Number(active.c); index < DEVICE_ACTIVE_LIMIT; index += 1) {
      registerDevice(db, seeded.userId, {
        name: `额外${index}`,
        platform: 'android',
        publicKey: createDeviceKey().publicKey,
        appVersion: '1.1.1',
      })
    }
    assert.throws(
      () => registerDevice(db, seeded.userId, {
        name: '超限',
        platform: 'windows',
        publicKey: createDeviceKey().publicKey,
        appVersion: '1.1.1',
      }),
      (error: unknown) => error instanceof AppError && error.code === 'device_limit',
    )
  } finally {
    await app.close()
    db.close()
    cleanupDir(dir)
  }
})

test('声明超过 9 MiB 的设备请求在验签前拒绝', async () => {
  const dir = tempDataDir()
  const db = testDb(dir)
  const context = await buildApp(testConfig(dir), db)
  try {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/devices/heartbeat',
      headers: {
        authorization: `Bearer ${'a'.repeat(32)}`,
        'content-type': 'application/json',
        'content-length': String(DEVICE_BODY_LIMIT + 1),
      },
      payload: '{}',
    })
    assert.equal(response.statusCode, 413)
    assert.equal(response.json().error.code, 'device_body_too_large')
  } finally {
    await context.app.close()
    db.close()
    cleanupDir(dir)
  }
})

async function enroll(
  app: FastifyInstance,
  db: DatabaseSync,
  seeded: { username: string; secret: string; userId: string },
  password: string,
  key: DeviceKey,
  name: string,
): Promise<Enrolled> {
  resetTotp(db, seeded.userId)
  const challenge = await passwordChallenge(app, seeded.username, password)
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/totp',
    payload: {
      challenge,
      code: currentCode(seeded.secret),
      device: { name, platform: 'windows', publicKey: key.publicKey, appVersion: '1.1.1' },
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json() as { sessionToken: string; device: { id: string; name: string } }
  assert.equal(typeof body.sessionToken, 'string')
  assert.equal(body.device.name, name)
  return { id: body.device.id, token: body.sessionToken, name }
}
