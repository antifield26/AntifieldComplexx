import { describe, expect, it, vi } from 'vitest'
import { planJsonRequest } from './request-plan'

describe('planJsonRequest', () => {
  it('浏览器写请求带 Cookie 与 CSRF', async () => {
    const planned = await planJsonRequest({
      path: '/api/auth/logout',
      method: 'POST',
      bodyText: '{}',
      csrfToken: 'csrf-1',
      native: false,
      dev: true,
      origin: 'https://app.example.com',
      sign: null,
    })
    expect(planned.url).toBe('/api/auth/logout')
    expect(planned.credentials).toBe('include')
    expect(planned.headers['X-CSRF-Token']).toBe('csrf-1')
    expect(planned.headers.Authorization).toBeUndefined()
    expect(planned.body).toBe('{}')
  })

  it('客户端有会话时签名，并省略 Cookie 与 CSRF', async () => {
    const sign = vi.fn().mockResolvedValue({
      authorization: 'session-token',
      deviceId: 'device-1',
      timestamp: '1700000000',
      nonce: 'nonce-value-0123456789',
      signature: 'sig',
    })
    const planned = await planJsonRequest({
      path: '/api/devices/heartbeat',
      method: 'POST',
      bodyText: '{}',
      csrfToken: 'csrf-1',
      native: true,
      dev: false,
      origin: 'https://app.example.com',
      sign,
    })
    expect(sign).toHaveBeenCalledWith('POST', '/api/devices/heartbeat', '{}')
    expect(planned.url).toBe('https://app.example.com/api/devices/heartbeat')
    expect(planned.credentials).toBe('omit')
    expect(planned.headers.Authorization).toBe('Bearer session-token')
    expect(planned.headers['X-Device-Id']).toBe('device-1')
    expect(planned.headers['X-Device-Signature']).toBe('sig')
    expect(planned.headers['X-CSRF-Token']).toBeUndefined()
  })

  it('客户端尚无会话时不签名，登录请求仍省略 Cookie', async () => {
    const planned = await planJsonRequest({
      path: '/api/auth/totp',
      method: 'POST',
      bodyText: '{"code":"123456"}',
      csrfToken: null,
      native: true,
      dev: true,
      origin: '',
      sign: async () => null,
    })
    expect(planned.credentials).toBe('omit')
    expect(planned.headers.Authorization).toBeUndefined()
    expect(planned.url).toBe('/api/auth/totp')
  })
})
