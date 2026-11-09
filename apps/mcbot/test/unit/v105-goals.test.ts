/** 目标执行夹具只返回所属动作结果，不连接真实 Minecraft。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuditLogger } from '../../src/audit.ts'
import { EventBus } from '../../src/events/bus.ts'
import { GoalStore } from '../../src/goals/store.ts'
import { GoalRunner, type GoalRunnerDeps } from '../../src/goals/runner.ts'
import { waitFor } from '../helpers.ts'

function fixture () {
  const dir = mkdtempSync(join(tmpdir(), 'mcbot-goal-'))
  const store = new GoalStore(join(dir, 'goals.db'))
  store.init()
  const calls: string[] = []
  const deps: GoalRunnerDeps = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, withScope: () => ({}) } as never,
    tasks: {
      isGoalBlocked: () => false,
      async runGoalTask (name, executionId) {
        calls.push(name)
        return { executionId, taskId: 'owned', produced: 1, error: null }
      },
      async depositForGoal () { calls.push('deposit'); return 1 }
    },
    movement: {
      isBusy: () => false,
      atHome: () => true,
      async home () { calls.push('home') },
      stop () { calls.push('stop') }
    },
    blocker: () => null,
    audit: { append: () => {} } as unknown as AuditLogger,
    store
  }
  const runner = new GoalRunner(deps)
  const goal = runner.create('owner', '采集、存箱并回家', [
    { kind: 'task', taskName: 'woodcutting' }, { kind: 'deposit' }, { kind: 'home' }
  ])
  return { runner, goal, deps, calls, store, async close () {
    await runner.stop()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  } }
}

test('目标只等待所属任务结果，依次完成采集、存箱和回家', async () => {
  const fx = fixture()
  try {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof fx.deps.tasks.runGoalTask>>>()
    fx.deps.tasks.runGoalTask = () => pending.promise
    assert.equal((await fx.runner.start(fx.goal.id)).status, 'running')
    new EventBus(100).emit('task', { action: 'completed', task: { name: 'woodcutting' } })
    assert.equal(fx.runner.get(fx.goal.id)?.currentStep, 0)
    await assert.rejects(fx.runner.start(fx.goal.id), /goal_not_startable/)
    await fx.runner.cancel(fx.goal.id)
    pending.resolve({ executionId: 'old', taskId: 'old', produced: 1, error: null })
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.status, 'canceled')
    assert.deepEqual(fx.calls, ['stop'])
  } finally {
    await fx.close()
  }
})

test('取消在途存箱，收尾前保持占用并丢弃迟到结果', async () => {
  const fx = fixture()
  try {
    const close = Promise.withResolvers<void>()
    fx.deps.tasks.depositForGoal = async signal => {
      fx.calls.push('deposit')
      await close.promise
      assert.equal(signal.aborted, true)
      return 1
    }
    await fx.runner.start(fx.goal.id)
    await waitFor(() => fx.calls.includes('deposit'), 2000)
    await fx.runner.cancel(fx.goal.id)
    assert.equal(fx.runner.isBusy(), true)
    const another = fx.runner.create('owner', '回家', [{ kind: 'home' }])
    await assert.rejects(fx.runner.start(another.id), /goal_busy/)
    close.resolve()
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.deepEqual(fx.runner.get(fx.goal.id)?.steps.map(step => step.status), ['completed', 'skipped', 'skipped'])
    assert.deepEqual(fx.calls, ['woodcutting', 'deposit', 'stop'])
  } finally {
    await fx.close()
  }
})

test('箱满暂停，重启后保留已完成步骤，手动恢复后只执行剩余动作', async () => {
  const fx = fixture()
  try {
    const deposit = fx.deps.tasks.depositForGoal
    fx.deps.tasks.depositForGoal = async () => { throw new Error('箱满') }
    await fx.runner.start(fx.goal.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.lastFailureKind, 'supplies')
    assert.equal(fx.runner.get(fx.goal.id)?.currentStep, 1)
    fx.store.close()
    fx.store.init()
    fx.deps.tasks.depositForGoal = deposit
    await fx.runner.start(fx.goal.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.status, 'completed')
    assert.deepEqual(fx.calls, ['woodcutting', 'deposit', 'home'])
  } finally {
    await fx.close()
  }
})

test('回家途中取消，旧移动结束后新目标可正常回家', async () => {
  const fx = fixture()
  const finish = Promise.withResolvers<void>()
  try {
    const home = fx.runner.create('owner', '回家', [{ kind: 'home' }])
    fx.deps.movement.home = async () => { await finish.promise }
    await fx.runner.start(home.id)
    await fx.runner.cancel(home.id)
    assert.equal(fx.runner.isBusy(), true)
    finish.resolve()
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(home.id)?.status, 'canceled')
    await fx.runner.start(fx.goal.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.status, 'completed')
  } finally {
    finish.resolve()
    await fx.close()
  }
})

test('采集零产出暂停，断线恢复后需主人明确继续', async () => {
  const fx = fixture()
  try {
    fx.deps.tasks.runGoalTask = async (_name, executionId) => ({
      executionId, taskId: 'owned', produced: 0, error: null
    })
    await fx.runner.start(fx.goal.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.lastFailureKind, 'supplies')
    assert.equal(fx.runner.get(fx.goal.id)?.currentStep, 0)
    fx.deps.blocker = () => ({ kind: 'interrupted', message: 'Bot 已断线' })
    await fx.runner.start(fx.goal.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.equal(fx.runner.get(fx.goal.id)?.lastFailureKind, 'interrupted')
    assert.deepEqual(fx.calls, ['stop'])
  } finally {
    await fx.close()
  }
})

test('未实际抵达只重试一次，之后由主人处理', async () => {
  const fx = fixture()
  try {
    const home = fx.runner.create('owner', '回家', [{ kind: 'home' }])
    fx.deps.movement.atHome = () => false
    await fx.runner.start(home.id)
    await waitFor(() => !fx.runner.isBusy(), 2000)
    assert.deepEqual(fx.calls, ['home', 'home'])
    assert.equal(fx.runner.get(home.id)?.lastFailureKind, 'path')
    assert.equal(fx.runner.get(home.id)?.steps[0]?.attempts, 2)
  } finally {
    await fx.close()
  }
})
