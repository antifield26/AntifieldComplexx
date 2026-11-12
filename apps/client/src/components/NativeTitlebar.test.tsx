/** 标题栏回归：只在 Windows 原生壳加载窗口能力，操作失败可见，异步监听在卸载后释放。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NativeTitlebar } from './NativeTitlebar'

const mocks = vi.hoisted(() => ({
  native: false, getCurrentWindow: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(),
  isMaximized: vi.fn(), close: vi.fn(), startDragging: vi.fn(), onResized: vi.fn(), unlisten: vi.fn(),
}))
vi.mock('../lib/native', () => ({ isNativeRuntime: () => mocks.native }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getCurrentWindow }))

function renderTitlebar() {
  return render(<MemoryRouter initialEntries={['/files']}><NativeTitlebar /></MemoryRouter>)
}
beforeEach(() => {
  mocks.native = false
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  mocks.getCurrentWindow.mockReturnValue(mocks)
  mocks.isMaximized.mockResolvedValue(false)
  mocks.minimize.mockResolvedValue(undefined)
  mocks.toggleMaximize.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
  mocks.startDragging.mockResolvedValue(undefined)
  mocks.onResized.mockResolvedValue(mocks.unlisten)
})
afterEach(cleanup)

describe('Windows 自绘标题栏', () => {
  it('浏览器和 Android 不创建窗口控制', () => {
    const browser = renderTitlebar()
    expect(screen.queryByLabelText('应用窗口')).not.toBeInTheDocument()
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled()
    browser.unmount()
    mocks.native = true
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 16)')
    renderTitlebar()
    expect(screen.queryByLabelText('应用窗口')).not.toBeInTheDocument()
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled()
  })

  it('Windows 显示当前页并调用最小化、最大化和关闭', async () => {
    mocks.native = true
    const result = renderTitlebar()
    await waitFor(() => expect(screen.getByRole('button', { name: '最小化' })).toBeEnabled())
    expect(document.body).toHaveClass('native-windows')
    expect(screen.getByText('文件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    await waitFor(() => expect(mocks.minimize).toHaveBeenCalledOnce())
    mocks.isMaximized.mockResolvedValue(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '最大化' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    expect(await screen.findByRole('button', { name: '还原窗口' })).toBeInTheDocument()
    expect(mocks.toggleMaximize).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce())
    result.unmount()
    expect(document.body).not.toHaveClass('native-windows')
    expect(mocks.unlisten).toHaveBeenCalledOnce()
  })

  it('窗口操作失败时给出可见提示并允许重试', async () => {
    mocks.native = true
    mocks.minimize.mockRejectedValueOnce(new Error('permission denied'))
    renderTitlebar()
    await waitFor(() => expect(screen.getByRole('button', { name: '最小化' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    expect(await screen.findByRole('status')).toHaveTextContent('窗口操作失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    await waitFor(() => expect(mocks.minimize).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('permission denied')).not.toBeInTheDocument()
  })

  it('异步监听注册晚于卸载时仍立即解除', async () => {
    mocks.native = true
    let finish: (value: () => void) => void = () => undefined
    mocks.onResized.mockReturnValue(new Promise<() => void>((resolve) => { finish = resolve }))
    const result = renderTitlebar()
    await waitFor(() => expect(mocks.onResized).toHaveBeenCalledOnce())
    result.unmount()
    finish(mocks.unlisten)
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledOnce())
  })
})
