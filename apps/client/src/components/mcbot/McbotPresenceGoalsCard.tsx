/** 在线模式与多步目标：突出动作结果、阻塞与下一步，所有写操作保留控制检查和二次确认。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Moon, Play, Square, Target } from 'lucide-react'
import { api, isAbortError, isApiError, toErrorMessage } from '../../api/client'
import type {
  McbotGoal,
  McbotGoalKind,
  McbotPresenceInfo,
  McbotPresenceMode,
  McbotTaskName,
} from '../../api/types'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { EmptyState } from '../EmptyState'
import { InlineError } from '../InlineError'
import { RelativeTime } from '../RelativeTime'
import { ProgressBar } from '../ProgressBar'
import { useToast } from '../Toast'
import { mcbotTaskNameLabel } from '../../lib/mcbot'
import { usePolling } from '../../hooks/usePolling'
import { McbotGoalDraftEditor } from './McbotGoalDraftEditor'

const PRESENCE_LABELS: Record<McbotPresenceMode, string> = {
  auto: '自动在线',
  always: '常驻在线',
  off: '不主动上线',
}

const PRESENCE_HINTS: Record<McbotPresenceMode, string> = {
  auto: '有玩家或任务时在线，空服自动离开。',
  always: '空服也保持在线，占用服务器资源；仅在你确认时使用。',
  off: '不主动上线；不会打断正在运行的任务或自主会话。',
}

/** 预设计划：只使用任务白名单，创建后仍需显式开始。 */
const PRESET_PLANS: Array<{ label: string, objective: string, steps: Array<{ kind: McbotGoalKind, taskName?: McbotTaskName }> }> = [
  {
    label: '采集→存箱→回家',
    objective: '采集资源、存入分类箱并回家',
    steps: [
      { kind: 'task', taskName: 'woodcutting' },
      { kind: 'deposit' },
      { kind: 'home' },
    ],
  },
  {
    label: '清理安全区→存箱',
    objective: '清理安全区并整理战利品',
    steps: [{ kind: 'task', taskName: 'clearing' }, { kind: 'deposit' }],
  },
]

interface PendingConfirm {
  kind: 'presence' | 'start' | 'resume' | 'pause' | 'cancel'
  goalId?: string
  mode?: McbotPresenceMode
  label: string
}

const FAILURE_LABELS: Record<string, string> = {
  path: '路线阻塞',
  survival: '生存保护',
  supplies: '物资阻塞',
  interrupted: '执行中断',
  unknown: '步骤失败',
}

const FAILURE_HINTS: Record<string, string> = {
  path: '确认路线畅通后，从当前步骤继续。',
  survival: '确认生命状态与周围环境安全后继续。',
  supplies: '检查工具、食物和箱子空间，补足后继续。',
  interrupted: '确认当前状态后，从未完成的步骤继续。',
  unknown: '检查当前步骤的错误信息后继续。',
}

function stepLabel(step: McbotGoal['steps'][number]): string {
  return step.kind === 'task' ? mcbotTaskNameLabel(step.taskName) : step.kind === 'deposit' ? '存箱' : '回家'
}

function nextAction(goal: McbotGoal): string {
  if (goal.status === 'completed') return '全部步骤已完成，可以创建新的目标。'
  if (goal.status === 'canceled') return '目标已取消；如需继续，请创建新目标。'
  if (goal.status === 'failed') return '检查失败原因后，创建新的目标。'
  const current = goal.steps[goal.currentStep]
  if (goal.status === 'paused') return goal.lastError
    ? `${FAILURE_HINTS[goal.lastFailureKind ?? 'unknown'] ?? FAILURE_HINTS.unknown} 从第 ${goal.currentStep + 1} 步继续。`
    : `准备好后，从第 ${goal.currentStep + 1} 步继续。`
  if (goal.status === 'pending') return '确认开始后，按顺序执行全部步骤。'
  const next = goal.steps.slice(goal.currentStep + 1).find((step) => step.status === 'pending')
  return current ? `正在${stepLabel(current)}${next ? `，完成后${stepLabel(next)}` : '，完成后结束目标'}。` : '等待最新执行结果。'
}

function goalStatusTone (status: string): 'muted' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'running') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'completed') return 'info'
  if (status === 'failed' || status === 'canceled') return 'danger'
  return 'muted'
}

function goalStatusLabel (status: string): string {
  switch (status) {
    case 'running': return '执行中'
    case 'paused': return '已暂停'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'canceled': return '已取消'
    case 'skipped': return '已跳过'
    default: return '待开始'
  }
}

export function McbotPresenceGoalsCard({
  controlReady,
  onChanged,
}: {
  controlReady: boolean
  onChanged?: () => void
}) {
  const toast = useToast()
  const [presence, setPresence] = useState<McbotPresenceInfo | null>(null)
  const [goals, setGoals] = useState<McbotGoal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [goalsError, setGoalsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [planIndex, setPlanIndex] = useState(0)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const requestIdRef = useRef(0)
  const busyRef = useRef(false)

  const load = useCallback(async (signal?: AbortSignal, afterAction = false) => {
    if (busyRef.current && !afterAction) return
    const requestId = ++requestIdRef.current
    const [presenceResult, goalsResult] = await Promise.allSettled([
      Promise.resolve().then(() => api.mcbot.presence(signal)),
      Promise.resolve().then(() => api.mcbot.goals(10, signal)),
    ])
    if (signal?.aborted || requestId !== requestIdRef.current) return
    if (presenceResult.status === 'fulfilled') {
      setPresence(presenceResult.value.presence ?? null)
      setError(null)
    } else {
      const failure = presenceResult.reason
      if (isAbortError(failure)) return
      setError(isApiError(failure) ? toErrorMessage(failure) : '在线模式读取失败')
    }
    if (goalsResult.status === 'fulfilled') {
      setGoals(goalsResult.value.goals)
      setGoalsError(null)
    } else {
      const failure = goalsResult.reason
      if (isAbortError(failure)) return
      setGoalsError(isApiError(failure) ? toErrorMessage(failure) : '长期目标读取失败')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
      requestIdRef.current += 1
    }
  }, [load])

  usePolling(() => load(), 5000)

  async function runAction (work: () => Promise<void>, success: string): Promise<boolean> {
    if (!controlReady || busyRef.current) return false
    busyRef.current = true
    requestIdRef.current += 1
    setBusy(true)
    try {
      await work()
      toast.success(success)
      onChanged?.()
      await load(undefined, true)
      return true
    } catch (failure) {
      if (!isAbortError(failure)) toast.error(isApiError(failure) ? toErrorMessage(failure) : '操作失败')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function confirmAction (): void {
    if (!confirm) return
    if (!controlReady || busyRef.current) {
      setConfirm(null)
      return
    }
    if (confirm.kind !== 'presence') {
      const goal = goals.find((item) => item.id === confirm.goalId)
      const valid = goal && (confirm.kind === 'start' ? goal.status === 'pending'
        : confirm.kind === 'resume' ? goal.status === 'paused'
          : confirm.kind === 'pause' ? goal.status === 'running'
            : ['pending', 'paused', 'running'].includes(goal.status))
      if (!valid) {
        setConfirm(null)
        toast.error('目标状态已更新，请查看当前状态后重试')
        return
      }
    }
    if (confirm.kind === 'presence') {
      void runAction(async () => {
        if (confirm.mode) await api.mcbot.setPresence(confirm.mode)
      }, `在线模式已切换为「${confirm.mode ? PRESENCE_LABELS[confirm.mode] : ''}」`)
    } else if ((confirm.kind === 'start' || confirm.kind === 'resume') && confirm.goalId) {
      const { goalId, kind } = confirm
      void runAction(() => api.mcbot.goalAction(goalId, kind).then(() => {}), kind === 'resume' ? '已请求继续目标' : '目标已开始')
    } else if (confirm.kind === 'pause' && confirm.goalId) {
      void runAction(() => api.mcbot.goalAction(confirm.goalId!, 'pause').then(() => {}), '目标已暂停')
    } else if (confirm.kind === 'cancel' && confirm.goalId) {
      void runAction(() => api.mcbot.goalAction(confirm.goalId!, 'cancel').then(() => {}), '目标已取消')
    }
    setConfirm(null)
  }

  function createPlan (event: FormEvent): void {
    event.preventDefault()
    const plan = PRESET_PLANS[planIndex]
    if (!plan) return
    void runAction(async () => {
      await api.mcbot.createGoal(plan.objective, plan.steps)
    }, '目标已创建，请确认后开始')
  }

  function confirmTitle (): string {
    if (!confirm) return ''
    if (confirm.kind === 'presence') return '切换在线模式'
    if (confirm.kind === 'start') return '开始长期目标'
    if (confirm.kind === 'resume') return '继续长期目标'
    if (confirm.kind === 'pause') return '暂停长期目标'
    return '取消长期目标'
  }

  function confirmMessage (): string {
    if (!confirm) return ''
    if (confirm.kind === 'presence') return `确定切换到「${confirm.mode ? PRESENCE_LABELS[confirm.mode] : ''}」？`
    if (confirm.kind === 'start') return '目标将按步骤串行执行；失败会暂停并等待处理。确定开始？'
    if (confirm.kind === 'resume') return `将从${confirm.label}，已完成的步骤会保留。确定继续？`
    if (confirm.kind === 'pause') return '当前动作会停止并收尾，目标保留以便稍后恢复。确定暂停？'
    return '取消后不可恢复，已完成的步骤保留。确定取消？'
  }

  return (
    <>
      <Card
        className="mcbot-goals-card"
        title="目标执行"
        description="采集、存箱、回家，按动作结果推进；开始与恢复需要二次确认。"
        actions={<Badge tone={controlReady ? 'success' : 'muted'}>{controlReady ? '可控' : '只读'}</Badge>}
      >
        <div className="mcbot-goal-overview"><Target size={18} aria-hidden="true" /><span>多步目标</span><span className="mcbot-goal-overview-note">{goals.some((goal) => goal.status === 'running') ? '正在执行计划' : '准备下一次出发'}</span></div>
        {goalsError ? <InlineError message={goalsError} /> : null}
        {goals.length === 0 ? (
          <EmptyState compact icon={<Target size={22} />} title="暂无长期目标" description="创建计划后先查看步骤，再确认开始执行。" />
        ) : (
          <ul className="mcbot-goal-list">
            {[...goals].sort((left, right) => {
              const rank = (goal: McbotGoal): number => goal.status === 'running' ? 0 : goal.status === 'paused' ? 1 : goal.status === 'pending' ? 2 : 3
              return rank(left) - rank(right)
            }).map((goal) => {
              const completed = goal.steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length
              const currentError = goal.lastError || goal.steps[goal.currentStep]?.lastError
              return (
                <li className={`mcbot-goal-item mcbot-goal-${goal.status}`} key={goal.id}>
                  <div className="mcbot-goal-heading"><strong>{goal.objective}</strong><Badge tone={goalStatusTone(goal.status)}>{goalStatusLabel(goal.status)}</Badge></div>
                  <div className="mcbot-goal-progress"><span>已完成 {completed} / {goal.steps.length} 步</span><ProgressBar value={goal.steps.length > 0 ? completed / goal.steps.length * 100 : 0} tone="accent" ariaLabel={`${goal.objective}的执行进度`} /></div>
                  <ol className="mcbot-goal-steps" aria-label={`${goal.objective}的步骤`}>
                    {goal.steps.map((step, index) => (
                      <li key={`${goal.id}-${index}`} className={`mcbot-goal-step mcbot-goal-step-${step.status}`} aria-current={index === goal.currentStep && (goal.status === 'running' || goal.status === 'paused') ? 'step' : undefined}>
                        <span className="mcbot-goal-step-index" aria-hidden="true">{step.status === 'completed' ? '✓' : index + 1}</span><span><strong>{stepLabel(step)}</strong><span>{goalStatusLabel(step.status)}</span></span>
                      </li>
                    ))}
                  </ol>
                  <div className="mcbot-goal-guidance">
                    <div className={currentError ? 'mcbot-goal-blocked' : undefined}><span>阻塞原因</span><p>{currentError ? `${goal.lastFailureKind ? `${FAILURE_LABELS[goal.lastFailureKind] ?? '步骤失败'} · ` : ''}${currentError}` : '暂无阻塞上报'}</p></div>
                    <div><span>下一步</span><p>{nextAction(goal)}</p></div>
                  </div>
                  <div className="mcbot-goal-actions">
                    {goal.status === 'pending' || goal.status === 'paused' ? <Button size="sm" variant="primary" disabled={!controlReady || busy} icon={<Play size={14} />} onClick={() => setConfirm(goal.status === 'paused' ? { kind: 'resume', goalId: goal.id, label: `第 ${goal.currentStep + 1} 步继续` } : { kind: 'start', goalId: goal.id, label: '开始' })}>{goal.status === 'paused' ? `从第 ${goal.currentStep + 1} 步继续` : '开始'}</Button> : null}
                    {goal.status === 'running' ? <Button size="sm" variant="secondary" disabled={!controlReady || busy} icon={<Moon size={14} />} onClick={() => setConfirm({ kind: 'pause', goalId: goal.id, label: '暂停' })}>暂停</Button> : null}
                    {goal.status === 'pending' || goal.status === 'paused' || goal.status === 'running' ? <Button size="sm" variant="danger" disabled={!controlReady || busy} icon={<Square size={14} />} onClick={() => setConfirm({ kind: 'cancel', goalId: goal.id, label: '取消' })}>取消</Button> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <form className="mcbot-task-controls mcbot-create-plan" onSubmit={createPlan}>
          <label className="field-label" htmlFor="mcbot-goal-preset">新建计划</label>
          <div className="select-field"><select id="mcbot-goal-preset" className="select" value={planIndex} disabled={!controlReady || busy} onChange={(event) => setPlanIndex(Number(event.target.value))}>{PRESET_PLANS.map((plan, index) => <option key={plan.label} value={index}>{plan.label}</option>)}</select></div>
          <Button type="submit" variant="secondary" disabled={!controlReady || busy} loading={busy}>创建计划</Button>
        </form>

        <McbotGoalDraftEditor disabled={!controlReady || busy} onCreate={draft => runAction(async () => {
          await api.mcbot.createGoal(draft.objective, draft.steps)
        }, '目标已创建，请确认后开始')} />

        <details className="mcbot-presence-details"><summary>在线模式<span>{presence ? PRESENCE_LABELS[presence.mode] : '尚未读取'}</span></summary>
        {error ? <InlineError message={error} /> : null}
        <div className="mcbot-presence-controls">
          <span className="mcbot-fact-label">在线模式</span>
          <div className="mcbot-task-controls" role="group" aria-label="在线模式">
            {(Object.keys(PRESENCE_LABELS) as McbotPresenceMode[]).map((mode) => (
              <Button
                key={mode}
                variant={presence?.mode === mode ? 'primary' : 'secondary'}
                size="sm"
                disabled={!controlReady || busy}
                onClick={() => setConfirm({ kind: 'presence', mode, label: PRESENCE_LABELS[mode] })}
              >
                {PRESENCE_LABELS[mode]}
              </Button>
            ))}
          </div>
          {presence ? (
            <span className="mcbot-fact-hint">
              {PRESENCE_HINTS[presence.mode]}
              {presence.source === 'persisted' && presence.updatedAt ? (
                <> · 已持久化 <RelativeTime ts={presence.updatedAt} /></>
              ) : null}
            </span>
          ) : null}
        </div>

        </details>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={confirmTitle()}
        message={confirmMessage()}
        confirmText={confirm?.kind === 'cancel' ? '取消目标' : '确认'}
        tone={confirm?.kind === 'cancel' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={confirmAction}
        onClose={() => setConfirm(null)}
      />
    </>
  )
}
