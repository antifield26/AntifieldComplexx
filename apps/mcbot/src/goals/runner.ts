/**
 * 串行推进目标，每次执行独占动作，暂停和取消先撤销执行权再等待动作收口。
 */
import { randomUUID } from 'node:crypto'
import type { AuditLogger } from '../audit.ts'
import type { Logger } from '../logger.ts'
import type { MovementManager } from '../minecraft/movement.ts'
import type { TaskName } from '../state.ts'
import type { TaskManager } from '../tasks/manager.ts'
import { GoalStore, type Goal, type GoalFailureKind, type GoalStepInput } from './store.ts'

interface Blocker {
  kind: GoalFailureKind
  message: string
}

export interface GoalRunnerDeps {
  logger: Logger
  tasks: Pick<TaskManager, 'isGoalBlocked' | 'runGoalTask' | 'depositForGoal'>
  movement: Pick<MovementManager, 'isBusy' | 'home' | 'atHome' | 'stop'>
  occupied?: () => boolean
  blocker: () => Blocker | null
  audit: AuditLogger
  store: GoalStore
}

interface Execution {
  id: string
  goalId: string
  controller: AbortController
  done: Promise<void>
  autoResumed: boolean
}

function classify (message: string): GoalFailureKind {
  if (/断线|disconnect|not connected|中断|已停止/i.test(message)) return 'interrupted'
  if (/补给|工具|种子|箱|产出|supply|tool|chest|库存/i.test(message)) return 'supplies'
  if (/低血|饥饿|威胁|危险|health|retreat/i.test(message)) return 'survival'
  if (/no.?path|走不过去|无法抵达|unreachable|navigation|楔|卡住|未抵达/i.test(message)) return 'path'
  return 'unknown'
}

export class GoalRunner {
  private run: Execution | null = null
  private closing = false
  private survivalTimer: NodeJS.Timeout | null = null
  private survivalGoal: string | null = null
  private readonly deps: GoalRunnerDeps

  constructor (deps: GoalRunnerDeps) {
    this.deps = deps
  }

  list (limit = 20): Goal[] {
    return this.deps.store.list(limit)
  }

  get (id: string): Goal | null {
    return this.deps.store.get(id)
  }

  isBusy (): boolean {
    return this.run !== null
  }

  create (owner: string, objective: string, steps: GoalStepInput[]): Goal {
    const goal = this.deps.store.create(owner, objective, steps)
    this.record(goal.id, owner, 'create')
    return goal
  }

  async start (id: string, by = 'panel'): Promise<Goal> {
    return this.begin(id, by, false)
  }

  private begin (id: string, by: string, autoResumed: boolean): Goal {
    const goal = this.requireGoal(id)
    if (goal.status !== 'pending' && goal.status !== 'paused') throw new Error('goal_not_startable')
    if (this.closing || this.isBusy() || this.actionOccupied()) throw new Error('goal_busy')
    this.clearSurvival()
    this.deps.store.update(id, {
      status: 'running',
      startedAt: goal.startedAt ?? new Date().toISOString(),
      finishedAt: null,
      lastError: null,
      lastFailureKind: null
    })
    const execution = {
      id: randomUUID(), goalId: id, controller: new AbortController(), autoResumed, done: Promise.resolve()
    }
    this.run = execution
    this.record(id, by, 'start')
    execution.done = Promise.resolve().then(async () => {
      const timer = setInterval(() => {
        if (execution.controller.signal.aborted) return
        const blocked = this.deps.blocker()
        if (blocked) {
          try {
            this.interrupt(blocked.message, blocked.kind)
          } catch (error) {
            this.deps.logger.error('目标暂停状态写入失败', { error: error instanceof Error ? error.message : String(error) })
          }
        }
      }, 500)
      timer.unref()
      try {
        await this.execute(execution)
      } catch (error) {
        this.deps.logger.error('目标执行异常', { error: error instanceof Error ? error.message : String(error) })
        if (!execution.controller.signal.aborted) {
          this.interrupt('目标状态写入失败，请检查后恢复', 'unknown')
        }
      } finally {
        clearInterval(timer)
        this.run = null
      }
    }).catch(error => {
      this.deps.logger.error('目标收尾异常', { error: error instanceof Error ? error.message : String(error) })
    })
    return this.requireGoal(id)
  }

  async pause (id: string, by = 'panel'): Promise<Goal> {
    const goal = this.requireGoal(id)
    if (goal.status !== 'running' && this.survivalGoal !== id) throw new Error('goal_not_running')
    if (this.survivalGoal === id) this.clearSurvival()
    if (goal.status === 'running') this.halt(goal, 'paused', { kind: 'interrupted', message: '主人已暂停目标' })
    this.record(id, by, 'pause')
    return this.requireGoal(id)
  }

  async cancel (id: string, by = 'panel'): Promise<Goal> {
    const goal = this.requireGoal(id)
    if (goal.status === 'completed') throw new Error('goal_not_startable')
    if (this.survivalGoal === id) this.clearSurvival()
    if (goal.status !== 'canceled') {
      this.halt(goal, 'canceled', null)
      this.record(id, by, 'cancel')
    }
    return this.requireGoal(id)
  }

  interrupt (message: string, kind: GoalFailureKind = 'interrupted'): boolean {
    if (kind === 'interrupted') this.clearSurvival()
    const execution = this.run
    if (!execution) return false
    if (execution.controller.signal.aborted) return true
    const goal = this.requireGoal(execution.goalId)
    if (goal.status !== 'running') return true
    this.halt(goal, 'paused', { kind, message })
    if (kind === 'survival' && !execution.autoResumed) this.scheduleSurvival(execution.goalId)
    return true
  }

  async stop (): Promise<void> {
    this.closing = true
    this.interrupt('服务停止，需主人恢复')
    await this.run?.done
  }

  private halt (goal: Goal, status: 'paused' | 'canceled', reason: Blocker | null): void {
    if (this.run?.goalId === goal.id && !this.run.controller.signal.aborted) {
      this.run.controller.abort()
      this.deps.movement.stop('goal')
    }
    const now = new Date().toISOString()
    this.deps.store.atomic(() => {
      for (const step of goal.steps) {
        if (step.status === 'completed' || step.status === 'skipped') continue
        if (status === 'canceled') {
          this.deps.store.updateStep(goal.id, step.index, { status: 'skipped', finishedAt: now })
        } else if (step.status === 'running') {
          this.deps.store.updateStep(goal.id, step.index, { status: 'pending', lastError: reason?.message ?? null })
        }
      }
      this.deps.store.update(goal.id, {
        status,
        finishedAt: status === 'canceled' ? now : null,
        lastError: reason?.message ?? null,
        lastFailureKind: reason?.kind ?? null
      })
    })
  }

  private async execute (execution: Execution): Promise<void> {
    const { goalId: id, controller: { signal } } = execution
    let retriedStep: number | null = null
    while (!signal.aborted) {
      const goal = this.requireGoal(id)
      const step = goal.steps[goal.currentStep]
      if (!step) return
      const blocker = this.deps.blocker()
      if (blocker) {
        this.interrupt(blocker.message, blocker.kind)
        return
      }
      if (this.actionOccupied()) {
        this.interrupt('Bot 正在处理其他动作')
        return
      }
      this.deps.store.updateStep(id, step.index, {
        status: 'running', startedAt: new Date().toISOString(), finishedAt: null, lastError: null
      })
      try {
        if (step.kind === 'task') {
          const result = await this.deps.tasks.runGoalTask(step.taskName as TaskName, execution.id, signal)
          if (signal.aborted) return
          if (result.executionId !== execution.id) throw new Error('任务结果与当前执行不匹配')
          if (result.error) throw new Error(result.error)
          if (result.produced === 0) throw new Error('采集没有产出，请检查资源和工具后继续')
        } else if (step.kind === 'deposit') {
          const deposited = await this.deps.tasks.depositForGoal(signal)
          if (!signal.aborted) this.deps.logger.info(deposited > 0 ? '目标存箱完成' : '背包无可存物', { deposited })
        } else {
          await this.deps.movement.home()
          if (!signal.aborted && !this.deps.movement.atHome()) throw new Error('未抵达基地')
        }
      } catch (error) {
        if (signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        const blocked = this.deps.blocker()
        const kind = blocked?.kind ?? classify(message)
        const retry = kind === 'path' && retriedStep !== step.index
        const attempts = step.attempts + 1
        this.deps.store.atomic(() => {
          this.deps.store.updateStep(id, step.index, {
            status: retry ? 'pending' : 'failed', attempts, lastError: message, finishedAt: new Date().toISOString()
          })
          this.deps.store.update(id, {
            status: retry ? 'running' : 'paused', attempts: goal.attempts + 1,
            lastError: blocked?.message ?? message, lastFailureKind: kind
          })
        })
        if (retry) {
          retriedStep = step.index
          continue
        }
        this.record(id, goal.owner, 'failure', 'failed')
        if (kind === 'survival' && !execution.autoResumed) this.scheduleSurvival(id)
        return
      }
      if (signal.aborted) return
      const completed = step.index + 1 === goal.steps.length
      const now = new Date().toISOString()
      this.deps.store.atomic(() => {
        this.deps.store.updateStep(id, step.index, { status: 'completed', finishedAt: now })
        this.deps.store.update(id, {
          status: completed ? 'completed' : 'running', currentStep: step.index + 1,
          finishedAt: completed ? now : null, lastError: null, lastFailureKind: null
        })
      })
      if (completed) {
        this.record(id, goal.owner, 'finish', 'completed')
        return
      }
    }
  }

  private scheduleSurvival (id: string): void {
    this.clearSurvival()
    this.survivalGoal = id
    const deadline = Date.now() + 30_000
    this.survivalTimer = setInterval(() => {
      if (Date.now() >= deadline || this.get(id)?.status !== 'paused') {
        this.clearSurvival()
        return
      }
      if (this.isBusy() || this.deps.blocker() || this.actionOccupied()) return
      try {
        this.begin(id, 'survival_auto', true)
      } catch (error) {
        this.deps.logger.warn('目标自动恢复失败', { error: error instanceof Error ? error.message : String(error) })
        this.clearSurvival()
      }
    }, 1_000)
    this.survivalTimer.unref()
  }

  private actionOccupied (): boolean {
    return Boolean(this.deps.occupied?.() || this.deps.tasks.isGoalBlocked() || this.deps.movement.isBusy())
  }

  private clearSurvival (): void {
    if (this.survivalTimer) clearInterval(this.survivalTimer)
    this.survivalTimer = null
    this.survivalGoal = null
  }

  private record (id: string, actor: string, action: string, result: 'accepted' | 'failed' | 'completed' = 'accepted'): void {
    this.deps.audit.append({
      event: `goal.${action}`, source: 'task', actor: actor.slice(0, 64), action, result,
      details: { goal: id.slice(0, 8) }
    })
  }

  private requireGoal (id: string): Goal {
    const goal = this.deps.store.get(id)
    if (!goal) throw new Error('goal_not_found')
    return goal
  }
}
