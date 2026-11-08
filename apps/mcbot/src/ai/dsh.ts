/** Minecraft Agent 本机客户端。只向固定 Unix socket 发送请求，错误只保留稳定分类。 */
import { request } from 'node:http'
import { AiError, type GenerateOptions, type GenerateResult } from './opencode.ts'
import { OpenCodeSessionError, type DshAutonomySession } from './session.ts'
import type { McpToolDefinition } from '../autonomy/tools.ts'

const MAX_BYTES = 64 * 1024

export class DshAgentClient implements DshAutonomySession {
  private readonly socketPath: string
  private readonly timeoutMs: number
  private lastResult: { id: string, text: string } | null = null

  constructor (socketPath: string, timeoutMs: number) {
    this.socketPath = socketPath
    this.timeoutMs = timeoutMs
  }

  private async invoke (
    path: string,
    payload: Record<string, unknown>,
    timeout: number,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const deadline = AbortSignal.timeout(timeout)
    try {
      return await new Promise((resolve, reject) => {
        const body = JSON.stringify(payload)
        const req = request({
          socketPath: this.socketPath,
          path,
          method: 'POST',
          signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body)
          }
        }, (res) => {
          if (res.statusCode !== 200) {
            res.resume()
            reject(new OpenCodeSessionError('http', 'DSH Agent 请求被拒绝', res.statusCode ?? null))
            return
          }
          const chunks: Buffer[] = []
          let length = 0
          res.on('data', (chunk: Buffer) => {
            length += chunk.length
            if (length > MAX_BYTES) {
              reject(new OpenCodeSessionError('invalid', 'DSH Agent 响应超限'))
              res.destroy()
            } else chunks.push(chunk)
          })
          res.on('error', reject)
          res.on('aborted', reject)
          res.on('end', () => {
            try {
              const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
              resolve(parsed as Record<string, unknown>)
            } catch {
              reject(new OpenCodeSessionError('invalid', 'DSH Agent 响应无效'))
            }
          })
        })
        req.on('error', reject)
        req.end(body)
      })
    } catch (error) {
      if (signal?.aborted) throw new OpenCodeSessionError('aborted', 'DSH Agent 请求已取消')
      if (deadline.aborted) throw new OpenCodeSessionError('timeout', 'DSH Agent 请求超时')
      if (error instanceof OpenCodeSessionError) throw error
      throw new OpenCodeSessionError('network', 'DSH Agent 不可用')
    }
  }

  async generate (prompt: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    const started = Date.now()
    try {
      const result = await this.invoke('/text', { prompt }, this.timeoutMs, options.signal)
      if (typeof result.text !== 'string' || result.text.trim() === '') throw new AiError('invalid', 'DSH 未返回文本')
      return { text: result.text, latencyMs: Date.now() - started }
    } catch (error) {
      if (error instanceof OpenCodeSessionError) throw new AiError(error.kind, error.message, error.status)
      throw error
    }
  }

  async openRun (bearer: string, tools: McpToolDefinition[]): Promise<string> {
    const result = await this.invoke('/run/start', { bearer, tools }, 10_000)
    if (typeof result.id !== 'string' || !/^session-[a-zA-Z0-9_-]{8,100}$/.test(result.id)) {
      throw new OpenCodeSessionError('invalid', 'DSH 自主会话标识无效')
    }
    return result.id
  }

  async prompt (id: string, text: string, signal?: AbortSignal): Promise<void> {
    this.lastResult = null
    await this.invoke('/run/prompt', { id, text }, this.timeoutMs, signal)
  }

  async wait (id: string, signal?: AbortSignal): Promise<void> {
    const result = await this.invoke('/run/wait', { id }, 900_000, signal)
    this.lastResult = { id, text: typeof result.text === 'string' ? result.text : '' }
  }

  async interrupt (id: string): Promise<void> {
    await this.invoke('/run/stop', { id }, 6000)
  }

  async deleteSession (id: string): Promise<void> {
    await this.interrupt(id)
    if (this.lastResult?.id === id) this.lastResult = null
  }

  async assistantText (id: string): Promise<string> {
    return this.lastResult?.id === id ? this.lastResult.text.slice(0, 1000) : ''
  }
}
