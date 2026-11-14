/** 在线模式卡：只切换 auto/always/off，不再创建或开始长期目标。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../Toast'
import { McbotPresenceGoalsCard } from './McbotPresenceGoalsCard'

const mocks = vi.hoisted(() => ({ presence: vi.fn(), setPresence: vi.fn() }))
vi.mock('../../api/client', () => ({
  api: { mcbot: mocks },
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  isApiError: () => false,
  toErrorMessage: (error: unknown, fallback = '') => error instanceof Error ? error.message : fallback,
}))

function view(controlReady = true) {
  return <ToastProvider><McbotPresenceGoalsCard controlReady={controlReady} /></ToastProvider>
}

beforeEach(() => {
  mocks.presence.mockResolvedValue({
    presence: { mode: 'auto', source: 'default', updatedAt: null, connected: true, lastDecision: '' },
  })
  mocks.setPresence.mockResolvedValue({
    presence: { mode: 'always', source: 'persisted', updatedAt: '2026-11-14T00:00:00.000Z', connected: true, lastDecision: '' },
  })
})

afterEach(cleanup)

describe('在线模式', () => {
  it('确认后才切换，且没有目标写入按钮', async () => {
    render(view())
    expect(await screen.findByRole('button', { name: '自动在线' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '创建计划' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '常驻在线' }))
    expect(mocks.setPresence).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: '切换在线模式' })
    await userEvent.click(within(dialog).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(mocks.setPresence).toHaveBeenCalledWith('always'))
  })

  it('只读时不能切换', async () => {
    render(view(false))
    expect(await screen.findByRole('button', { name: '常驻在线' })).toBeDisabled()
    expect(mocks.setPresence).not.toHaveBeenCalled()
  })
})
