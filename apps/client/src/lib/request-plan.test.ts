import { describe, expect, it, vi } from 'vitest'
import { NATIVE_SESSION_REQUIRED, planBinaryRequest, planJsonRequest, sha256Hex } from './request-plan'

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

describe('planBinaryRequest', () => {
  const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

  it('浏览器分片带 Cookie 与 CSRF，不要求摘要', async () => {
    const planned = await planBinaryRequest({
      path: '/api/uploads/upload-1/chunks/0',
      method: 'PUT',
      csrfToken: 'csrf-1',
      native: false,
      dev: true,
      origin: '',
      contentType: 'application/octet-stream',
      bodySha256: null,
      sign: null,
    })
    expect(planned.url).toBe('/api/uploads/upload-1/chunks/0')
    expect(planned.credentials).toBe('include')
    expect(planned.headers['X-CSRF-Token']).toBe('csrf-1')
    expect(planned.headers['Content-Type']).toBe('application/octet-stream')
    expect(planned.headers.Authorization).toBeUndefined()
  })

  it('客户端用给定摘要签名，并省略 Cookie', async () => {
    const sign = vi.fn().mockResolvedValue({
      authorization: 'session-token',
      deviceId: 'device-1',
      timestamp: '1700000000',
      nonce: 'nonce-value-0123456789',
      signature: 'sig',
    })
    const planned = await planBinaryRequest({
      path: '/api/uploads/upload-1/chunks/0',
      method: 'PUT',
      csrfToken: 'csrf-1',
      native: true,
      dev: false,
      origin: 'https://app.example.com',
      contentType: 'application/octet-stream',
      bodySha256: hash,
      sign,
    })
    expect(sign).toHaveBeenCalledWith('PUT', '/api/uploads/upload-1/chunks/0', '', hash)
    expect(planned.url).toBe('https://app.example.com/api/uploads/upload-1/chunks/0')
    expect(planned.credentials).toBe('omit')
    expect(planned.headers.Authorization).toBe('Bearer session-token')
    expect(planned.headers['X-Device-Signature']).toBe('sig')
    expect(planned.headers['X-CSRF-Token']).toBeUndefined()
  })

  it('客户端没有会话时拒绝发送', async () => {
    await expect(
      planBinaryRequest({
        path: '/api/uploads/upload-1/chunks/0',
        method: 'PUT',
        csrfToken: null,
        native: true,
        dev: true,
        origin: '',
        contentType: 'application/octet-stream',
        bodySha256: hash,
        sign: async () => null,
      }),
    ).rejects.toThrow(NATIVE_SESSION_REQUIRED)
  })

  it('空字节的摘要固定', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(hash)
  })
})
