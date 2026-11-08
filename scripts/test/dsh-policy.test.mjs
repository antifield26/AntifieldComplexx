/** 使用本地夹具验证 QQ 作用域、迁移幂等和 Minecraft 工具权限。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../../apps/workbench/server/src/db.ts'
import { buildToolDefinitions } from '../../apps/mcbot/src/autonomy/tools.ts'
import { registerMcbotTools, validateBinding } from '../../deploy/dsh/dsh-mcbot.mjs'
import { QqMemory, qqScope } from '../../deploy/dsh/qq-memory.mjs'
import { allowQqCommand, inputScope, openQqImage, qqImageUrl, sessionPeer } from '../../deploy/dsh/qq-policy.mjs'

test('QQ 群拒绝斜杠命令并隔离会话和图片作用域', async () => {
  assert.equal(allowQqCommand('group', '  ／reset'), false)
  assert.equal(allowQqCommand('group', '你好'), true)
  assert.equal(allowQqCommand('c2c', '/forget confirm'), true)
  assert.equal(allowQqCommand('c2c', '/model switch'), false)
  assert.equal(inputScope('appid', { kind: 'group', senderId: 'member' }), null)
  const first = inputScope('appid', { kind: 'group', groupOpenid: 'group', senderId: 'first' })
  const second = inputScope('appid', { kind: 'group', groupOpenid: 'group', senderId: 'second' })
  assert.notEqual(sessionPeer(first), sessionPeer(second))
  assert.throws(() => qqImageUrl('https://127.0.0.1/private'))
  assert.throws(() => qqImageUrl('https://qq.com.example.test/file'))
  assert.throws(() => qqImageUrl('https://user:password@gchat.qpic.cn/file'))
  await assert.rejects(openQqImage({}, '/etc/passwd', 100))
})

test('QQ 只导入可验证归属的角色和记忆，清除使当前候选失效', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qq-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sourcePath = join(dir, 'schema20.sqlite')
  const source = openDatabase({ path: sourcePath })
  try {
    source.exec(`
      INSERT INTO chatbots (id, platform, name, config_json, secret_ciphertext, secret_iv, secret_tag, created_at, updated_at)
      VALUES ('bot', 'qq', 'fixture', '{"appId":"appid"}', '', '', '', 'now', 'now');
      INSERT INTO chatbot_inbound_targets (chatbot_id, target_external_id, target_kind, user_id, last_seen_at)
      VALUES ('bot','first','user','first','now'), ('bot','room','group','first','now'), ('bot','room','group','second','now');
      INSERT INTO chatbot_chat_roles (chatbot_id, user_id, name, prompt, created_at, updated_at)
      VALUES ('bot','first','助手','私聊角色','now','now'), ('bot','unknown','助手','来源不明','now','now');
    `)
  } finally {
    source.close()
  }
  const store = new QqMemory(join(dir, 'qq.sqlite'))
  try {
    assert.deepEqual(store.importWorkbench(sourcePath, 'appid'), { roles: 1, memory: 0, settings: 0, skipped: 1 })
    assert.deepEqual(store.importWorkbench(sourcePath, 'appid'), { alreadyImported: true })
    const direct = qqScope('appid', 'c2c', 'first', 'first')
    const group = qqScope('appid', 'group', 'room', 'first')
    const other = qqScope('appid', 'group', 'room', 'second')
    assert.equal(store.context(direct).role.name, '助手')
    assert.equal(store.context(group).role, null)
    const item = { category: 'preference', key: 'topic', value: '村庄', op: 'upsert' }
    const approved = store.propose(group, item)
    assert.equal(store.context(group).memory.length, 0)
    assert.equal(store.review(approved, true), true)
    assert.equal(store.context(group).memory[0].value, '村庄')
    assert.equal(store.context(other).memory.length, 0)
    const pending = store.propose(direct, item)
    assert.equal(store.forget(direct), 1)
    assert.equal(store.review(pending, true), false)
    assert.equal(store.context(group).memory.length, 1)
  } finally {
    store.db.close()
  }
})

test('dsh-mcbot 仅注册原有 13 个工具并拒绝重放到另一个会话', async () => {
  const binding = validateBinding({
    socketPath: join(tmpdir(), 'dsh-tool-test.sock'),
    sessionId: 'session-test1234', bearer: 'example-binding-credential-12345',
    tools: buildToolDefinitions(),
  })
  const definitions = new Map()
  let guard
  registerMcbotTools({
    register: (definition, options) => definitions.set(definition.name, { definition, options }),
    guard: (handler) => { guard = handler },
  }, binding, (_binding, name) => name)
  assert.equal(definitions.size, 13)
  const name = 'mcbot_autonomy_observe'
  const { definition, options } = definitions.get(name)
  const agent = { session: { id: binding.sessionId } }
  const old = { session: { id: 'session-old1234' } }
  assert.equal(options.when({ agent }), true)
  assert.equal(options.when({ agent: old }), false)
  assert.equal(guard({ name, agent }), undefined)
  assert.equal(typeof guard({ name: 'shell', agent }), 'string')
  await assert.rejects(definition.execute({}, { agent: old }))
  assert.equal(await definition.execute({}, { agent }), 'observe')
})
