/** DSH 会话事件到内存时间线的纯函数。不访问 Minecraft、DSH 或网络。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptSteps } from '../../src/ai/steps.ts'
import { AUTONOMY_RAW_TOOLS } from '../../src/autonomy/tools.ts'
import {
  PACKED_LIMIT,
  STEP_JSON_LIMIT,
  TOOL_NAMES,
  completedTurn,
  extractSessionSteps,
} from '../../../../deploy/dsh/session-steps.mjs'

function userEvent(text, kind = 'user') {
  return {
    type: 'user/message',
    data: { source: { kind }, content: [{ type: 'text', text }] },
  }
}

function assistantEvent(text) {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] }, usage: { totalTokens: 99 } },
  }
}

function callEvent(callId, name, args) {
  return {
    type: 'tool/call',
    data: { callId, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  }
}

function resultEvent(callId, fields = {}) {
  return { type: 'tool/result', data: { message: { toolCallId: callId, ...fields.message }, ...fields.data } }
}

test('工具名与自主工具白名单一致', () => {
  assert.deepEqual(TOOL_NAMES, [...AUTONOMY_RAW_TOOLS])
})

test('成功工具、失败工具和未配对调用', () => {
  const steps = extractSessionSteps([
    callEvent('c-ok', 'observe', { radius: 4 }),
    resultEvent('c-ok', { message: { isError: false }, data: { result: '箱子坐标' } }),
    callEvent('c-bad', 'eat', { item: 'bread' }),
    resultEvent('c-bad', { message: { isError: true }, data: { error: { name: 'ToolError', code: 'hungry' } } }),
    callEvent('c-null', 'equip', {}),
    resultEvent('c-null', { message: {}, data: { error: null } }),
    callEvent('c-open', 'memory_read', {}),
    { type: 'tool/result', data: { message: { source: { callId: 'missing' } } } },
    callEvent('c-shell', 'bash', { command: 'id' }),
  ])
  assert.deepEqual(steps, [
    { kind: 'tool', name: 'observe', status: 'ok' },
    { kind: 'tool', name: 'eat', status: 'error' },
    { kind: 'tool', name: 'equip', status: 'error' },
    { kind: 'tool', name: 'memory_read', status: 'error' },
  ])
  const packed = JSON.stringify(steps)
  assert.equal(packed.includes('箱子坐标'), false)
  assert.equal(packed.includes('bread'), false)
  assert.equal(packed.includes('radius'), false)
})

test('goal 与 todo 只保留动作和标题', () => {
  const steps = extractSessionSteps([
    callEvent('g1', 'create_goal', { objective: '找小麦', goal_id: 'g', max_goal_rounds: 3 }),
    callEvent('g2', 'update_goal', { action: 'pause', goal_id: 'g', revision: 2 }),
    callEvent('g3', 'update_goal', { action: 'edit', objective: '   ' }),
    callEvent('g4', 'update_goal', { action: 'delete', objective: '不要出现' }),
    callEvent('g5', 'get_goal', { goal_id: 'g' }),
    callEvent('t1', 'todo_write', {
      todos: [
        { content: '回家'.repeat(80), status: 'in_progress' },
        { content: '', status: 'pending' },
        { content: '跳过', status: 'later' },
        { content: '完成采集', status: 'completed' },
      ],
    }),
  ])
  assert.deepEqual(steps, [
    { kind: 'goal', action: 'create', title: '找小麦' },
    { kind: 'goal', action: 'pause', title: '暂停目标' },
    { kind: 'goal', action: 'edit', title: '修改目标' },
    { kind: 'todo', action: 'in_progress', title: '回家'.repeat(60) },
    { kind: 'todo', action: 'completed', title: '完成采集' },
  ])
  const packed = JSON.stringify(steps)
  assert.equal(packed.includes('goal_id'), false)
  assert.equal(packed.includes('revision'), false)
  assert.equal(packed.includes('max_goal_rounds'), false)
  assert.equal(packed.includes('不要出现'), false)
})

test('非用户 source 与助手 usage 不进入时间线', () => {
  const steps = extractSessionSteps([
    userEvent('续轮内容', 'goal'),
    { type: 'user/message', data: { content: [{ type: 'text', text: '没有来源' }] } },
    userEvent('主人这句话'),
    assistantEvent('我看到了'),
  ])
  assert.deepEqual(steps, [
    { kind: 'user', text: '主人这句话' },
    { kind: 'assistant', text: '我看到了' },
  ])
  assert.equal(JSON.stringify(steps).includes('usage'), false)
  assert.equal(JSON.stringify(steps).includes('99'), false)
})

test('单次回合超过 80 步或 24 KiB 时丢掉最旧步骤', () => {
  const many = Array.from({ length: 100 }, (_, index) => userEvent(`短句 ${index}`))
  const capped = extractSessionSteps(many)
  assert.equal(capped.length, 80)
  assert.equal(capped[0].text, '短句 20')
  assert.equal(capped.at(-1).text, '短句 99')

  const heavy = Array.from({ length: 20 }, (_, index) => userEvent(`${String(index).padStart(4, '0')}${'测'.repeat(1996)}`))
  const trimmed = extractSessionSteps(heavy)
  assert.ok(trimmed.length < heavy.length)
  assert.ok(Buffer.byteLength(JSON.stringify(trimmed)) <= STEP_JSON_LIMIT)
  assert.equal(trimmed.at(-1).text, heavy.at(-1).data.content[0].text)
  assert.notEqual(trimmed[0].text, heavy[0].data.content[0].text)
})

test('步骤和正文一起放进 64 KiB', () => {
  const text = '你'.repeat(16_000)
  const events = Array.from({ length: 30 }, (_, index) => userEvent(`${String(index).padStart(4, '0')}${'测'.repeat(1996)}`))
  const steps = extractSessionSteps(events, text)
  assert.ok(Buffer.byteLength(JSON.stringify(steps)) <= STEP_JSON_LIMIT)
  assert.ok(Buffer.byteLength(JSON.stringify({ text, steps })) <= PACKED_LIMIT)
  assert.ok(steps.length < events.length)
  assert.equal(steps.at(-1).text, events.at(-1).data.content[0].text)
})

test('未完成回合抛错，不返回半截步骤', () => {
  const events = [userEvent('半截'), callEvent('c1', 'observe', {})]
  for (const finishReason of ['error', 'cancelled', 'aborted']) {
    assert.throws(() => completedTurn({ finishReason, finalResponse: '半截回复', events }), /模型回合未完成/)
  }
  const done = completedTurn({
    finishReason: 'stop',
    finalResponse: `${'好'.repeat(16_000)}超出`,
    events: [callEvent('c1', 'start_task', { name: 'fishing' }), resultEvent('c1', { message: {} })],
  })
  assert.equal(done.text, '好'.repeat(16_000))
  assert.deepEqual(done.steps, [{ kind: 'tool', name: 'start_task', status: 'ok' }])
})

test('非法步骤在客户端丢弃，多余字段不保留', () => {
  const steps = acceptSteps([
    { kind: 'tool', name: 'observe', status: 'ok', arguments: { secret: 1 } },
    { kind: 'tool', name: 'bash', status: 'ok' },
    { kind: 'goal', action: 'explode', title: '不要' },
    { kind: 'goal', action: 'create', title: '小麦'.repeat(80), goal_id: 'g' },
    { kind: 'user', text: '' },
    { kind: 'todo', action: 'later', title: '不要' },
    null,
  ])
  assert.deepEqual(steps, [
    { kind: 'tool', name: 'observe', status: 'ok' },
    { kind: 'goal', action: 'create', title: '小麦'.repeat(60) },
  ])
})
