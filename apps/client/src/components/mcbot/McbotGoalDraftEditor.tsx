/** 草案仅驻留当前页面内存；主人检查并确认创建后仍须使用目标卡的独立开始确认。 */
import { useState } from 'react'
import { parseGoalDraft, type GoalDraft, type GoalDraftStep } from '../../lib/mcbot-goal-draft'
import { MCBOT_TASK_NAMES, MCBOT_TASK_NAME_LABELS } from '../../lib/mcbot'
import { useUnsavedChanges } from '../../lib/navigation-guard'
import { Button } from '../Button'
import { InlineError } from '../InlineError'

export function McbotGoalDraftEditor({ disabled, onCreate }: {
  disabled: boolean
  onCreate: (draft: GoalDraft) => Promise<boolean>
}) {
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  useUnsavedChanges(input.trim().length > 0 || draft !== null)

  function changeStep(index: number, value: string): void {
    const step: GoalDraftStep = value === 'home' || value === 'deposit'
      ? { kind: value } : { kind: 'task', taskName: MCBOT_TASK_NAMES.find(name => name === value) }
    if (step.kind === 'task' && !step.taskName) return
    setDraft(current => current && ({ ...current, steps: current.steps.map((item, i) => i === index ? step : item) }))
  }

  return <details className="mcbot-goal-draft">
    <summary>用一句话生成草案</summary>
    <p className="field-hint">例如：先砍树，然后存箱，最后回家。仅支持已有任务，不支持数量、坐标或条件；任务沿用现有上限。</p>
    <label className="field-label" htmlFor="mcbot-draft-input">目标描述</label>
    <input id="mcbot-draft-input" className="input" maxLength={200} value={input} disabled={disabled} onChange={event => { setInput(event.target.value); setDraft(null); setError(null) }} />
    <div className="mcbot-task-controls">
      <Button disabled={disabled || !input.trim()} onClick={() => {
        const result = parseGoalDraft(input)
        setError(result.ok ? null : result.error)
        setDraft(result.ok ? result.draft : null)
      }}>生成草案</Button>
      <Button disabled={disabled || (!input && !draft)} onClick={() => { setInput(''); setDraft(null); setError(null) }}>清空草案</Button>
    </div>
    {error ? <InlineError message={error} /> : null}
    {draft ? <form onSubmit={event => {
      event.preventDefault()
      if (disabled || !draft.objective.trim()) return
      void onCreate({ objective: draft.objective.trim(), steps: draft.steps.map(step => ({ ...step })) }).then(created => {
        if (created) { setDraft(null); setInput(''); setError(null) }
      })
    }}>
      <label className="field-label" htmlFor="mcbot-draft-objective">草案标题</label>
      <input id="mcbot-draft-objective" className="input" maxLength={200} value={draft.objective} disabled={disabled} onChange={event => setDraft({ ...draft, objective: event.target.value })} />
      <ol>{draft.steps.map((step, index) => <li key={index}>
        <label className="field-label" htmlFor={`mcbot-draft-step-${index}`}>第 {index + 1} 步</label>
        <div className="select-field"><select id={`mcbot-draft-step-${index}`} className="select" value={step.kind === 'task' ? step.taskName : step.kind} disabled={disabled} onChange={event => changeStep(index, event.target.value)}>
          {MCBOT_TASK_NAMES.map(name => <option key={name} value={name}>{MCBOT_TASK_NAME_LABELS[name]}</option>)}
          <option value="deposit">存箱</option><option value="home">回家</option>
        </select></div>
      </li>)}</ol>
      <p className="field-hint">请逐步确认。创建后状态为待开始，不会发出 Bot 动作。</p>
      <Button type="submit" variant="primary" disabled={disabled || !draft.objective.trim()}>确认创建草案</Button>
    </form> : null}
  </details>
}
