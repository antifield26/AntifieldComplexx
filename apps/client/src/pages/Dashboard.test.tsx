/** 首页回归：入口与异常先于详情，原生 AI 走窗口桥接，重叠刷新失败不会留下永久加载态。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DashboardData } from '../api/types'
import { ToastProvider } from '../components/Toast'
import { Dashboard } from './Dashboard'

const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), openAi: vi.fn(), native: false }))
vi.mock('../api/client', () => ({ api: { getDashboard: mocks.getDashboard }, toErrorMessage: (error: unknown, fallback = '') => error instanceof Error ? error.message : fallback }))
vi.mock('../lib/native', () => ({ isNativeRuntime: () => mocks.native }))
vi.mock('../lib/ai-workspace', () => ({ openNativeAiWorkspaceUrl: mocks.openAi }))
vi.mock('../meta/MetaContext', () => ({ useAppMeta: () => ({ meta: { aiOrigin: 'https://ai.example.test', schemaVersion: 21 } }) }))
vi.mock('../hooks/useBackups', () => ({ useBackups: () => ({ data: null, loading: false, error: null, errorStatus: null, refresh: vi.fn() }) }))
vi.mock('../components/dashboard/MetricsCharts', () => ({ MetricsCharts: () => <div data-testid="metrics">指标趋势</div> }))
vi.mock('../components/backups/BackupStatusCard', () => ({ BackupStatusCard: () => <span>备份详情</span> }))
vi.mock('../components/alerts/AlertsCard', () => ({ AlertsCard: () => <span>告警详情</span> }))

function dashboard(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    host: { hostname: '个人主机', uptimeSec: 3600, load: [0.1, 0.2, 0.3], cpuPercent: 15, mem: { totalBytes: 8e9, usedBytes: 2e9, availableBytes: 6e9 }, tempC: 48, root: { totalBytes: 1e11, usedBytes: 3e10, freeBytes: 7e10 } },
    storage: { quotaBytes: 1e10, usedBytes: 1e9, trashBytes: 0, fileCount: 15, freeBytes: 9e9 },
    minecraft: { online: true, version: '26.1.2', motd: '个人世界', players: { online: 1, max: 10, names: [] }, tps: { m1: 20, m5: 20, m15: 20 }, whitelistCount: 1, serviceActive: 'active', publicAddress: null, checkedAt: '2026-11-11T12:00:00.000Z', error: null },
    opencode: { reachable: false, url: '', sessions: null },
    dsh: { webUrl: 'https://ai.example.test', readiness: { dsh_web: true } },
    services: { minecraft: 'active', cloudflared: 'active', dsh_web: 'active' },
    backup: { lastPullAt: '2026-11-11T11:00:00.000Z', ageHours: 1, sizeBytes: 1e6, ok: true, overdue: false },
    activity: [], generatedAt: '2026-11-11T12:00:00.000Z', ...overrides,
  }
}
function renderDashboard() { return render(<ToastProvider><MemoryRouter><Dashboard /></MemoryRouter></ToastProvider>) }
beforeEach(() => { mocks.native = false; mocks.getDashboard.mockResolvedValue(dashboard()); mocks.openAi.mockResolvedValue(undefined) })
afterEach(cleanup)

describe('首页结构与状态', () => {
  it('常用入口和异常摘要先于关键指标，趋势位于详情之后', async () => {
    const result = renderDashboard()
    const launchpad = await screen.findByRole('region', { name: '常用入口' })
    expect(within(launchpad).getByRole('link', { name: /我的文件/ })).toHaveAttribute('href', '/files')
    expect(within(launchpad).getByRole('link', { name: /Minecraft/ })).toHaveAttribute('href', '/minecraft')
    const summary = screen.getByRole('region', { name: '异常摘要' })
    expect(summary).toHaveTextContent('暂无已知异常')
    const stats = result.container.querySelector('#host-status')!
    expect(launchpad.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(summary.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { name: '服务状态' }).compareDocumentPosition(screen.getByTestId('metrics')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('备份和服务异常在摘要中有明确处理入口', async () => {
    mocks.getDashboard.mockResolvedValue(dashboard({ backup: null, services: { minecraft: 'active', cloudflared: 'inactive' } }))
    renderDashboard()
    const summary = await screen.findByRole('region', { name: '异常摘要' })
    expect(within(summary).getByRole('link', { name: /备份尚无拉取记录/ })).toHaveAttribute('href', '/settings#backup')
    expect(within(summary).getByRole('link', { name: /1 项服务已停止/ })).toHaveAttribute('href', '/#service-status')
  })

  it('服务未知和主机内存紧张时不显示无异常摘要', async () => {
    const current = dashboard()
    mocks.getDashboard.mockResolvedValue(dashboard({
      services: { minecraft: 'active', cloudflared: 'unknown' },
      host: { ...current.host, mem: { totalBytes: 8e9, usedBytes: 7.6e9, availableBytes: 0.4e9 } },
    }))
    renderDashboard()
    const summary = await screen.findByRole('region', { name: '异常摘要' })
    expect(summary).toHaveTextContent('1 项服务状态待确认')
    expect(summary).toHaveTextContent('主机资源需要留意')
    expect(within(summary).queryByText('暂无已知异常')).not.toBeInTheDocument()
  })

  it('原生 AI 入口经受限桥接打开，失败显示可见提示', async () => {
    mocks.native = true
    mocks.openAi.mockRejectedValueOnce(new Error('工作区暂不可用'))
    renderDashboard()
    fireEvent.click(await screen.findByRole('link', { name: /AI 工作区/ }))
    await waitFor(() => expect(mocks.openAi).toHaveBeenCalledWith('https://ai.example.test'))
    expect(await screen.findByText('工作区暂不可用')).toBeInTheDocument()
  })

  it('首次加载与刷新重叠时，最新失败结束加载且慢旧响应不覆盖', async () => {
    let finishOld: (value: DashboardData) => void = () => undefined
    mocks.getDashboard.mockReturnValueOnce(new Promise<DashboardData>((resolve) => { finishOld = resolve }))
      .mockRejectedValueOnce(new Error('刷新暂不可用')).mockResolvedValue(dashboard())
    renderDashboard()
    await waitFor(() => expect(mocks.getDashboard).toHaveBeenCalledOnce())
    fireEvent(window, new Event('af:refresh'))
    expect(await screen.findByText('刷新暂不可用')).toBeInTheDocument()
    await act(async () => { finishOld(dashboard()) })
    expect(screen.queryByRole('region', { name: '常用入口' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByRole('region', { name: '常用入口' })).toBeInTheDocument()
  })
})
