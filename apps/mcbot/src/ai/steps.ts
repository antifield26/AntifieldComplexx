/**
 * 管理员对话的内存时间线步骤。
 * 只接受用户/助手正文、13 个 mcbot 工具、goal 与 todo。
 * 非法步骤丢弃。最多 80 步，steps JSON 不超过 24 KiB，并与正文一起放进 64 KiB。
 */
import { AUTONOMY_RAW_TOOLS } from '../autonomy/tools.ts'

export const MAX_STEPS = 80
export const STEP_JSON_LIMIT = 24 * 1024
export const PACKED_LIMIT = 64 * 1024

const TOOLS = new Set<string>(AUTONOMY_RAW_TOOLS)
const GOAL_ACTIONS = new Set(['create', 'edit', 'pause', 'resume', 'complete', 'blocked'])
const TODO_ACTIONS = new Set(['pending', 'in_progress', 'completed'])

export type SessionStep =
  | { kind: 'user', text: string }
  | { kind: 'assistant', text: string }
  | { kind: 'tool', name: string, status: 'ok' | 'error' }
  | { kind: 'goal', action: string, title: string }
  | { kind: 'todo', action: string, title: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function boundSteps(steps: SessionStep[], text = ''): SessionStep[] {
  let kept = steps.slice(-MAX_STEPS)
  while (kept.length > 0) {
    const stepsBytes = Buffer.byteLength(JSON.stringify(kept))
    const packedBytes = Buffer.byteLength(JSON.stringify({ text, steps: kept }))
    if (stepsBytes <= STEP_JSON_LIMIT && packedBytes <= PACKED_LIMIT) break
    kept = kept.slice(1)
  }
  return kept
}

function clip(value: string, max: number): string {
  return value.slice(0, max)
}

/** 校验上游 steps。多余字段不保留，形状不对的步骤丢弃。 */
export function acceptSteps(value: unknown, text = ''): SessionStep[] {
  if (!Array.isArray(value)) return []
  const steps: SessionStep[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (item.kind === 'user' || item.kind === 'assistant') {
      if (typeof item.text !== 'string' || item.text.length === 0) continue
      steps.push({ kind: item.kind, text: clip(item.text, 2000) })
    } else if (item.kind === 'tool') {
      if (typeof item.name !== 'string' || !TOOLS.has(item.name)) continue
      if (item.status !== 'ok' && item.status !== 'error') continue
      steps.push({ kind: 'tool', name: item.name, status: item.status })
    } else if (item.kind === 'goal') {
      if (typeof item.action !== 'string' || !GOAL_ACTIONS.has(item.action)) continue
      if (typeof item.title !== 'string' || item.title.length === 0) continue
      steps.push({ kind: 'goal', action: item.action, title: clip(item.title, 120) })
    } else if (item.kind === 'todo') {
      if (typeof item.action !== 'string' || !TODO_ACTIONS.has(item.action)) continue
      if (typeof item.title !== 'string' || item.title.length === 0) continue
      steps.push({ kind: 'todo', action: item.action, title: clip(item.title, 120) })
    }
  }
  return boundSteps(steps, text)
}
