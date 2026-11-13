/** 聊天发送队列回归：只使用假 Bot，验证单次失败与并发排队的结果隔离。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { ChatSender } from '../../src/minecraft/chat.ts'
import { createLogger } from '../../src/logger.ts'

test('发送失败只拒绝本条，已排队和随后提交的消息仍正常发送', async () => {
  const sent: string[] = []
  const bot = {
    entity: {},
    chat: (text: string) => {
      if (text === '失败') throw new Error('模拟断线')
      sent.push(text)
    }
  } as unknown as Bot
  const sender = new ChatSender(() => bot, createLogger('error'), { maxLineChars: 240, maxLines: 3, gapMs: 0 })
  const failed = assert.rejects(sender.say('失败'), /模拟断线/)
  const queued = sender.say('已排队')
  await failed
  assert.deepEqual(await queued, ['已排队'])
  assert.deepEqual(await sender.say('后续'), ['后续'])
  assert.deepEqual(sent, ['已排队', '后续'])
})
