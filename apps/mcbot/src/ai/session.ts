/**
 * 自主会话与管理员对话的客户端边界。
 * 生产只走 DSH Unix socket。没有 DSH_AGENT_SOCKET 时这两条不可用，不回退 OpenCode。
 * 错误只保留稳定分类，不返回上游正文、Token 或提示词。
 */
import type { McpToolDefinition } from '../autonomy/tools.ts'
import type { SessionStep } from './steps.ts'

export type SessionErrorKind = 'http' | 'network' | 'timeout' | 'invalid' | 'aborted'

export class OpenCodeSessionError extends Error {
  readonly kind: SessionErrorKind
  readonly status: number | null

  constructor (kind: SessionErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'OpenCodeSessionError'
    this.kind = kind
    this.status = status
  }
}

export interface SessionPermission {
  action: string
  resource: string
  effect: 'allow' | 'deny'
}

export interface AutonomySessionClient {
  registerMcp: (name: string, url: string, bearer: string) => Promise<void>
  removeMcp: (name: string) => Promise<void>
  createSession: (title: string, permissions: SessionPermission[]) => Promise<string>
  prompt: (sessionId: string, text: string, signal?: AbortSignal) => Promise<void>
  wait: (sessionId: string, signal?: AbortSignal) => Promise<void>
  interrupt: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  assistantText: (sessionId: string) => Promise<string>
}

export interface DshAutonomySession extends Pick<AutonomySessionClient, 'prompt' | 'wait' | 'interrupt' | 'deleteSession' | 'assistantText'> {
  openRun: (bearer: string, tools: McpToolDefinition[]) => Promise<string>
}

/** 管理员对话会话。与无工具的陪伴回复、游戏内自主槽分开。 */
export interface DshAdminSession {
  openAdmin: (bearer: string, tools: McpToolDefinition[], prompt: string) => Promise<string>
  promptAdmin: (id: string, text: string, signal?: AbortSignal) => Promise<void>
  waitAdmin: (id: string, signal?: AbortSignal) => Promise<{ text: string, steps: SessionStep[] }>
  stopAdmin: (id: string) => Promise<void>
}
