import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './AuthContext'
import { setNativeBridgeForTests, type NativeBridge } from '../lib/native'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span>{auth.status}</span>
      <button type="button" onClick={() => void auth.completeTotp('challenge-1', '123456').catch(() => undefined)}>
        登录
      </button>
      <button type="button" onClick={() => void auth.logout()}>
        退出
      </button>
    </div>
  )
}

describe('客户端登录', () => {
  const bridge: NativeBridge = {
    isNative: true,
    prepareDevice: vi.fn(),
    storeSession: vi.fn(),
    clearSession: vi.fn(),
    clearDevice: vi.fn(),
    signRequest: vi.fn(),
    hasSession: vi.fn(),
    openAiWorkspace: vi.fn(),
  }

  beforeEach(() => {
    vi.mocked(bridge.prepareDevice).mockReset()
    vi.mocked(bridge.storeSession).mockReset()
    vi.mocked(bridge.clearSession).mockReset()
    vi.mocked(bridge.clearDevice).mockReset()
    vi.mocked(bridge.signRequest).mockReset()
    vi.mocked(bridge.hasSession).mockReset()
    vi.mocked(bridge.openAiWorkspace).mockReset()
    vi.mocked(bridge.hasSession).mockResolvedValue(false)
    vi.mocked(bridge.prepareDevice).mockResolvedValue({
      publicKey: 'a'.repeat(43),
      platform: 'windows',
      suggestedName: '这台 Windows',
    })
    vi.mocked(bridge.storeSession).mockResolvedValue(undefined)
    vi.mocked(bridge.clearSession).mockResolvedValue(undefined)
    vi.mocked(bridge.clearDevice).mockResolvedValue(undefined)
    vi.mocked(bridge.signRequest).mockResolvedValue(null)
    setNativeBridgeForTests(bridge)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('没有本地会话时不请求 /me', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('登录登记设备并先写入会话令牌', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/totp')) {
        return json(200, {
          user: { username: 'antifield' },
          csrfToken: 'csrf-1',
          sessionToken: 'session-1',
          expiresAt: '2026-11-18T00:00:00.000Z',
          device: { id: 'device-1', name: '这台 Windows', platform: 'windows' },
        })
      }
      return json(200, {
        user: { username: 'antifield' },
        csrfToken: 'csrf-1',
        session: { createdAt: 't', expiresAt: 't', ip: '127.0.0.1', userAgent: null },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await screen.findByText('anonymous')
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())
    const loginCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/auth/totp'))
    const init = loginCall?.[1]
    const body = JSON.parse(String(init?.body)) as { device: { publicKey: string; appVersion: string; name: string } }
    expect(body.device.publicKey).toBe('a'.repeat(43))
    expect(body.device.appVersion).toBe('1.2.0')
    expect(body.device.name).toBe('这台 Windows')
    expect(init?.credentials).toBe('omit')
    expect(bridge.storeSession).toHaveBeenCalledWith('session-1', 'device-1')
    await user.click(screen.getByRole('button', { name: '退出' }))
    await waitFor(() => expect(bridge.clearSession).toHaveBeenCalled())
    expect(bridge.clearDevice).not.toHaveBeenCalled()
  })

  it('登录响应没有设备会话时保持未登录', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { user: { username: 'antifield' }, csrfToken: 'csrf-1' })))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await screen.findByText('anonymous')
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(bridge.prepareDevice).toHaveBeenCalled())
    expect(bridge.storeSession).not.toHaveBeenCalled()
    expect(screen.getByText('anonymous')).toBeInTheDocument()
  })

  it('已吊销密钥在登录失败时清除', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: { code: 'device_revoked', message: '设备已吊销' } })),
    )
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await screen.findByText('anonymous')
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(bridge.clearDevice).toHaveBeenCalled())
    expect(screen.getByText('anonymous')).toBeInTheDocument()
  })
})
