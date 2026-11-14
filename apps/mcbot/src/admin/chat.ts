/**
 * 管理员对话。文本只留在本进程内存，不落库。
 * 世界动作仍走自主工具校验；急停直接关闭会话，不经过模型。
 */
import { randomUUID } from 'node:crypto'
import type { AutonomyService } from '../autonomy/service.ts'
import { OpenCodeSessionError } from '../ai/session.ts'

const MAX_MESSAGES = 40
const MAX_CHARS = 2000
const IDLE_MS = 30 * 60 * 1000

export interface AdminChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
}

export interface AdminChatTurn {
  id: string
  status: 'pending' | 'ok' | 'error'
  error: string | null
}

export type AdminChatCode = 'invalid_request' | 'chat_busy' | 'admin_unavailable' | 'admin_busy' | 'chat_failed'

export class AdminChat {
  private readonly messages: AdminChatMessage[] = []
  private turn: AdminChatTurn | null = null
  private idle: NodeJS.Timeout | null = null
  private readonly autonomy: AutonomyService

  constructor (autonomy: AutonomyService) {
    this.autonomy = autonomy
  }

  snapshot (): { messages: AdminChatMessage[], turn: AdminChatTurn | null } {
    return { messages: [...this.messages], turn: this.turn ? { ...this.turn } : null }
  }

  submit (raw: string): { ok: true, turnId: string } | { ok: false, code: AdminChatCode } {
    const message = raw.trim()
    if (message.length === 0 || message.length > MAX_CHARS || /[\u0000-\u001f\u007f]/.test(message)) {
      return { ok: false, code: 'invalid_request' }
    }
    if (this.turn?.status === 'pending') return { ok: false, code: 'chat_busy' }
    const turnId = randomUUID()
    this.turn = { id: turnId, status: 'pending', error: null }
    this.push({ id: randomUUID(), role: 'user', text: message, at: new Date().toISOString() })
    this.clearIdle()
    void this.runTurn(turnId, message)
    return { ok: true, turnId }
  }

  async stop (): Promise<void> {
    this.clearIdle()
    this.turn = null
    this.messages.length = 0
    await this.autonomy.stopAdmin('emergency')
  }

  private async runTurn (turnId: string, message: string): Promise<void> {
    try {
      const reply = await this.deliver(message, true)
      if (this.turn?.id !== turnId) return
      this.push({
        id: randomUUID(),
        role: 'assistant',
        text: reply || '没有返回内容。',
        at: new Date().toISOString()
      })
      this.turn = { id: turnId, status: 'ok', error: null }
      this.armIdle()
    } catch (error) {
      if (error instanceof OpenCodeSessionError && error.status === 409) {
        this.failTurn(turnId, 'chat_busy')
        return
      }
      const code = error instanceof Error && (error.message === 'admin_busy' || error.message === 'admin_unavailable')
        ? error.message
        : 'chat_failed'
      this.failTurn(turnId, code)
    }
  }

  /** 会话已被空闲清理时关闭本地记录并重开一次。 */
  private async deliver (message: string, allowReopen: boolean): Promise<string> {
    const opened = await this.autonomy.ensureAdmin()
    if (!opened.ok) throw new Error(opened.code === 'admin_busy' ? 'admin_busy' : 'admin_unavailable')
    try {
      await this.autonomy.promptAdmin(message)
      return (await this.autonomy.waitAdmin()).trim()
    } catch (error) {
      if (allowReopen && error instanceof OpenCodeSessionError && error.status === 404) {
        await this.autonomy.stopAdmin('reopen')
        return this.deliver(message, false)
      }
      throw error
    }
  }

  private failTurn (turnId: string, code: AdminChatCode): void {
    if (this.turn?.id !== turnId) return
    this.turn = { id: turnId, status: 'error', error: code }
  }

  private push (message: AdminChatMessage): void {
    this.messages.push(message)
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES)
  }

  private armIdle (): void {
    this.clearIdle()
    this.idle = setTimeout(() => { void this.stop() }, IDLE_MS)
    this.idle.unref?.()
  }

  private clearIdle (): void {
    if (!this.idle) return
    clearTimeout(this.idle)
    this.idle = null
  }
}
