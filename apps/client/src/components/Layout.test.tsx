/** 导航回归：移动端四入口、更多子页高亮及 Android 返回关闭抽屉，侧栏保留完整导航。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { lazy } from 'react'
import type { ReactElement } from 'react'
import { Layout } from './Layout'
import { More } from '../pages/More'
import { ToastProvider } from './Toast'
import { handleOverlayBack } from '../lib/navigation-guard'

const meta = vi.hoisted(() => ({ sharesEnabled: true }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { username: '测试用户' }, logout: vi.fn() }) }))
vi.mock('../meta/MetaContext', () => ({ useAppMeta: () => ({ meta }) }))
vi.mock('./PwaInstallPrompt', () => ({ PwaInstallPrompt: () => null }))
vi.mock('./PwaUpdatePrompt', () => ({ PwaUpdatePrompt: () => null }))

function renderLayout(entry = '/knowledge') {
  return render(<ToastProvider><MemoryRouter initialEntries={[entry]}><Routes><Route element={<Layout />}><Route path="/more" element={<More />} /><Route path="*" element={<p>页面内容</p>} /></Route></Routes></MemoryRouter></ToastProvider>)
}
afterEach(() => { cleanup(); meta.sharesEnabled = true })

describe('客户端导航', () => {
  it('页面代码加载期间保留侧栏和底部导航', async () => {
    let finish: () => void = () => undefined
    const AsyncPage = lazy(() => new Promise<{ default: () => ReactElement }>((resolve) => { finish = () => resolve({ default: () => <p>异步页面内容</p> }) }))
    render(<ToastProvider><MemoryRouter><Routes><Route element={<Layout />}><Route path="/" element={<AsyncPage />} /></Route></Routes></MemoryRouter></ToastProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载页面…')
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '底部导航' })).toBeInTheDocument()
    await act(async () => { finish() })
    expect(await screen.findByText('异步页面内容')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('移动底栏仅有首页、文件、MC、更多，次级页面高亮更多', () => {
    renderLayout()
    const bottom = within(screen.getByRole('navigation', { name: '底部导航' }))
    expect(bottom.getAllByRole('link').map((link) => link.textContent)).toEqual(['首页', '文件', 'MC', '更多'])
    expect(bottom.getByRole('link', { name: '更多' })).toHaveClass('bottom-tab-active')
    expect(bottom.getByRole('link', { name: '更多' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: '知识库' })).toBeInTheDocument()
  })

  it('更多页列出六项功能并遵守分享开关', () => {
    meta.sharesEnabled = false
    renderLayout('/more')
    const more = within(screen.getByRole('navigation', { name: '更多功能' }))
    expect(more.getAllByRole('link')).toHaveLength(5)
    expect(more.queryByRole('link', { name: /分享/ })).not.toBeInTheDocument()
    expect(more.getByRole('link', { name: /设置/ })).toHaveAttribute('href', '/settings')
  })

  it('返回操作优先关闭抽屉并释放滚动锁', () => {
    renderLayout()
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }))
    expect(screen.getByRole('dialog', { name: '导航菜单' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    act(() => { expect(handleOverlayBack()).toBe(true) })
    expect(screen.queryByRole('dialog', { name: '导航菜单' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(handleOverlayBack()).toBe(false)
  })
})
