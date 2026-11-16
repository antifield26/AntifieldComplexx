import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  McbotChatStep,
  McbotSnapshot,
  McbotStatus,
  McbotTask,
  McbotTaskProgress,
} from '../../api/types'
import { ToastProvider } from '../Toast'
import { McbotPanel } from './McbotPanel'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  setPresence: vi.fn(),
  chat: vi.fn(),
  chatState: vi.fn(),
  emergencyStop: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  api: {
    mcbot: {
      status: mocks.status,
      setPresence: mocks.setPresence,
      chat: mocks.chat,
      chatState: mocks.chatState,
      emergencyStop: mocks.emergencyStop,
    },
  },
  // 测试只需按 code 判断降级；非 ApiError 返回 false。
  isApiError: (error: unknown, code?: string) => {
    const record = error as { code?: unknown } | null
    return Boolean(
      record &&
        typeof record.code === 'string' &&
        (code === undefined || record.code === code),
    )
  },
  toErrorMessage: (error: unknown, fallback = '') =>
    error instanceof Error && error.message ? error.message : fallback,
  isAbortError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'),
}))

function progress(overrides: Partial<McbotTaskProgress> = {}): McbotTaskProgress {
  return {
    fishCaught: 0,
    wheatHarvested: 0,
    planted: 0,
    deposited: 0,
    treesChopped: 0,
    logsChopped: 0,
    saplingsPlanted: 0,
    mobsKilled: 0,
    oresMined: 0,
    coalMined: 0,
    ironMined: 0,
    copperMined: 0,
    forestTreesChopped: 0,
    naturalLogsChopped: 0,
    naturalSaplingsPlanted: 0,
    sleepVotes: 0,
    nightSkipped: 0,
    patrolWaypoints: 0,
    patrolDistance: 0,
    ...overrides,
  }
}

function idleTask(overrides: Partial<McbotTask> = {}): McbotTask {
  return {
    enabled: true,
    active: false,
    name: null,
    state: 'idle',
    startedAt: null,
    elapsedSec: 0,
    progress: progress(),
    failures: 0,
    lastError: null,
    pendingResume: null,
    queue: [],
    ...overrides,
  }
}

function activeTask(overrides: Partial<McbotTask> = {}): McbotTask {
  return idleTask({
    active: true,
    name: 'fishing',
    state: 'running',
    startedAt: '2026-10-27T07:00:00.000Z',
    elapsedSec: 170,
    progress: progress({ fishCaught: 5 }),
    ...overrides,
  })
}

function mcbotStatus(overrides: Partial<McbotStatus> = {}): McbotStatus {
  return {
    version: '0.6.0',
    uptimeSec: 3600,
    state: 'connected',
    minecraft: {
      connected: true,
      username: 'mcbot',
      host: '127.0.0.1',
      port: 25565,
      version: '26.1',
      reconnects: 0,
      lastDisconnect: null,
    },
    player: { dimension: '主世界', position: { x: 204.5, y: 63, z: 469.5 }, health: 20, food: 19 },
    server: {
      reachable: true,
      online: 2,
      max: 6,
      versionName: 'Paper 26.1.2',
      motd: 'Raspberry Pi 5 | Minecraft LAN',
      latencyMs: 5,
      lastPingAt: '2026-10-27T07:59:00.000Z',
    },
    presence: {
      enabled: true,
      mode: 'auto',
      modeSource: 'default',
      modeUpdatedAt: null,
      pollMs: 15000,
      graceMs: 60000,
      checkMs: 5000,
      otherPlayers: 1,
      lastDecision: 'connected',
    },
    ai: {
      enabled: true,
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      inFlight: 0,
      queued: 1,
      failures: 2,
      lastLatencyMs: 2359,
      lastError: null,
    },
    memory: { players: 1, turns: 4 },
    task: idleTask(),
    survival: { enabled: true, lastRunAt: null, lastAction: null, lastError: null },
    admin: {
      enabled: true,
      rcon: true,
      updatedAt: '2026-10-27T07:59:00.000Z',
      lastError: null,
      tps: { one: 19.6, five: 19.8, fifteen: 19.9 },
      online: { count: 2, max: 6, players: ['Antifield', 'mcbot'] },
      whitelist: { count: 6, names: ['mcbot', 'Antifield'] },
      time: { ticks: 21461, label: '03:27' },
      backup: { status: 'unknown' },
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<McbotSnapshot> = {}): McbotSnapshot {
  return {
    enabled: true,
    reachable: true,
    stale: false,
    controlEnabled: true,
    sayEnabled: true,
    alertsEnabled: true,
    version: '1.0.8',
    contractVersion: 2,
    eventsSupported: true,
    lastPollAt: '2026-10-27T08:00:00.000Z',
    error: null,
    status: mcbotStatus(),
    events: [],
    ...overrides,
  }
}

function chatSteps(): McbotChatStep[] {
  return [
    { kind: 'user', text: '去砍点木头' },
    { kind: 'assistant', text: '我先看一下周围。' },
    { kind: 'tool', name: 'observe', status: 'ok' },
    { kind: 'goal', action: 'start', title: '砍木头' },
    { kind: 'todo', action: 'add', title: '存箱' },
  ]
}

function renderPanel() {
  return render(
    <ToastProvider>
      <McbotPanel />
    </ToastProvider>,
  )
}

beforeEach(() => {
  mocks.status.mockResolvedValue(snapshot())
  mocks.chatState.mockResolvedValue({ messages: [], steps: [], turn: null })
  mocks.chat.mockResolvedValue({ ok: true, turnId: 'turn-1', status: 'pending' })
  mocks.emergencyStop.mockResolvedValue({ ok: true, failures: [] })
  mocks.setPresence.mockResolvedValue({ presence: { mode: 'always', source: 'persisted', updatedAt: null, connected: true, lastDecision: '' } })
})

afterEach(cleanup)

describe('McbotPanel 状态与降级', () => {
  it('mcbot 集成未启用时只显示说明，不渲染控制与历史', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ enabled: false, reachable: false, status: null, events: [] }),
    )
    renderPanel()
    expect(await screen.findByText(/mcbot 集成未启用/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '急停' })).toBeNull()
    expect(screen.queryByLabelText('会话内容')).toBeNull()
    expect(screen.queryByText('用一句话生成草案')).toBeNull()
    expect(screen.queryByRole('button', { name: '采样' })).toBeNull()
  })

  it('不可达且数据过期时显示中文警告并保留缓存状态', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ reachable: false, stale: true, error: 'mcbot_unavailable' }),
    )
    renderPanel()
    expect(await screen.findByText(/无法连接 mcbot：mcbot 服务不可达/)).toBeTruthy()
    expect(screen.getByText(/mcbot 数据已过期/)).toBeTruthy()
    expect(screen.getByText(/尚无成功轮询/)).toBeTruthy()
    // 缓存的状态数据仍然展示
    expect(screen.getByText('已连接（mcbot）')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('19')).toBeTruthy()
  })

  it('首次轮询完成前只提示等待，不误报不可达', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ reachable: false, status: null, events: [], lastPollAt: null, error: null }),
    )
    renderPanel()
    expect(await screen.findByText(/正在等待 mcbot 首次轮询结果/)).toBeTruthy()
    expect(screen.queryByText(/无法连接 mcbot/)).toBeNull()
  })

  it('上游 status 缺嵌套段时容忍缺失，不让整个面板崩溃', async () => {
    mocks.status.mockResolvedValue(snapshot({ status: {} as McbotStatus }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Bot 状态' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: '事件记录' }).length).toBeGreaterThan(0)
  })

  it('事件缺口提示保留当前 Bot 状态', async () => {
    mocks.status.mockResolvedValue(
      snapshot({
        eventGap: { bootId: 'b1', fromSeq: 2, toSeq: 201, discoveredAt: '2026-10-27T08:00:00.000Z' },
      }),
    )
    renderPanel()
    expect(await screen.findByText(/缺少序号 2–201/)).toBeTruthy()
    expect(screen.getByText('已连接（mcbot）')).toBeTruthy()
  })

  it('status 可达但事件轮询/游标失败时显示可见警告', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ reachable: true, error: 'mcbot_upstream_error', eventsSupported: true }),
    )
    renderPanel()
    expect(await screen.findByText(/事件流\/告警游标异常/)).toBeTruthy()
    expect(screen.getByText(/事件流可能停止更新/)).toBeTruthy()
  })

  it('刷新失败时保留上次成功的数据并提示', async () => {
    mocks.status
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('mcbot 不可达'))
    renderPanel()
    expect(await screen.findByText('已连接（mcbot）')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '刷新 mcbot 状态' }))
    expect(await screen.findByText(/显示上次成功获取的数据/)).toBeTruthy()
    expect(screen.getByText('已连接（mcbot）')).toBeTruthy()
  })

  it('控制未启用时禁用对话和急停', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ controlEnabled: false, status: mcbotStatus({ task: activeTask() }) }),
    )
    renderPanel()
    expect(await screen.findByText(/对话和急停已禁用/)).toBeTruthy()
    expect(screen.getByLabelText('会话内容')).toBeDisabled()
    expect(screen.getByRole('button', { name: '常驻在线' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '急停' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '开始任务' })).toBeNull()
    expect(screen.queryByRole('button', { name: '回家' })).toBeNull()
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.emergencyStop).not.toHaveBeenCalled()
  })
})

describe('McbotPanel 管理员对话', () => {
  it('发送一句话，允许斜杠，不调用旧写接口', async () => {
    renderPanel()
    const input = await screen.findByLabelText('会话内容')
    await userEvent.type(input, '去附近砍点木头 / 然后回家')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledWith('去附近砍点木头 / 然后回家'))
    expect(screen.queryByRole('button', { name: '开始任务' })).toBeNull()
    expect(screen.queryByRole('button', { name: '启动自主模式' })).toBeNull()
  })

  it('急停需要二次确认，且不发送对话', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '急停' }))
    const dialog = await screen.findByRole('dialog', { name: '急停' })
    expect(within(dialog).getByText(/不经过模型|已经发生的世界动作不会回滚/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: '急停' }))
    await waitFor(() => expect(mocks.emergencyStop).toHaveBeenCalledOnce())
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(await screen.findByText('已急停')).toBeTruthy()
  })

  it('取消急停确认不会发出请求', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '急停' }))
    const dialog = await screen.findByRole('dialog', { name: '急停' })
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(mocks.emergencyStop).not.toHaveBeenCalled()
  })

  it('控制字符留在本地，不调用接口', async () => {
    renderPanel()
    const input = await screen.findByLabelText('会话内容')
    fireEvent.change(input, { target: { value: 'hello\u0000world' } })
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText(/控制字符/)).toBeTruthy()
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})

describe('McbotPanel 事件流', () => {
  it('聊天事件以纯文本展示，其余事件显示结构化摘要并支持筛选', async () => {
    mocks.status.mockResolvedValue(
      snapshot({
        events: [
          {
            id: 'boot-1',
            type: 'chat',
            ts: '2026-10-27T07:59:00.000Z',
            data: { direction: 'out', text: '好，我去钓鱼啦。', source: 'ai' },
          },
          {
            id: 'boot-2',
            type: 'task',
            ts: '2026-10-27T07:58:00.000Z',
            data: { action: 'started', task: { name: 'fishing', state: 'running' } },
          },
        ],
      }),
    )
    renderPanel()
    expect(await screen.findByText('mcbot：好，我去钓鱼啦。')).toBeTruthy()
    expect(screen.getByText(/任务已开始 · 钓鱼 · 进行中/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '聊天' }))
    expect(screen.getByText('mcbot：好，我去钓鱼啦。')).toBeTruthy()
    expect(screen.queryByText(/任务已开始 · 钓鱼 · 进行中/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText(/任务已开始 · 钓鱼 · 进行中/)).toBeTruthy()
  })

  it('旧版 mcbot 不支持事件时显示升级提示', async () => {
    mocks.status.mockResolvedValue(
      snapshot({ contractVersion: null, eventsSupported: false, events: [] }),
    )
    renderPanel()
    expect(await screen.findByText(/需升级到 v0.6.0 才能显示事件记录/)).toBeTruthy()
  })
})

describe('McbotPanel 自主事件', () => {
  it('事件流包含 autonomy 事件与「自主」筛选', async () => {
    mocks.status.mockResolvedValue(
      snapshot({
        events: [
          {
            id: 'boot-auto-1',
            type: 'autonomy',
            ts: '2026-10-28T00:02:00.000Z',
            data: { state: 'running', action: 'gather_wheat' },
          },
        ],
      }),
    )
    renderPanel()
    expect(await screen.findByText(/自主模式 · 运行中 · gather_wheat/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '自主' }))
    expect(screen.getByText(/自主模式 · 运行中 · gather_wheat/)).toBeTruthy()
  })

  it('没有自主模式启动按钮，也不展示目标草案', async () => {
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Bot 状态' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '启动自主模式' })).toBeNull()
    expect(screen.queryByText('用一句话生成草案')).toBeNull()
    expect(screen.queryByLabelText('任务')).toBeNull()
  })
})

describe('McbotPanel 会话时间线', () => {
  it('三块都在，历史卡和目标草案不在', async () => {
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Bot 状态' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '会话' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '事件记录' })).toBeTruthy()
    expect(screen.queryByText('用一句话生成草案')).toBeNull()
    expect(screen.queryByRole('button', { name: '采样' })).toBeNull()
    expect(screen.queryByText('事件与历史')).toBeNull()
  })

  it('空时间线有明确空状态', async () => {
    renderPanel()
    expect(await screen.findByText('还没有会话。')).toBeTruthy()
  })

  it('按五类步骤渲染时间线，不展示工具参数和结果正文', async () => {
    mocks.chatState.mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', text: '这条 messages 正文不应单独出现', at: '2026-11-16T00:00:00.000Z' }],
      steps: [
        ...chatSteps(),
        {
          kind: 'tool',
          name: 'memory_read',
          status: 'error',
          arguments: { token: 'secret-token-value' },
          result: '提示词正文不应出现',
        },
      ],
      turn: null,
    })
    renderPanel()
    expect(await screen.findByText('去砍点木头')).toBeTruthy()
    expect(screen.getByText('我先看一下周围。')).toBeTruthy()
    expect(screen.getByText('observe · 成功')).toBeTruthy()
    expect(screen.getByText('start · 砍木头')).toBeTruthy()
    expect(screen.getByText('add · 存箱')).toBeTruthy()
    expect(screen.getByText('memory_read · 失败')).toBeTruthy()
    expect(screen.getByText('你')).toBeTruthy()
    expect(screen.getByText('助手')).toBeTruthy()
    expect(screen.getAllByText('工具').length).toBeGreaterThan(0)
    expect(screen.getByText('目标')).toBeTruthy()
    expect(screen.getByText('待办')).toBeTruthy()
    expect(screen.queryByText('secret-token-value')).toBeNull()
    expect(screen.queryByText('提示词正文不应出现')).toBeNull()
    expect(screen.queryByText('这条 messages 正文不应单独出现')).toBeNull()
  })

  it('进行中按 1 秒轮询会话，空闲按 5 秒', async () => {
    vi.useFakeTimers()
    mocks.chatState.mockResolvedValue({
      messages: [],
      steps: [],
      turn: { id: 'turn-1', status: 'pending', error: null },
    })
    try {
      renderPanel()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('正在根据这句话决定是否行动。')).toBeTruthy()
      const pendingBaseline = mocks.chatState.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mocks.chatState.mock.calls.length).toBeGreaterThan(pendingBaseline)

      mocks.chatState.mockResolvedValue({ messages: [], steps: [], turn: null })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.getByText('还没有会话。')).toBeTruthy()
      const idleBaseline = mocks.chatState.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mocks.chatState.mock.calls.length).toBe(idleBaseline)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(mocks.chatState.mock.calls.length).toBeGreaterThan(idleBaseline)
    } finally {
      vi.useRealTimers()
    }
  })

  it('确认后才切换在线模式', async () => {
    renderPanel()
    expect(await screen.findByRole('button', { name: '自动在线' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '常驻在线' }))
    expect(mocks.setPresence).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: '切换在线模式' })
    await userEvent.click(within(dialog).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(mocks.setPresence).toHaveBeenCalledWith('always'))
  })

  it('急停成功后按后续会话响应清空时间线', async () => {
    let stopped = false
    mocks.chatState.mockImplementation(async () => (
      stopped
        ? { messages: [], steps: [], turn: null }
        : { messages: [], steps: chatSteps(), turn: null }
    ))
    mocks.emergencyStop.mockImplementation(async () => {
      stopped = true
      return { ok: true, failures: [] }
    })
    renderPanel()
    expect(await screen.findByText('去砍点木头')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '急停' }))
    const dialog = await screen.findByRole('dialog', { name: '急停' })
    await userEvent.click(within(dialog).getByRole('button', { name: '急停' }))
    await waitFor(() => expect(mocks.emergencyStop).toHaveBeenCalledOnce())
    expect(await screen.findByText('还没有会话。')).toBeTruthy()
    expect(screen.queryByText('去砍点木头')).toBeNull()
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})
