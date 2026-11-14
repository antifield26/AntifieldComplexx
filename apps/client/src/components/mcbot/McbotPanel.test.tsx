import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  McbotAutonomySnapshot,
  McbotHistory,
  McbotHistoryAlert,
  McbotHistoryQuery,
  McbotHistorySample,
  McbotSnapshot,
  McbotStatus,
  McbotTask,
  McbotTaskProgress,
} from '../../api/types'
import { ToastProvider } from '../Toast'
import { McbotPanel } from './McbotPanel'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  history: vi.fn(),
  presence: vi.fn(),
  setPresence: vi.fn(),
  chat: vi.fn(),
  chatState: vi.fn(),
  emergencyStop: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  api: {
    mcbot: {
      status: mocks.status,
      history: mocks.history,
      presence: mocks.presence,
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

function autonomySnapshot(overrides: Partial<McbotAutonomySnapshot> = {}): McbotAutonomySnapshot {
  return {
    enabled: true,
    active: true,
    state: 'running',
    goal: '收集小麦并存入箱子',
    startedAt: '2026-10-28T00:01:00.000Z',
    elapsedSec: 42,
    remainingSec: 600,
    toolCalls: 3,
    maxToolCalls: 12,
    lastAction: 'gather_wheat',
    lastReason: '需要食物',
    lastError: null,
    lastDecisionAt: '2026-10-28T00:01:30.000Z',
    ...overrides,
  }
}

function sample(): McbotHistorySample {
  return {
    ts: '2026-10-27T07:59:00.000Z',
    connected: true,
    state: 'connected',
    taskName: 'fishing',
    taskState: 'running',
    health: 20,
    food: 18,
    memoryMb: 45,
    tps: 19.7,
    queueLen: 0,
    rssMb: 120,
  }
}

function alert(): McbotHistoryAlert {
  return {
    id: 1,
    ts: '2026-10-27T07:30:00.000Z',
    type: 'low_health',
    severity: 'warning',
    message: 'mcbot 血量偏低：8/20',
    details: {},
  }
}

function alertsResult(): McbotHistory {
  return { kind: 'alerts', from: null, to: null, count: 1, alerts: [alert()] }
}

function samplesResult(): McbotHistory {
  return { kind: 'samples', from: null, to: null, count: 1, samples: [sample()] }
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
  mocks.presence.mockResolvedValue({ presence: { mode: 'auto', source: 'default', updatedAt: null, connected: true, lastDecision: '' } })
  mocks.history.mockImplementation(async (query: McbotHistoryQuery) =>
    query.kind === 'samples' ? samplesResult() : alertsResult(),
  )
  mocks.chatState.mockResolvedValue({ messages: [], turn: null })
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
    expect(screen.queryByLabelText('管理员对话')).toBeNull()
    expect(mocks.history).not.toHaveBeenCalled()
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
    expect(screen.getByText('2 / 6')).toBeTruthy()
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
    expect(await screen.findByText('mcbot 状态')).toBeTruthy()
    expect(screen.getAllByText('事件流').length).toBeGreaterThan(0)
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
    expect(screen.getByLabelText('管理员对话')).toBeDisabled()
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
    const input = await screen.findByLabelText('管理员对话')
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
    const input = await screen.findByLabelText('管理员对话')
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
    expect(await screen.findByText(/需升级到 v0.6.0 才能显示事件流/)).toBeTruthy()
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

  it('只读展示自主会话状态，没有启动按钮', async () => {
    mocks.status.mockResolvedValue(snapshot({ autonomy: autonomySnapshot() }))
    renderPanel()
    expect(await screen.findByText('运行中')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '启动自主模式' })).toBeNull()
    expect(screen.queryByLabelText('任务')).toBeNull()
  })
})

describe('McbotPanel 历史记录', () => {
  it('默认加载最近 24 小时告警，切换采样后表格更新', async () => {
    renderPanel()
    // Table 同时渲染桌面表格与移动端卡片，文本会出现两次。
    expect((await screen.findAllByText('mcbot 血量偏低：8/20')).length).toBeGreaterThan(0)

    const firstQuery = mocks.history.mock.calls[0]?.[0] as McbotHistoryQuery
    expect(firstQuery.kind).toBe('alerts')
    expect(firstQuery.limit).toBe(100)
    const windowMs = Date.parse(firstQuery.to ?? '') - Date.parse(firstQuery.from ?? '')
    expect(windowMs).toBe(24 * 60 * 60 * 1000)

    await userEvent.click(screen.getByRole('button', { name: '采样' }))
    await waitFor(() => {
      const lastQuery = mocks.history.mock.calls[mocks.history.mock.calls.length - 1]?.[0] as McbotHistoryQuery
      expect(lastQuery.kind).toBe('samples')
    })
    expect((await screen.findAllByText('钓鱼 · 进行中')).length).toBeGreaterThan(0)
  })
})
