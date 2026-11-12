/** 分片附件接管：设备签名、会话归属、可见性与关联事务均在隔离目录和数据库中验证。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { Config } from '../src/config.ts'
import { buildApp } from '../src/app.ts'
import { canonicalDeviceRequest } from '../src/auth/device-sign.ts'
import { registerDevice } from '../src/auth/devices.ts'
import { createSession } from '../src/auth/sessions.ts'
import { cleanupDir, seedAdmin, tempDataDir, testConfig, testDb } from './helpers.ts'

const ACTOR = { username: 'admin', ip: '127.0.0.1' }

async function fixture(overrides: Partial<Config> = {}) {
  const dir = tempDataDir()
  const db = testDb(dir)
  const config = testConfig(dir, { chunkSizeBytes: 8 * 1024 * 1024, quotaBytes: 64 * 1024 * 1024, ...overrides })
  const seeded = await seedAdmin(db)
  const key = generateKeyPairSync('ed25519')
  const publicKey = key.publicKey.export({ format: 'jwk' }) as { x: string }
  const device = registerDevice(db, seeded.userId, {
    name: '附件测试', platform: 'windows', publicKey: publicKey.x, appVersion: '1.2.0',
  })
  const session = createSession(db, seeded.userId, 'attachment-csrf', 7, '127.0.0.1', 'test', device.id)
  const context = await buildApp(config, db)
  const note = context.notes.create(ACTOR, { title: '附件测试' })
  async function request(method: 'GET' | 'POST' | 'PUT', url: string, payload?: Buffer | Record<string, unknown>) {
    const raw = payload === undefined ? Buffer.alloc(0) : Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomBytes(18).toString('base64url')
    const message = canonicalDeviceRequest({ deviceId: device.id, timestamp, nonce, method, path: url, body: raw })
    return context.app.inject({
      method, url,
      headers: {
        authorization: `Bearer ${session.token}`,
        'x-device-id': device.id,
        'x-device-timestamp': timestamp,
        'x-device-nonce': nonce,
        'x-device-signature': sign(null, Buffer.from(message), key.privateKey).toString('base64url'),
        ...(payload === undefined ? {} : { 'content-type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: raw }),
    })
  }
  async function upload(name: string, body = Buffer.from('附件'), actor = ACTOR) {
    const init = context.uploads.init(actor, { name, parentId: null, size: body.length })
    for (let index = 0; index < init.totalChunks; index++) {
      await context.uploads.putChunk(actor, init.uploadId, index, body.subarray(index * init.chunkSize, (index + 1) * init.chunkSize))
    }
    const result = await context.uploads.complete(actor, init.uploadId)
    return { uploadId: init.uploadId, file: result.file }
  }
  const attach = (uploadId: string, noteId = note.id) => request('POST', `/api/notes/${noteId}/attachments/from-upload`, { uploadId })
  return {
    context, db, config, note, request, upload, attach,
    async close() { await context.app.close(); db.close(); cleanupDir(dir) },
  }
}

test('设备签名分片接管 25 MiB 附件，重试幂等且配额只计一次', async () => {
  const fx = await fixture()
  try {
    const bytes = Buffer.alloc(25 * 1024 * 1024, 0x61)
    const init = await fx.request('POST', '/api/uploads', { name: 'large.bin', size: bytes.length })
    assert.equal(init.statusCode, 201, init.body)
    const session = init.json() as { uploadId: string; chunkSize: number; totalChunks: number }
    for (let index = 0; index < session.totalChunks; index++) {
      const chunk = await fx.request('PUT', `/api/uploads/${session.uploadId}/chunks/${index}`,
        bytes.subarray(index * session.chunkSize, (index + 1) * session.chunkSize))
      assert.equal(chunk.statusCode, 200, chunk.body)
    }
    const complete = await fx.request('POST', `/api/uploads/${session.uploadId}/complete`, {})
    assert.equal(complete.statusCode, 200, complete.body)
    const fileId = complete.json().file.id as string
    const before = fx.context.files.usage().usedBytes
    const attached = await fx.attach(session.uploadId)
    assert.equal(attached.statusCode, 200, attached.body)
    assert.equal(attached.json().items[0].fileId, fileId)
    assert.equal(attached.json().items[0].size, bytes.length)
    assert.equal(fx.context.files.usage().usedBytes, before)
    assert.equal(fx.context.files.usage().fileCount, 0)
    assert.equal(fx.context.files.contentInfo(fileId).origin, 'note')
    assert.equal(fx.context.notes.get(fx.note.id).attachments.length, 1)
    const repeated = await fx.attach(session.uploadId)
    assert.equal(repeated.statusCode, 200, repeated.body)
    assert.deepEqual(repeated.json(), attached.json())
    const retriedComplete = await fx.request('POST', `/api/uploads/${session.uploadId}/complete`, {})
    assert.equal(retriedComplete.statusCode, 200, retriedComplete.body)
    assert.equal(retriedComplete.json().file.id, fileId)
    const other = fx.context.notes.create(ACTOR, { title: '其他笔记' })
    const reused = await fx.attach(session.uploadId, other.id)
    assert.equal(reused.statusCode, 409, reused.body)
    assert.equal(reused.json().error.code, 'attachment_upload_used')
    assert.equal(fx.context.notes.get(other.id).attachments.length, 0)
  } finally { await fx.close() }
})

test('附件接管拒绝未登录、未完成、其他用户会话与任意文件 ID', async () => {
  const fx = await fixture()
  try {
    const url = `/api/notes/${fx.note.id}/attachments/from-upload`
    const anonymous = await fx.context.app.inject({ method: 'POST', url, payload: { uploadId: 'x' } })
    assert.equal(anonymous.statusCode, 401)
    const unfinished = fx.context.uploads.init(ACTOR, { name: 'pending.txt', parentId: null, size: 1 })
    const pending = await fx.attach(unfinished.uploadId)
    assert.equal(pending.statusCode, 409, pending.body)
    assert.equal(pending.json().error.code, 'upload_not_completed')
    const foreign = await fx.upload('foreign.txt', Buffer.from('x'), { username: 'other', ip: '127.0.0.1' })
    const denied = await fx.attach(foreign.uploadId)
    assert.equal(denied.statusCode, 404, denied.body)
    assert.equal(denied.json().error.code, 'upload_not_found')
    const fileOnly = await fx.attach(foreign.file.id)
    assert.equal(fileOnly.statusCode, 404)
    const missing = await fx.request('POST', url, { fileId: foreign.file.id })
    assert.equal(missing.statusCode, 400)
    assert.equal(fx.context.notes.get(fx.note.id).attachments.length, 0)
  } finally { await fx.close() }
})

test('有分享或目录引用的上传文件不能转私有附件', async () => {
  const fx = await fixture()
  try {
    const shared = await fx.upload('shared.txt')
    const share = await fx.context.shares.create(ACTOR, shared.file.id, {})
    const denied = await fx.attach(shared.uploadId)
    assert.equal(denied.statusCode, 409, denied.body)
    assert.equal(denied.json().error.code, 'attachment_file_in_use')
    assert.equal(fx.context.files.contentInfo(shared.file.id).origin, 'user')
    const token = new URL(share.url).pathname.split('/').at(-1)!
    assert.equal(fx.context.shares.metadata(token, null).state, 'active')
    const moved = await fx.upload('moved.txt')
    const folder = fx.context.files.createFolder(ACTOR, null, '已整理')
    fx.context.files.move(ACTOR, moved.file.id, folder.id)
    const inFolder = await fx.attach(moved.uploadId)
    assert.equal(inFolder.statusCode, 409, inFolder.body)
    assert.equal(fx.context.files.contentInfo(moved.file.id).parent_id, folder.id)
    assert.equal(fx.context.notes.get(fx.note.id).attachments.length, 0)
  } finally { await fx.close() }
})

test('附件接管按 note 来源重命名并遵守大小与数量上限，失败保持 user 文件', async () => {
  const fx = await fixture({ noteAttachmentMaxBytes: 4, noteMaxAttachments: 1 })
  try {
    const first = await fx.upload('same.txt', Buffer.from('1234'))
    const added = await fx.attach(first.uploadId)
    assert.equal(added.statusCode, 200, added.body)
    const otherNote = fx.context.notes.create(ACTOR, { title: '同名附件' })
    const second = await fx.upload('same.txt', Buffer.from('ab'))
    const secondAdded = await fx.attach(second.uploadId, otherNote.id)
    assert.equal(secondAdded.statusCode, 200, secondAdded.body)
    assert.equal(secondAdded.json().items[0].name, 'same (2).txt')
    const full = await fx.upload('full.txt', Buffer.from('x'))
    const countDenied = await fx.attach(full.uploadId)
    assert.equal(countDenied.statusCode, 400, countDenied.body)
    assert.equal(countDenied.json().error.code, 'too_many_attachments')
    assert.equal(fx.context.files.contentInfo(full.file.id).origin, 'user')
    const oversized = await fx.upload('big.txt', Buffer.from('12345'))
    const sizeDenied = await fx.attach(oversized.uploadId)
    assert.equal(sizeDenied.statusCode, 413, sizeDenied.body)
    assert.equal(fx.context.files.contentInfo(oversized.file.id).origin, 'user')
    assert.equal((await fx.attach(first.uploadId)).statusCode, 200, '已达数量上限后同一附件重试仍幂等')
  } finally { await fx.close() }
})

test('附件关联写入失败回滚 origin 与重命名；并发密码分享不能引用已接管附件', async () => {
  const fx = await fixture()
  try {
    const uploaded = await fx.upload('atomic.txt')
    const before = fx.context.files.usage().usedBytes
    fx.db.exec("CREATE TRIGGER deny_note_attachment BEFORE INSERT ON note_attachments BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END")
    const failed = await fx.attach(uploaded.uploadId)
    assert.equal(failed.statusCode, 500, failed.body)
    assert.equal(fx.context.files.contentInfo(uploaded.file.id).origin, 'user')
    assert.equal(fx.context.notes.get(fx.note.id).attachments.length, 0)
    assert.equal(fx.context.files.usage().usedBytes, before)
    fx.db.exec('DROP TRIGGER deny_note_attachment')
    const share = fx.context.shares.create(ACTOR, uploaded.file.id, { password: 'fixture-password' })
    const adopted = fx.context.notes.addAttachmentFromUpload(ACTOR, fx.note.id, uploaded.uploadId)
    assert.equal(adopted.items[0]?.fileId, uploaded.file.id)
    await assert.rejects(share, (error: unknown) => (error as { code: string }).code === 'not_a_file')
    assert.equal((fx.db.prepare('SELECT COUNT(*) AS n FROM shares WHERE file_id = ?')
      .get(uploaded.file.id) as { n: number }).n, 0)
  } finally { await fx.close() }
})
