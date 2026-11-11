import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../../api/client'
import { ToastProvider } from '../Toast'
import { DeviceList } from './DeviceList'

const clearSession = vi.hoisted(() => vi.fn())
const clearNativeDevice = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../api/client', () => ({
  api: {
    devices: {
      list: vi.fn(),
      rename: vi.fn(),
      revoke: vi.fn(),
    },
  },
  toErrorMessage: (error: unknown, fallback = '操作失败') => (error instanceof Error ? error.message : fallback),
}))

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ clearSession }),
}))

vi.mock('../../lib/native', () => ({
  clearNativeDevice,
}))

const current = {
  id: 'device-current',
  name: '这台 Windows',
  platform: 'windows' as const,
  appVersion: '1.1.1',
  online: true,
  lastSeenAt: '2026-11-11T00:00:00.000Z',
  current: true,
}

const other = {
  id: 'device-other',
  name: '手机',
  platform: 'android' as const,
  appVersion: '1.1.1',
  online: false,
  lastSeenAt: null,
  current: false,
}

function renderList(): void {
  render(
    <ToastProvider>
      <DeviceList />
    </ToastProvider>,
  )
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  clearSession.mockReset()
  clearNativeDevice.mockClear()
  vi.mocked(api.devices.list).mockReset()
  vi.mocked(api.devices.rename).mockReset()
  vi.mocked(api.devices.revoke).mockReset()
  vi.mocked(api.devices.list).mockResolvedValue({ devices: [current, other] })
  vi.mocked(api.devices.rename).mockResolvedValue({ ok: true })
  vi.mocked(api.devices.revoke).mockResolvedValue({ ok: true })
})

describe('DeviceList', () => {
  it('展示在线状态，并保存新名称', async () => {
    const user = userEvent.setup()
    renderList()
    expect(await screen.findByText('在线')).toBeInTheDocument()
    expect(screen.getByText('离线')).toBeInTheDocument()
    const input = screen.getByLabelText('手机 的名称')
    await user.clear(input)
    await user.type(input, '客厅手机')
    await user.click(screen.getAllByRole('button', { name: '保存' })[1]!)
    expect(api.devices.rename).toHaveBeenCalledWith('device-other', '客厅手机')
  })

  it('吊销其他设备只调用吊销接口', async () => {
    const user = userEvent.setup()
    renderList()
    await screen.findByText('手机')
    await user.click(screen.getAllByRole('button', { name: '吊销' })[1]!)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '吊销' }))
    expect(api.devices.revoke).toHaveBeenCalledWith('device-other')
    expect(clearNativeDevice).not.toHaveBeenCalled()
    expect(clearSession).not.toHaveBeenCalled()
  })

  it('吊销当前设备后清本地密钥和会话', async () => {
    const user = userEvent.setup()
    renderList()
    await screen.findByText('当前设备')
    await user.click(screen.getAllByRole('button', { name: '吊销' })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('吊销后这台设备需要重新登录，本机会退出。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '吊销' }))
    expect(api.devices.revoke).toHaveBeenCalledWith('device-current')
    expect(clearNativeDevice).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledTimes(1)
  })
})
