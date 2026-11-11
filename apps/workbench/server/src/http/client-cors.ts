/**
 * Tauri WebView 访问应用接口时的跨源响应。
 * 只放行三个固定源，不反射其它 Origin，也不携带凭据。
 */
import type { FastifyReply } from 'fastify'

export const CLIENT_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'] as const

const ALLOWED = new Set<string>(CLIENT_ORIGINS)

export const CLIENT_CORS_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-CSRF-Token',
  'X-Totp-Code',
  'X-Device-Id',
  'X-Device-Timestamp',
  'X-Device-Nonce',
  'X-Device-Signature',
].join(', ')

export function isClientOrigin(origin: unknown): origin is string {
  return typeof origin === 'string' && ALLOWED.has(origin)
}

export function applyClientCors(reply: FastifyReply, origin: string): void {
  reply.header('access-control-allow-origin', origin)
  reply.header('vary', 'Origin')
  reply.header('access-control-allow-headers', CLIENT_CORS_HEADERS)
  reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  reply.header('access-control-max-age', '600')
}
