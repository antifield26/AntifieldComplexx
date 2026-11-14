import assert from 'node:assert/strict'
import test from 'node:test'
import { AdminChat } from '../../src/admin/chat.ts'
import { OpenCodeSessionError } from '../../src/ai/session.ts'
import type { AutonomyService } from '../../src/autonomy/service.ts'

function fakeAutonomy(overrides: Partial<{
  ensure: () => Promise<{ ok: true, runId: string } | { ok: false, code: string }>
  prompt: () => Promise<void>
  wait: () => Promise<string>
  stop: () => Promise<void>
}> = {}) {
  const calls = { prompts: [] as string[], stops: [] as string[], ensures: 0 }
  const autonomy = {
    ensureAdmin: overrides.ensure ?? (async () => {
      calls.ensures += 1
      return { ok: true as const, runId: 'run-1' }
    }),
    promptAdmin: overrides.prompt ?? (async (text: string) => { calls.prompts.push(text) }),
    waitAdmin: overrides.wait ?? (async () => '好的，先看看周围。'),
    stopAdmin: overrides.stop ?? (async (reason: string) => { calls.stops.push(reason) })
  }
  return { autonomy: autonomy as unknown as AutonomyService, calls }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('管理员对话接受斜杠，忙时拒绝第二句，急停不经过模型', async () => {
  const { autonomy, calls } = fakeAutonomy()
  const chat = new AdminChat(autonomy)
  const first = chat.submit('去砍点木头 / 然后回家')
  assert.equal(first.ok, true)
  const busy = chat.submit('再来一句')
  assert.equal(busy.ok, false)
  if (!busy.ok) assert.equal(busy.code, 'chat_busy')
  await settle()
  const done = chat.snapshot()
  assert.equal(done.turn?.status, 'ok')
  assert.equal(done.messages[1]?.text, '好的，先看看周围。')
  assert.deepEqual(calls.prompts, ['去砍点木头 / 然后回家'])
  assert.equal(chat.submit('a\u0000b').ok, false)
  await chat.stop()
  assert.deepEqual(chat.snapshot().messages, [])
  assert.deepEqual(calls.stops, ['emergency'])
})

test('会话已关闭时重开一次再提问', async () => {
  let missing = true
  const { autonomy, calls } = fakeAutonomy({
    prompt: async () => {
      if (missing) {
        missing = false
        throw new OpenCodeSessionError('http', 'missing', 404)
      }
    }
  })
  const chat = new AdminChat(autonomy)
  assert.equal(chat.submit('继续').ok, true)
  await settle()
  assert.equal(chat.snapshot().turn?.status, 'ok')
  assert.equal(calls.ensures, 2)
  assert.deepEqual(calls.stops, ['reopen'])
})

test('重开后仍然找不到会话时记为失败', async () => {
  const { autonomy } = fakeAutonomy({
    prompt: async () => { throw new OpenCodeSessionError('http', 'missing', 404) }
  })
  const chat = new AdminChat(autonomy)
  assert.equal(chat.submit('继续').ok, true)
  await settle()
  assert.equal(chat.snapshot().turn?.status, 'error')
  assert.equal(chat.snapshot().turn?.error, 'chat_failed')
})
