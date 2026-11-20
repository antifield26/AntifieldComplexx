/** 游戏点名和本地停止语义使用进程内夹具验证。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatRouter, type ChatRouterDeps } from '../../src/chat/router.ts'
import { createLogger } from '../../src/logger.ts'
import { makeConfig } from '../helpers.ts'

function fixture (httpOnlyHighRisk: boolean) {
  const commands: string[] = []
  const replies: string[] = []
  const approvals: string[] = []
  let stopped = 0
  const router = new ChatRouter({
    config: makeConfig({ httpOnlyHighRisk, commandAllowlist: ['Antifield'] }),
    logger: createLogger('error'),
    chatSender: { say: async (text: string) => { replies.push(text); return [text] } } as ChatRouterDeps['chatSender'],
    expedition: {
      answer: async (_user, text) => { approvals.push(text); return '确认结果' },
      teachSharedChest: () => '已记住共享箱',
      reconcile: () => '已核对物品'
    },
    submit: text => { commands.push(text); return true },
    stop: () => { stopped += 1 }
  })
  return { router, commands, replies, approvals, stopped: () => stopped }
}

test('主人点名提交自然语言，旧任务短语作为普通文本，其他玩家无法委托', () => {
  const f = fixture(false)
  f.router.handle({ username: 'other', message: 'Lofii 帮我弄 8 个铁锭' })
  f.router.handle({ username: 'Antifield', message: 'Lofii，帮我弄 8 个铁锭' })
  f.router.handle({ username: 'Antifield', message: 'Lofii 挖矿' })
  assert.deepEqual(f.commands, ['帮我弄 8 个铁锭', '挖矿'])
})

test('严格面板模式限制委托，主人仍可本地停止', () => {
  const f = fixture(true)
  f.router.handle({ username: 'Antifield', message: 'Lofii 去采矿' })
  f.router.handle({ username: 'Antifield', message: 'Lofii 停止' })
  assert.deepEqual(f.commands, [])
  assert.equal(f.stopped(), 1)
  assert.match(f.replies[0] ?? '', /管理员会话/)
})

test('只有主人能回复许可，确认号可以省略唤醒词', async () => {
  const f = fixture(false)
  f.router.handle({ username: 'other', message: '确认 123456' })
  f.router.handle({ username: 'Antifield', message: '确认 123456' })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(f.approvals, ['确认 123456'])
  assert.equal(f.commands.length, 0)
})
