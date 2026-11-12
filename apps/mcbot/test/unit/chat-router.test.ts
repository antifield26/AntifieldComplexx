/** 游戏内自主入口的授权与严格面板控制边界；仅使用进程内假依赖。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatRouter, type ChatRouterDeps } from '../../src/chat/router.ts'
import { EventBus } from '../../src/events/bus.ts'
import { createLogger } from '../../src/logger.ts'
import { makeConfig, makeState } from '../helpers.ts'

function fixture (httpOnlyHighRisk: boolean) {
  const config = makeConfig({ httpOnlyHighRisk, autonomyEnabled: true })
  const starts: Array<{ goal: string | null, username: string }> = []
  const messages: string[] = []
  const audits: unknown[] = []
  const deps = {
    config,
    state: makeState(config),
    logger: createLogger('error'),
    events: new EventBus(100),
    chatSender: { say: async (text: string) => { messages.push(text); return [text] } },
    commands: { isAuthorized: (username: string) => username === 'Antifield' },
    intent: { shouldClassify: () => false },
    ai: { ask: () => { throw new Error('自主命令不应进入普通对话') } },
    audit: { append: (event: unknown) => { audits.push(event) } },
    autonomy: {
      enabled: true,
      isActive: () => false,
      start: async (goal: string | null, username: string) => {
        starts.push({ goal, username })
        return { ok: true }
      }
    }
  } as unknown as ChatRouterDeps
  return { router: new ChatRouter(deps), starts, messages, audits }
}

test('严格面板模式拒绝主人在游戏内启动自主会话', async () => {
  const f = fixture(true)
  for (const message of ['Lofii 开始自主', 'Lofii 自主行动 采集木头', 'Lofii 自主模式']) {
    f.router.handle({ username: 'Antifield', message })
  }
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(f.starts.length, 0)
  assert.equal(f.messages.length, 3)
  assert.ok(f.messages.every(text => text.includes('面板')))
  assert.ok(f.audits.every(event => (event as { details: { reason: string } }).details.reason === 'http_only_high_risk'))
})

test('允许游戏内控制时主人仍可启动自主会话', async () => {
  const f = fixture(false)
  f.router.handle({ username: 'Antifield', message: 'Lofii 自主行动 采集木头' })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(f.starts, [{ goal: '采集木头', username: 'Antifield' }])
  assert.equal(f.audits.length, 0)
})
