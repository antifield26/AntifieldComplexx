/**
 * 设备请求签名：Ed25519 覆盖方法、路径、原始请求体、时间戳与 nonce。
 * 签名只证明持有已登记私钥；不替代 TLS，也不写入日志。
 */
import { createHash, createPublicKey, verify } from 'node:crypto'

/** 允许的设备时钟偏差（秒）。超出后拒绝，避免旧请求被长期重放。 */
export const DEVICE_CLOCK_SKEW_SEC = 120
/** 前台心跳在此时长内视为在线。 */
export const DEVICE_ONLINE_MS = 90_000
/** 带设备签名的请求体上限。分片上传单片小于该值。 */
export const DEVICE_BODY_LIMIT = 9 * 1024 * 1024
/** 同一账号可同时保留的未吊销设备数。 */
export const DEVICE_ACTIVE_LIMIT = 10

export interface CanonicalDeviceRequest {
  deviceId: string
  timestamp: string
  nonce: string
  method: string
  path: string
  body: Buffer
}

/** 规范化待签名字符串。路径含查询串，请求体按原始字节哈希。 */
export function canonicalDeviceRequest(input: CanonicalDeviceRequest): string {
  const bodyHash = createHash('sha256').update(input.body).digest('hex')
  return [
    'v1',
    input.deviceId,
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join('\n')
}

/** 接受 32 字节 Ed25519 公钥的 base64url 文本，并返回规范写法。非法则返回 null。 */
export function canonicalizePublicKey(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== 32) return null
  return raw.toString('base64url')
}

/** 校验签名。公钥或签名形状不合法时返回 false，不抛异常。 */
export function verifyDeviceSignature(publicKey: string, message: string, signature: string): boolean {
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false
  const raw = Buffer.from(signature, 'base64url')
  if (raw.length !== 64) return false
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: publicKey },
      format: 'jwk',
    })
    return verify(null, Buffer.from(message, 'utf8'), key, raw)
  } catch {
    return false
  }
}
