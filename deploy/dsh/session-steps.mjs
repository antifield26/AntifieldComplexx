/**
 * 从 DSH RunResult.events 抽出管理员时间线。
 * 只保留直接用户发言、助手正文、14 个 mcbot 工具、goal 与 todo。
 * 不包含 arguments、结果正文、usage 或 token。单次回合最多 80 步，
 * steps 的 UTF-8 JSON 不超过 24 KiB，并与 final text 一起放进 64 KiB。
 */

export const TEXT_LIMIT = 16_000
export const MAX_STEPS = 80
export const STEP_JSON_LIMIT = 24 * 1024
export const PACKED_LIMIT = 64 * 1024

export const TOOL_NAMES = [
  'start_task',
  'stop_task',
  'go_home',
  'deposit',
  'task_status',
  'observe',
  'inspect_chest',
  'eat',
  'equip',
  'finish',
  'memory_read',
  'memory_write',
  'memory_forget',
  'expedition',
]

const TOOLS = new Set(TOOL_NAMES)
const GOAL_ACTIONS = new Set(['edit', 'pause', 'resume', 'complete', 'blocked'])
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const GOAL_TITLES = {
  create: '创建目标',
  edit: '修改目标',
  pause: '暂停目标',
  resume: '继续目标',
  complete: '完成目标',
  blocked: '目标受阻',
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

function argumentsOf(data) {
  const raw = data.arguments
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(raw) ? raw : null
}

function goalStep(name, args) {
  if (name === 'get_goal') return null
  let action = null
  if (name === 'create_goal') action = 'create'
  else if (name === 'update_goal' && GOAL_ACTIONS.has(args?.action)) action = args.action
  if (!action) return null
  const objective = typeof args?.objective === 'string' ? args.objective.trim() : ''
  return { kind: 'goal', action, title: objective ? objective.slice(0, 120) : GOAL_TITLES[action] }
}

function todoSteps(args) {
  if (!Array.isArray(args?.todos)) return []
  const steps = []
  for (const item of args.todos) {
    if (!isRecord(item) || !TODO_STATUSES.has(item.status)) continue
    if (typeof item.content !== 'string' || item.content.length === 0) continue
    steps.push({ kind: 'todo', action: item.status, title: item.content.slice(0, 120) })
  }
  return steps
}

function resultCallId(data) {
  const message = isRecord(data.message) ? data.message : null
  if (message && typeof message.toolCallId === 'string') return message.toolCallId
  const source = message && isRecord(message.source) ? message.source : null
  if (source && typeof source.callId === 'string') return source.callId
  return typeof data.callId === 'string' ? data.callId : ''
}

function resultFailed(data) {
  if (Object.prototype.hasOwnProperty.call(data, 'error')) return true
  const message = isRecord(data.message) ? data.message : null
  return message?.isError === true
}

export function fitSteps(steps, text) {
  let kept = steps.slice(-MAX_STEPS)
  while (kept.length > 0) {
    const stepsBytes = Buffer.byteLength(JSON.stringify(kept))
    const packedBytes = Buffer.byteLength(JSON.stringify({ text, steps: kept }))
    if (stepsBytes <= STEP_JSON_LIMIT && packedBytes <= PACKED_LIMIT) break
    kept = kept.slice(1)
  }
  return kept
}

export function extractSessionSteps(events, text = '') {
  if (!Array.isArray(events)) return []
  const pending = new Map()
  const steps = []
  for (const event of events) {
    if (!isRecord(event) || typeof event.type !== 'string' || !isRecord(event.data)) continue
    const data = event.data
    if (event.type === 'user/message') {
      const source = isRecord(data.source) ? data.source : null
      if (!source || source.kind !== 'user') continue
      const userText = textOf(data.content).slice(0, 2000)
      if (userText) steps.push({ kind: 'user', text: userText })
    } else if (event.type === 'assistant/message') {
      const message = isRecord(data.message) ? data.message : null
      const assistantText = textOf(message?.content).slice(0, 2000)
      if (assistantText) steps.push({ kind: 'assistant', text: assistantText })
    } else if (event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : ''
      if (TOOLS.has(name)) {
        const step = { kind: 'tool', name, status: 'error' }
        steps.push(step)
        if (typeof data.callId === 'string' && data.callId) pending.set(data.callId, step)
      } else {
        const args = argumentsOf(data)
        const goal = goalStep(name, args)
        if (goal) steps.push(goal)
        else if (name === 'todo_write') steps.push(...todoSteps(args))
      }
    } else if (event.type === 'tool/result') {
      const step = pending.get(resultCallId(data))
      if (!step) continue
      step.status = resultFailed(data) ? 'error' : 'ok'
      pending.delete(resultCallId(data))
    }
  }
  return fitSteps(steps, typeof text === 'string' ? text : '')
}

/** finishReason 为 error/cancelled/aborted 时抛错，不返回半截步骤。 */
export function completedTurn(result) {
  const reason = isRecord(result) ? result.finishReason : null
  if (reason === 'error' || reason === 'cancelled' || reason === 'aborted') {
    throw new Error('模型回合未完成')
  }
  const text = isRecord(result) && typeof result.finalResponse === 'string'
    ? result.finalResponse.slice(0, TEXT_LIMIT)
    : ''
  const events = isRecord(result) ? result.events : []
  return { text, steps: extractSessionSteps(events, text) }
}
