/** 目标执行卡回归：步骤与阻塞可读，旧轮询不能覆盖新状态，确认时重新检查控制与目标状态。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { McbotGoal } from '../../api/types'
import { ToastProvider } from '../Toast'
import { McbotPresenceGoalsCard } from './McbotPresenceGoalsCard'

const mocks = vi.hoisted(() => ({ presence: vi.fn(), goals: vi.fn(), goalAction: vi.fn(), createGoal: vi.fn(), setPresence: vi.fn() }))
vi.mock('../../api/client', () => ({
  api: { mcbot: mocks }, isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  isApiError: () => false, toErrorMessage: (error: unknown, fallback = '') => error instanceof Error ? error.message : fallback,
}))

function goal(overrides: Partial<McbotGoal> = {}): McbotGoal {
  return {
    id: 'goal-1', owner: 'owner', objective: '采集资源、存入分类箱并回家', status: 'paused', currentStep: 1,
    attempts: 1, lastFailureKind: 'supplies', lastError: '分类箱空间不足', createdAt: '2026-11-11T12:00:00.000Z',
    updatedAt: '2026-11-11T12:00:01.000Z', startedAt: '2026-11-11T12:00:00.000Z', finishedAt: null,
    steps: [
      { index: 0, kind: 'task', taskName: 'woodcutting', status: 'completed', attempts: 1, lastError: null, startedAt: null, finishedAt: null },
      { index: 1, kind: 'deposit', taskName: null, status: 'failed', attempts: 1, lastError: '分类箱空间不足', startedAt: null, finishedAt: null },
      { index: 2, kind: 'home', taskName: null, status: 'pending', attempts: 0, lastError: null, startedAt: null, finishedAt: null },
    ], ...overrides,
  }
}
function view(controlReady = true) {
  return <ToastProvider><McbotPresenceGoalsCard controlReady={controlReady} /></ToastProvider>
}
beforeEach(() => {
  mocks.presence.mockResolvedValue({ presence: { mode: 'auto', source: 'default', updatedAt: null, connected: true, lastDecision: '' } })
  mocks.goals.mockResolvedValue({ goals: [goal()] })
  mocks.goalAction.mockResolvedValue({ goal: goal() })
  mocks.createGoal.mockResolvedValue({ goal: goal({ status: 'pending' }) })
  mocks.setPresence.mockResolvedValue({})
})
afterEach(cleanup)

describe('多步目标执行', () => {
  it('同一渲染周期重复提交只创建一个待开始计划', async () => {
    let finish: (value: { goal: McbotGoal }) => void = () => undefined
    mocks.createGoal.mockReturnValueOnce(new Promise<{ goal: McbotGoal }>((resolve) => { finish = resolve }))
    render(view())
    const submit = await screen.findByRole('button', { name: '创建计划' })
    const form = submit.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(mocks.createGoal).toHaveBeenCalledOnce()
    expect(mocks.goalAction).not.toHaveBeenCalled()
    await act(async () => { finish({ goal: goal({ status: 'pending' }) }) })
    expect(await screen.findByText('目标已创建，请确认后开始')).toBeInTheDocument()
  })

  it('展示步骤进度、阻塞原因与继续入口，恢复仍需二次确认', async () => {
    render(view())
    const progress = await screen.findByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '33')
    expect(screen.getByText('阻塞原因')).toBeInTheDocument()
    expect(screen.getByText('物资阻塞 · 分类箱空间不足')).toBeInTheDocument()
    expect(screen.getByText(/检查工具、食物和箱子空间/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /的步骤/ }).querySelector('[aria-current="step"]')).toHaveTextContent('存箱')
    fireEvent.click(screen.getByRole('button', { name: '从第 2 步继续' }))
    expect(mocks.goalAction).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '继续长期目标' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(mocks.goalAction).toHaveBeenCalledWith('goal-1', 'resume'))
  })

  it('确认期间失去控制权限时不提交写请求', async () => {
    const result = render(view())
    fireEvent.click(await screen.findByRole('button', { name: '从第 2 步继续' }))
    result.rerender(view(false))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(mocks.goalAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('慢旧轮询晚到时不覆盖最新目标', async () => {
    let finishOld: (value: { goals: McbotGoal[] }) => void = () => undefined
    mocks.goals.mockReturnValueOnce(new Promise<{ goals: McbotGoal[] }>((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ goals: [goal({ objective: '新目标' })] })
    render(view())
    await waitFor(() => expect(mocks.goals).toHaveBeenCalledOnce())
    fireEvent(window, new Event('af:refresh'))
    expect(await screen.findByText('新目标')).toBeInTheDocument()
    await act(async () => { finishOld({ goals: [goal({ objective: '旧目标' })] }) })
    expect(screen.getByText('新目标')).toBeInTheDocument()
    expect(screen.queryByText('旧目标')).not.toBeInTheDocument()
  })

  it('确认期间目标已结束时阻止使用过期动作', async () => {
    mocks.goals.mockResolvedValueOnce({ goals: [goal()] }).mockResolvedValue({ goals: [goal({ status: 'completed' })] })
    const result = render(view())
    fireEvent.click(await screen.findByRole('button', { name: '从第 2 步继续' }))
    fireEvent(window, new Event('af:refresh'))
    await waitFor(() => expect(result.container.querySelector('.mcbot-goal-completed')).toBeInTheDocument())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(mocks.goalAction).not.toHaveBeenCalled()
    expect(await screen.findByText('目标状态已更新，请查看当前状态后重试')).toBeInTheDocument()
  })

  it('读取失败可见且只读模式不创建计划', async () => {
    mocks.goals.mockRejectedValueOnce(new Error('服务不可达'))
    render(view(false))
    expect(await screen.findByText('长期目标读取失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建计划' })).toBeDisabled()
    expect(mocks.createGoal).not.toHaveBeenCalled()
  })
})
