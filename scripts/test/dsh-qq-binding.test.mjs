/** 验证 QQ 设置席位和独立网关的绑定状态机，全部使用本地替身。 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import { URL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBinding, QqBindingManager } from '../../deploy/dsh/qq-binding.mjs'
import { managementUrl } from '../../deploy/dsh/plugins/qq/index.mjs'

const old = { appId: 'old-app', appSecret: 'fixture-old', direct: ['direct-old'], groups: ['group-old'] }

test('DSH 注册一个独立的 QQ 机器人设置分页，并清理旧注册', () => {
  const code = readFileSync(new URL('../../deploy/dsh/plugins/qq/client.js', import.meta.url), 'utf8')
  let plugin
  runInNewContext(code, { window: { __ModuleLoader__: { load: (loader) => {
    assert.equal(loader.id, '@antifield/dsh-qq-plugin')
    plugin = loader.factory(() => ({}))
  } } } })
  let registered
  let cleaned = false
  let dispose
  plugin.apply({
    slots: {
      inject: (section, callback) => { assert.equal(section, 'settings.section'); return callback() },
      register: (settings) => { registered = settings; return () => { cleaned = true } },
    },
    effect: (callback) => { dispose = callback() },
  })
  assert.equal(registered.label, 'QQ 机器人')
  dispose()
  assert.equal(cleaned, true)
  assert.equal(managementUrl('https://app.example.test/'), 'https://app.example.test/settings/qq-robot')
  for (const origin of ['https://a.example.test/elsewhere', 'https://x@a.example.test/', 'http://a.example.test/']) {
    assert.equal(managementUrl(origin), null)
  }
})

function fixture(options = {}) {
  const received = []
  const saved = []
  const scans = []
  const manager = new QqBindingManager({
    binding: old, readiness: () => true, onChange: () => {},
    persist: (binding) => saved.push(binding),
    scan: (callback) => { scans.push(callback); return () => {} },
    switchGateway: async (binding) => { received.push(binding); await options.switchGateway?.(binding) },
    now: options.now,
  })
  return { manager, received, saved, scans }
}

test('换号需要新名单，旧会话和重复确认不能切换网关', async () => {
  const { manager, received, saved } = fixture()
  try {
    const start = await manager.execute({ action: 'start', owner: 'owner1', kind: 'manual', appId: 'next-app', appSecret: 'fixture-next' })
    assert.equal(start.operation.needsAllowlist, true)
    assert.doesNotMatch(JSON.stringify(start), /fixture-next/)
    const id = start.operation.id
    assert.equal((await manager.execute({ action: 'confirm', owner: 'owner2', id })).error, 'binding_expired')
    assert.equal((await manager.execute({ action: 'confirm', owner: 'owner1', id })).error, 'invalid_allowlist')
    await manager.execute({ action: 'confirm', owner: 'owner1', id, direct: ['next-direct'], groups: ['next-group'] })
    await setImmediate()
    assert.equal(received.length, 1)
    assert.deepEqual(saved[0].groups, ['next-group'])
    assert.equal((await manager.execute({ action: 'confirm', owner: 'owner1', id })).error, 'invalid_request')
  } finally { manager.close() }
})

test('网关启动失败恢复上次绑定，解绑持久化空绑定', async () => {
  const { manager, received, saved } = fixture({
    switchGateway(binding) { if (binding?.appSecret === 'fixture-bad') throw new Error() },
  })
  try {
    const owner = 'owner1'
    const start = await manager.execute({ action: 'start', owner, kind: 'manual', appId: old.appId, appSecret: 'fixture-bad' })
    assert.equal(start.operation.needsAllowlist, false)
    await manager.execute({ action: 'confirm', owner, id: start.operation.id })
    await setImmediate()
    assert.deepEqual(received[0].direct, old.direct)
    assert.deepEqual(received[1], old)
    assert.equal(saved.length, 0)
    assert.equal(manager.view(owner).operation.error, 'binding_switch_failed')
    const unbind = await manager.execute({ action: 'start', owner, kind: 'unbind' })
    await manager.execute({ action: 'confirm', owner, id: unbind.operation.id })
    await setImmediate()
    assert.equal(parseBinding({ version: 1, binding: saved[0] }), null)
    assert.equal(manager.view(owner).phase, 'unbound')
  } finally { manager.close() }
})

test('扫码取消、刷新、到期后收到旧回调时不会提交', async () => {
  let time = 1000
  const { manager, scans, saved } = fixture({ now: () => time })
  try {
    const owner = 'owner1'
    const first = await manager.execute({ action: 'start', owner, kind: 'qr' })
    await manager.execute({ action: 'refresh', owner, id: first.operation.id })
    scans[0]({ appId: 'lagged', appSecret: 'fixture-lagged' })
    assert.equal(manager.view(owner).operation.phase, 'waiting')
    await manager.execute({ action: 'cancel', owner, id: first.operation.id })
    scans[1]({ appId: 'cancelled', appSecret: 'fixture-cancelled' })
    assert.equal(manager.view(owner).operation, null)
    const last = await manager.execute({ action: 'start', owner, kind: 'qr' })
    time += 300001
    scans[2]({ appId: 'expired', appSecret: 'fixture-expired' })
    assert.equal((await manager.execute({ action: 'confirm', owner, id: last.operation.id })).error, 'binding_expired')
    assert.deepEqual(saved, [])
  } finally { manager.close() }
})
