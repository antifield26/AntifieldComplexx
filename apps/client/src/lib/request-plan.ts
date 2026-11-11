/**
 * 组装 JSON 请求。浏览器带 Cookie 与 CSRF。
 * 客户端省略 Cookie；有会话时附上设备签名，并去掉 CSRF。
 */
import { resolveApiUrl } from './api-origin'

const CSRF_HEADER = 'X-CSRF-Token'

export interface SignedHeaders {
  authorization: string
  deviceId: string
  timestamp: string
  nonce: string
  signature: string
}

export interface JsonTransport {
  url: string
  credentials: 'include' | 'omit'
  headers: Record<string, string>
  body?: string
}

export interface JsonTransportInput {
  path: string
  method: string
  bodyText?: string
  csrfToken: string | null
  native: boolean
  dev: boolean
  origin: string
  sign: ((method: string, path: string, bodyText: string) => Promise<SignedHeaders | null>) | null
}

export async function planJsonRequest(input: JsonTransportInput): Promise<JsonTransport> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.bodyText !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8'
  }

  let signed = false
  if (input.native && input.sign) {
    const signedHeaders = await input.sign(input.method, input.path, input.bodyText ?? '')
    if (signedHeaders) {
      signed = true
      headers.Authorization = `Bearer ${signedHeaders.authorization}`
      headers['X-Device-Id'] = signedHeaders.deviceId
      headers['X-Device-Timestamp'] = signedHeaders.timestamp
      headers['X-Device-Nonce'] = signedHeaders.nonce
      headers['X-Device-Signature'] = signedHeaders.signature
    }
  }
  if (!signed && input.method !== 'GET' && input.csrfToken) {
    headers[CSRF_HEADER] = input.csrfToken
  }

  const transport: JsonTransport = {
    url: resolveApiUrl({
      path: input.path,
      native: input.native,
      dev: input.dev,
      origin: input.origin,
    }),
    credentials: input.native ? 'omit' : 'include',
    headers,
  }
  if (input.bodyText !== undefined) transport.body = input.bodyText
  return transport
}
