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

export const NATIVE_SESSION_REQUIRED = '登录状态已失效，请重新登录'

export interface BinaryTransportInput {
  path: string
  method: string
  csrfToken: string | null
  native: boolean
  dev: boolean
  origin: string
  contentType: string
  bodySha256: string | null
  sign: ((method: string, path: string, bodyText: string, bodySha256: string) => Promise<SignedHeaders | null>) | null
}

/** 二进制请求。浏览器带 Cookie 与 CSRF。客户端对调用方给出的摘要签名，没有会话时拒绝发送。 */
export async function planBinaryRequest(input: BinaryTransportInput): Promise<JsonTransport> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': input.contentType,
  }
  if (input.native) {
    if (!input.sign || !input.bodySha256) throw new Error(NATIVE_SESSION_REQUIRED)
    const signedHeaders = await input.sign(input.method, input.path, '', input.bodySha256)
    if (!signedHeaders) throw new Error(NATIVE_SESSION_REQUIRED)
    headers.Authorization = `Bearer ${signedHeaders.authorization}`
    headers['X-Device-Id'] = signedHeaders.deviceId
    headers['X-Device-Timestamp'] = signedHeaders.timestamp
    headers['X-Device-Nonce'] = signedHeaders.nonce
    headers['X-Device-Signature'] = signedHeaders.signature
  } else if (input.method !== 'GET' && input.csrfToken) {
    headers[CSRF_HEADER] = input.csrfToken
  }

  return {
    url: resolveApiUrl({
      path: input.path,
      native: input.native,
      dev: input.dev,
      origin: input.origin,
    }),
    credentials: input.native ? 'omit' : 'include',
    headers,
  }
}

/** 对即将发送的字节计算小写十六进制 SHA-256。 */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}
