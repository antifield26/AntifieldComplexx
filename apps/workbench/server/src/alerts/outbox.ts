/**
 * 告警投递箱。主机告警与外部事件共用同一张表，Webhook 与 QQ 分通道重试。
 * 仅保存事件引用、幂等标识和脱敏错误；不保存通道凭据。
 * 同一主机条件（firing/resolved/unknown）按通道串行；外部事件保持并行。
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

export interface InsertPlan {
  webhook: 'pending' | 'skipped'
  qq: 'pending' | 'skipped'
  webhookError?: string | null
  qqError?: string | null
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
  private claiming = true
  private readonly active = new Map<number, Promise<void>>()
  private readonly db: DatabaseSync
  private readonly options: Options

  constructor(db: DatabaseSync, options: Options) {
    this.db = db
    this.options = options
  }

  /** 与事件同一事务写入两条通道。关闭的通道直接记为 skipped，不进入领取。 */
  insert(eventId: number, plan: InsertPlan = { webhook: 'pending', qq: 'pending' }): void {
    const insert = this.db.prepare(
      `INSERT INTO external_alert_deliveries
       (event_id, channel, delivery_key, status, attempts, next_attempt_at, last_error)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    const now = this.options.now().toISOString()
    insert.run(eventId, 'webhook', randomUUID(), plan.webhook, now, plan.webhook === 'skipped' ? (plan.webhookError ?? null) : null)
    insert.run(eventId, 'qq', randomUUID(), plan.qq, now, plan.qq === 'skipped' ? (plan.qqError ?? null) : null)
  }

  start(): void {
    this.claiming = true
    this.controller = new AbortController()
    if (this.timer) return
    this.timer = setInterval(() => this.wake(), 1000)
    this.timer.unref()
    this.wake()
  }

  wake(): void {
    if (!this.timer || this.wakeScheduled || !this.claiming) return
    this.wakeScheduled = true
    queueMicrotask(() => {
      this.wakeScheduled = false
      void this.process().catch(this.options.warn)
    })
  }

  /** 先停止领取并中止在途请求，再等待已开始的发送结束。未完成的行保持 pending。 */
  async stop(): Promise<void> {
    this.claiming = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.controller.abort()
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active.values()])
    }
  }

  async process(): Promise<void> {
    if (!this.claiming || this.controller.signal.aborted) return
    this.drainQq()
    await this.drainWebhooks()
  }

  /** QQ 入队是同步的，同一轮在遇到第一个 await 之前处理完当前到期任务。 */
  private drainQq(): void {
    const seen = new Set<number>()
    const signal = this.controller.signal
    for (;;) {
      if (!this.claiming || signal.aborted) return
      const jobs = this.due('qq', 20).filter((job) => !seen.has(job.event_id))
      if (jobs.length === 0) return
      for (const job of jobs) {
        if (!this.claiming || signal.aborted) return
        seen.add(job.event_id)
        try {
          transaction(this.db, () => {
            this.options.notify(job.event_id)
            this.finish(job, 'done', null)
          })
        } catch (error) {
          this.fail(job, error)
        }
      }
    }
  }

  /** Webhook 最多两条在途。本批结束后再领取下一批，失败行的下次时间在未来，不会紧循环重试。 */
  private async drainWebhooks(): Promise<void> {
    const signal = this.controller.signal
    for (;;) {
      if (!this.claiming || signal.aborted) return
      const started: Promise<void>[] = []
      for (const job of this.due('webhook', 2)) {
        if (this.active.size >= 2) break
        if (this.active.has(job.event_id)) continue
        const work = this.send(job, signal).finally(() => this.active.delete(job.event_id))
        this.active.set(job.event_id, work)
        started.push(work)
      }
      if (started.length === 0) return
      await Promise.all(started)
    }
  }

  private due(channel: 'webhook' | 'qq', limit: number): Job[] {
    return this.db.prepare(
      `SELECT d.event_id, d.channel, d.delivery_key, d.attempts
       FROM external_alert_deliveries d
       JOIN alert_events e ON e.id = d.event_id
       WHERE d.channel = ? AND d.status = 'pending' AND d.next_attempt_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM external_alert_deliveries earlier
           JOIN alert_events earlier_event ON earlier_event.id = earlier.event_id
           WHERE earlier.channel = d.channel AND earlier.status = 'pending'
             AND earlier.event_id < d.event_id AND earlier_event.event = e.event
             AND earlier_event.status IN ('firing', 'resolved', 'unknown')
             AND e.status IN ('firing', 'resolved', 'unknown')
         )
       ORDER BY d.next_attempt_at, d.event_id LIMIT ?`,
    ).all(channel, this.options.now().toISOString(), limit) as unknown as Job[]
  }

  private async send(job: Job, signal: AbortSignal): Promise<void> {
    try {
      const sent = await this.options.webhook(job.event_id, job.delivery_key, signal)
      if (signal.aborted || !this.claiming) return
      transaction(this.db, () => {
        this.finish(job, sent ? 'done' : 'skipped', null)
        this.options.webhookResult(job.event_id, sent ? this.options.now().toISOString() : null, sent ? null : '未配置 webhook URL')
      })
    } catch (error) {
      if (!signal.aborted && this.claiming) this.fail(job, error)
    }
  }

  private finish(job: Job, status: 'done' | 'dead' | 'skipped', error: string | null): void {
    this.db.prepare(
      'UPDATE external_alert_deliveries SET status = ?, attempts = attempts + 1, last_error = ? WHERE event_id = ? AND channel = ?',
    ).run(status, error, job.event_id, job.channel)
  }

  private fail(job: Job, error: unknown): void {
    const message = this.options.errorText(error)
    const attempts = job.attempts + 1
    if (attempts < 3) {
      const next = new Date(this.options.now().getTime() + attempts * 1000).toISOString()
      this.db.prepare(
        'UPDATE external_alert_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE event_id = ? AND channel = ?',
      ).run(attempts, next, message, job.event_id, job.channel)
      return
    }
    transaction(this.db, () => {
      this.finish(job, 'dead', message)
      if (job.channel === 'webhook') this.options.webhookResult(job.event_id, null, message)
    })
    this.options.warn(new Error(`外部告警 ${job.event_id} ${job.channel} 投递失败：${message}`))
  }
}
