/** 游戏内自然语言入口。仅配置的主人可以委托，停止和生成许可直接走本地执行器。 */
import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'
import type { ChatSender } from '../minecraft/chat.ts'
import type { Expedition } from '../autonomy/expedition.ts'
import { hasWakeWord, sanitizeInput, stripWakeWord, type ParsedChatMessage } from '../minecraft/chat.ts'

export interface ChatRouterDeps {
  config: Config
  logger: Logger
  chatSender: ChatSender
  expedition: Pick<Expedition, 'answer' | 'teachSharedChest' | 'reconcile'>
  submit: (text: string, reply: (text: string) => void) => boolean
  stop: () => void
}

export class ChatRouter {
  private readonly deps: ChatRouterDeps
  private replyUntil = 0

  constructor (deps: ChatRouterDeps) {
    this.deps = deps
  }

  handle (message: ParsedChatMessage): void {
    if (message.username.toLowerCase() !== this.deps.config.commandAllowlist[0]?.toLowerCase()) return
    const text = sanitizeInput(message.message, this.deps.config.chatMaxInputChars)
    const named = hasWakeWord(text)
    const input = named ? stripWakeWord(text).replace(/^[，,：:\s]+/u, '').trim() : text
    const answer = /^(?:确认|同意|拒绝|取消)\s*\d{6}[。！!]?$/u.test(input)
    if (!input || (!named && !answer && Date.now() >= this.replyUntil)) return
    if (/^(?:停止|停下|急停|别动了|停止当前任务)[。！!]?$/u.test(input)) {
      this.replyUntil = 0
      this.deps.stop()
      this.say('已发出停止指令。')
      return
    }
    if (this.deps.config.httpOnlyHighRisk) {
      if (named) this.say('请使用客户端管理员会话交代任务。')
      return
    }
    if (!named && !answer && !/^(?:我指的是|交给|放到|数量是|就在|是|不是|对|不对)(?:\s|，|。|$)/u.test(input)) return
    if (!named) this.replyUntil = 0
    void this.route(message.username, input, answer).catch(() => {
      this.deps.logger.warn('主人指令处理失败')
      this.say('这次没有处理成功。')
    })
  }

  private async route (owner: string, text: string, answer: boolean): Promise<void> {
    if (answer) {
      const result = await this.deps.expedition.answer(owner, text)
      if (result) this.say(result)
      if (result?.endsWith('已在我背包。')) {
        this.deps.submit('我刚确认了生成许可。请核对背包并继续上一个任务。', reply => this.say(reply))
      }
      return
    }
    if (/^(?:记住|把).*(?:这个|面前|旁边).*(?:箱|木桶).*(?:共享|公用)/u.test(text)) {
      this.say(this.deps.expedition.teachSharedChest(owner))
      return
    }
    if (/^(?:我已核对|已经核对)物品[。！!]?$/u.test(text)) {
      this.say(this.deps.expedition.reconcile(owner))
      return
    }
    const accepted = this.deps.submit(text, reply => {
      if (/[?？]$/u.test(reply.trim())) this.replyUntil = Date.now() + 30_000
      this.say(reply)
    })
    if (!accepted) this.say('我还在处理上一句话。')
  }

  private say (text: string): void {
    void this.deps.chatSender.say(text, 'companion').catch(() => undefined)
  }
}
