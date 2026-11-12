/**
 * Bearer 设备认证：校验签名、时钟与 nonce，通过后建立会话上下文。
 * 失败按来源 IP 计数；签名材料不进入审计。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyRequest } from 'fastify'
import type { AuthContext } from '../types.ts'
import {
  deviceClockSkew,
  deviceHeadersRequired,
  deviceMismatch,
  deviceReplay,
  deviceRevoked,
  deviceSignatureInvalid,
  rateLimited,
  unauthorized,
} from '../util/errors.ts'
import { audit } from './audit.ts'
import {
  DEVICE_CLOCK_SKEW_SEC,
  canonicalDeviceRequest,
  verifyDeviceSignature,
} from './device-sign.ts'
import { consumeDeviceNonce, findActiveDevice } from './devices.ts'
import { SlidingWindowLimiter } from './limiter.ts'
import { findSession } from './sessions.ts'

const FAIL_WINDOW_MS = 15 * 60 * 1000
const FAIL_MAX = 30
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const TIMESTAMP_PATTERN = /^[0-9]{1,12}$/

interface DeviceHeaders {
  deviceId: string
  timestamp: string
  nonce: string
  signature: string
}

export class DeviceAuthenticator {
  private readonly failures = new SlidingWindowLimiter(FAIL_WINDOW_MS, FAIL_MAX)
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** Authorization 缺失时返回 null。形状不合法时直接拒绝，不回退到 Cookie。 */
  readBearer(header: string | string[] | undefined): string | null {
    if (header === undefined) return null
    if (Array.isArray(header) || !header.startsWith('Bearer ')) {
      throw unauthorized('认证头不合法', 'invalid_authorization')
    }
    const token = header.slice('Bearer '.length).trim()
    if (!token || token.length > 200) throw unauthorized('认证头不合法', 'invalid_authorization')
    return token
  }

  authenticate(request: FastifyRequest, token: string, ip: string): AuthContext {
    const headers = this.readHeaders(request)
    const device = findActiveDevice(this.db, headers.deviceId)
    if (!device) throw unauthorized()
    const nowSec = Math.floor(Date.now() / 1000)
    const timestamp = Number(headers.timestamp)
    if (!Number.isSafeInteger(timestamp) || Math.abs(nowSec - timestamp) > DEVICE_CLOCK_SKEW_SEC) {
      this.fail(ip, device.user_username, device.id, 'clock_skew')
      throw deviceClockSkew()
    }
    const body = request.deviceRawBody ?? Buffer.alloc(0)
    const message = canonicalDeviceRequest({
      deviceId: headers.deviceId,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      method: request.method,
      path: request.raw.url ?? request.url,
      body,
    })
    if (!verifyDeviceSignature(device.public_key, message, headers.signature)) {
      this.fail(ip, device.user_username, device.id, 'bad_signature')
      throw deviceSignatureInvalid()
    }
    // 验签以整秒比较且包含窗口末秒，nonce 必须保留到该秒完整结束。
    const expiresAt = new Date((timestamp + DEVICE_CLOCK_SKEW_SEC + 1) * 1000).toISOString()
    if (!consumeDeviceNonce(this.db, device.id, headers.nonce, expiresAt)) {
      this.fail(ip, device.user_username, device.id, 'replay')
      throw deviceReplay()
    }
    if (device.revoked_at) throw deviceRevoked()
    const session = findSession(this.db, token)
    if (!session || session.user_id !== device.user_id || session.device_id !== device.id) {
      throw deviceMismatch()
    }
    return { user: { id: session.user_id, username: session.user_username }, session }
  }

  private readHeaders(request: FastifyRequest): DeviceHeaders {
    const deviceId = headerValue(request, 'x-device-id')
    const timestamp = headerValue(request, 'x-device-timestamp')
    const nonce = headerValue(request, 'x-device-nonce')
    const signature = headerValue(request, 'x-device-signature')
    if (!deviceId || !timestamp || !nonce || !signature) throw deviceHeadersRequired()
    if (deviceId.length > 64 || !TIMESTAMP_PATTERN.test(timestamp) || !NONCE_PATTERN.test(nonce) || signature.length > 128) {
      throw deviceHeadersRequired()
    }
    return { deviceId, timestamp, nonce, signature }
  }

  private fail(ip: string, username: string, deviceId: string, reason: string): void {
    const wait = this.failures.hit(ip || 'unknown')
    if (wait > 0) throw rateLimited(wait)
    audit(this.db, username, 'device.auth_failed', deviceId, { reason }, ip)
  }
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
