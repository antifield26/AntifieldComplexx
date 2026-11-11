/**
 * 选择请求地址。浏览器与调试中的客户端走相对路径，由页面或 Vite 代理转发。
 * 生产客户端必须带已配置的接口源，缺省时失败，不猜测地址。
 */

export interface ApiUrlInput {
  path: string
  native: boolean
  dev: boolean
  origin: string
}

/** 生产客户端使用的接口源。只接受源本身，不接受带路径的地址。 */
export function readApiOrigin(): string {
  const value = import.meta.env.VITE_API_ORIGIN
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveApiUrl(input: ApiUrlInput): string {
  if (!input.path.startsWith('/') || input.path.includes('://') || /[\r\n]/.test(input.path)) {
    throw new Error('接口路径不合法')
  }
  if (!input.native || input.dev) return input.path
  const base = input.origin.trim().replace(/\/$/, '')
  if (!/^https?:\/\/[^/]+$/.test(base)) throw new Error('缺少接口源')
  return `${base}${input.path}`
}
