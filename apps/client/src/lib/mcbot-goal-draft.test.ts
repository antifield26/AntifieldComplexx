/** 草案解析不忽略数量、否定、坐标或未知条件，保持步骤顺序及五步边界。 */
import { describe, expect, it } from 'vitest'
import { parseGoalDraft } from './mcbot-goal-draft'

describe('自然语言目标草案', () => {
  it('按顺序生成固定能力草案，优先匹配天然林', () => {
    expect(parseGoalDraft('请先砍天然林，然后存入分类箱，最后回家')).toEqual({ ok: true, draft: {
      objective: '请先砍天然林，然后存入分类箱，最后回家',
      steps: [{ kind: 'task', taskName: 'forest' }, { kind: 'deposit' }, { kind: 'home' }],
    } })
  })
  it.each(['不要挖矿', '钓鱼32条后回家', '去1,64,1砍树', '挖铁矿', '回家后自杀', '/home', '回家\n存箱', '如果安全就巡逻', '只要砍树不要回家', ''])('拒绝不完整理解的请求 %s', (text) => {
    expect(parseGoalDraft(text).ok).toBe(false)
  })
  it('限制五步且结果可独立编辑', () => {
    expect(parseGoalDraft('钓鱼，存箱，种田，存箱，回家').ok).toBe(true)
    expect(parseGoalDraft('钓鱼，存箱，种田，存箱，睡觉，回家').ok).toBe(false)
    const result = parseGoalDraft('回家')
    if (!result.ok) throw new Error('未生成草案')
    result.draft.steps[0]!.kind = 'deposit'
    expect(parseGoalDraft('回家')).toMatchObject({ draft: { steps: [{ kind: 'home' }] } })
  })
})
