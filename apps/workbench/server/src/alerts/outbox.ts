/**
 * 外部告警投递箱。事件与任务一起入库，工作进程按通道重试。
 * 仅保存事件引用、幂等标识和脱敏错误；不保存通道凭据。
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../db.ts'

interface Job {
  event_id: number
  channel: 'webhook' | 'qq'
  delivery_key: string
  attempts: number
}

interface Options {
  now: () => Date
  webhook: (id: number, key: string, signal: AbortSignal) => Promise<boolean>
  notify: (id: number) => void
  webhookResult: (id: number, at: string | null, error: string | null) => void
  errorText: (error: unknown) => string
  warn: (error: unknown) => void
}

export class ExternalAlertOutbox {
  private timer: NodeJS.Timeout | null = null
  private controller = new AbortController()
  private wakeScheduled = false
  private readonly active = new Map<number, Promise<void>>()
  private readonly db: DatabaseSync
  private readonly options: Options

  constructor(db: DatabaseSync, options: Options) {
    this.db = db
    this.options = options
  }

  insert(eventId: number): void {
    const insert = this.db.prepare(
      "INSERT INTO external_alert_deliveries (event_id, channel, delivery_key, status, next_attempt_at) VALUES (?, ?, ?, 'pending', ?)",
    )
    const now = this.options.now().toISOString()
    insert.run(eventId, 'webhook', randomUUID(), now)
    insert.run(eventId, 'qq', randomUUID(), now)
  }

  start(): void {
    if (this.timer) return
    this.controller = new AbortController()
    this.timer = setInterval(() => this.wake(), 1000)
    this.timer.unref()
    this.wake()
  }

  wake(): void {
    if (!this.timer || this.wakeScheduled) return
    this.wakeScheduled = true
    queueMicrotask(() => {
      this.wakeScheduled = false
      void this.process().catch(this.options.warn)
    })
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.controller.abort()
    await Promise.allSettled(this.active.values())
  }

  async process(): Promise<void> {
    const signal = this.controller.signal
    if (signal.aborted) return
    const due = this.db.prepare(
      "SELECT * FROM external_alert_deliveries WHERE channel = ? AND status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, event_id LIMIT ?",
    )
    const now = this.options.now().toISOString()
    for (const job of due.all('qq', now, 20) as unknown as Job[]) {
      try {
        transaction(this.db, () => {
          this.options.notify(job.event_id)
          this.finish(job, 'done', null)
        })
      } catch (error) {
        this.fail(job, error)
      }
    }
    for (const job of due.all('webhook', now, 2) as unknown as Job[]) {
      if (this.active.size >= 2) break
      if (this.active.has(job.event_id)) continue
      const work = this.send(job, signal).finally(() => this.active.delete(job.event_id))
      this.active.set(job.event_id, work)
    }
    await Promise.all(this.active.values())
  }

  private async send(job: Job, signal: AbortSignal): Promise<void> {
    try {
      const sent = await this.options.webhook(job.event_id, job.delivery_key, signal)
      if (signal.aborted) return
      transaction(this.db, () => {
        this.finish(job, sent ? 'done' : 'skipped', null)
        this.options.webhookResult(job.event_id, sent ? this.options.now().toISOString() : null, sent ? null : '未配置 webhook URL')
      })
    } catch (error) {
      if (!signal.aborted) this.fail(job, error)
    }
  }

  private finish(job: Job, status: 'done' | 'dead' | 'skipped', error: string | null): void {
    this.db.prepare('UPDATE external_alert_deliveries SET status = ?, attempts = attempts + 1, last_error = ? WHERE event_id = ? AND channel = ?')
      .run(status, error, job.event_id, job.channel)
  }

  private fail(job: Job, error: unknown): void {
    const message = this.options.errorText(error)
    const attempts = job.attempts + 1
    if (attempts < 3) {
      const next = new Date(this.options.now().getTime() + attempts * 1000).toISOString()
      this.db.prepare('UPDATE external_alert_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE event_id = ? AND channel = ?')
        .run(attempts, next, message, job.event_id, job.channel)
      return
    }
    transaction(this.db, () => {
      this.finish(job, 'dead', message)
      if (job.channel === 'webhook') this.options.webhookResult(job.event_id, null, message)
    })
    this.options.warn(new Error(`外部告警 ${job.event_id} ${job.channel} 投递失败：${message}`))
  }
}
