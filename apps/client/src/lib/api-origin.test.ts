import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from './api-origin'

describe('resolveApiUrl', () => {
  it('浏览器与调试客户端使用相对路径', () => {
    expect(resolveApiUrl({ path: '/api/auth/me', native: false, dev: false, origin: '' })).toBe('/api/auth/me')
    expect(resolveApiUrl({ path: '/api/files?limit=1', native: true, dev: true, origin: '' })).toBe('/api/files?limit=1')
  })

  it('生产客户端拼上接口源', () => {
    expect(
      resolveApiUrl({
        path: '/api/devices',
        native: true,
        dev: false,
        origin: 'https://app.example.com/',
      }),
    ).toBe('https://app.example.com/api/devices')
  })

  it('生产客户端缺少合法接口源时失败', () => {
    expect(() => resolveApiUrl({ path: '/api/devices', native: true, dev: false, origin: '' })).toThrow('缺少接口源')
    expect(() =>
      resolveApiUrl({ path: '/api/devices', native: true, dev: false, origin: 'https://app.example.com/api' }),
    ).toThrow('缺少接口源')
  })

  it('拒绝把来源写进待签名路径', () => {
    expect(() => resolveApiUrl({ path: 'api/devices', native: false, dev: true, origin: '' })).toThrow('接口路径不合法')
    expect(() =>
      resolveApiUrl({ path: 'https://app.example.com/api', native: true, dev: true, origin: '' }),
    ).toThrow('接口路径不合法')
  })
})
