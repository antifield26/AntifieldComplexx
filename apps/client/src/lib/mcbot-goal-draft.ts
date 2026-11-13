/** 本地解析目标草案，只接受已有固定任务与连接词；不调用模型、写 API 或发出动作。 */
import type { McbotGoalKind, McbotTaskName } from '../api/types'

export interface GoalDraftStep { kind: McbotGoalKind, taskName?: McbotTaskName }
export interface GoalDraft { objective: string, steps: GoalDraftStep[] }
export type GoalDraftResult = { ok: true, draft: GoalDraft } | { ok: false, error: string }

const ACTIONS: Array<{ words: string[], step: GoalDraftStep }> = [
  { words: ['砍天然林', '采集天然林', '天然林'], step: { kind: 'task', taskName: 'forest' } },
  { words: ['树场砍树', '砍树', '采集木头', '采集原木'], step: { kind: 'task', taskName: 'woodcutting' } },
  { words: ['清理安全区', '清怪'], step: { kind: 'task', taskName: 'clearing' } },
  { words: ['钓鱼'], step: { kind: 'task', taskName: 'fishing' } },
  { words: ['种田', '收麦子'], step: { kind: 'task', taskName: 'farming' } },
  { words: ['挖矿'], step: { kind: 'task', taskName: 'mining' } },
  { words: ['巡逻'], step: { kind: 'task', taskName: 'patrol' } },
  { words: ['睡觉'], step: { kind: 'task', taskName: 'sleep' } },
  { words: ['存入分类箱', '存入箱子', '存箱', '存东西'], step: { kind: 'deposit' } },
  { words: ['回家'], step: { kind: 'home' } },
]
const WORDS = ACTIONS.flatMap(({ words, step }) => words.map(word => ({ word, step }))).sort((a, b) => b.word.length - a.word.length)
const CONNECTOR = /^(?:请|帮我|先|然后|接着|再|最后|完成后|之后|并且|并|和|去|一下|一会儿|，|、|。|；|,|;|→|\s)+/

export function parseGoalDraft(input: string): GoalDraftResult {
  const objective = input.trim()
  if (!objective || objective.length > 200 || [...objective].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/')) {
    return { ok: false, error: '请输入 1～200 字的单行目标，不含命令符号。' }
  }
  const steps: GoalDraftStep[] = []
  let rest = objective
  while (rest) {
    const connector = CONNECTOR.exec(rest)
    if (connector) { rest = rest.slice(connector[0].length); continue }
    const action = WORDS.find(({ word }) => rest.startsWith(word))
    if (!action) return { ok: false, error: '有未识别的要求，请使用钓鱼、种田、砍树、天然林、挖矿、清怪、巡逻、睡觉、存箱或回家。不支持数量、指定坐标及条件。' }
    steps.push({ ...action.step })
    if (steps.length > 5) return { ok: false, error: '一个目标最多 5 步，请拆分后再生成。' }
    rest = rest.slice(action.word.length)
  }
  if (!steps.length) return { ok: false, error: '请至少描述一个可执行步骤。' }
  return { ok: true, draft: { objective, steps } }
}
