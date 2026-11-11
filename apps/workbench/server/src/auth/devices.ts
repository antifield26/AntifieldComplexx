/**
 * 已登记设备的存储：登记、列表、改名、吊销与 nonce 消耗。
 * 吊销只标记时间并删除该设备的会话，保留公钥行以阻止同一密钥再次登记。
 */
import type { DatabaseSync } from 'node:sqlite'
import { badRequest, conflict, deviceRevoked } from '../util/errors.ts'
import { newId } from '../util/ids.ts'
import { nowIso } from '../util/time.ts'
import {
  DEVICE_ACTIVE_LIMIT,
  DEVICE_ONLINE_MS,
  canonicalizePublicKey,
} from './device-sign.ts'

export interface DeviceEnrollment {
  name: string
  platform: 'windows' | 'android'
  publicKey: string
  appVersion: string
}

export interface RegisteredDevice {
  id: string
  name: string
  platform: 'windows' | 'android'
}

export interface DeviceView {
  id: string
  name: string
  platform: 'windows' | 'android'
  appVersion: string
  online: boolean
  lastSeenAt: string | null
  current: boolean
}

interface DeviceRow {
  id: string
  user_id: string
  name: string
  platform: 'windows' | 'android'
  public_key: string
  app_version: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
  user_username: string
}

const NAME_MAX = 32
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,16})?$/

/** 设备显示名：1–32 个字符，去掉首尾空白，拒绝控制字符。 */
export function assertDeviceName(value: unknown): string {
  if (typeof value !== 'string') throw invalidDevice('设备名称不合法')
  const name = value.trim()
  if (name.length < 1 || name.length > NAME_MAX || hasControlChar(name)) {
    throw invalidDevice('设备名称不合法')
  }
  return name
}

/** 拒绝 C0 与 DEL，避免设备名把控制字符带进列表。 */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** 校验客户端提交的登记字段。失败为 400，不访问数据库。 */
export function assertDeviceEnrollment(input: {
  name: unknown
  platform: unknown
  publicKey: unknown
  appVersion: unknown
}): DeviceEnrollment {
  const name = assertDeviceName(input.name)
  if (input.platform !== 'windows' && input.platform !== 'android') throw invalidDevice('设备平台不合法')
  if (typeof input.publicKey !== 'string') throw invalidDevice('设备公钥不合法')
  const publicKey = canonicalizePublicKey(input.publicKey)
  if (!publicKey) throw invalidDevice('设备公钥不合法')
  if (typeof input.appVersion !== 'string' || input.appVersion.length > NAME_MAX || !VERSION_PATTERN.test(input.appVersion)) {
    throw invalidDevice('设备版本不合法')
  }
  return { name, platform: input.platform, publicKey, appVersion: input.appVersion }
}

function invalidDevice(message: string): Error {
  return badRequest(message, 'invalid_device')
}

/** 登记新设备，或复用同一用户尚未吊销的同一公钥。调用方负责放进事务。 */
export function registerDevice(db: DatabaseSync, userId: string, enrollment: DeviceEnrollment): RegisteredDevice {
  const existing = db
    .prepare('SELECT * FROM devices WHERE public_key = ?')
    .get(enrollment.publicKey) as DeviceRow | undefined
  if (existing) {
    if (existing.user_id !== userId) throw conflict('设备公钥已被登记', 'device_key_in_use')
    if (existing.revoked_at) throw deviceRevoked()
    db.prepare('UPDATE devices SET name = ?, platform = ?, app_version = ? WHERE id = ?').run(
      enrollment.name,
      enrollment.platform,
      enrollment.appVersion,
      existing.id,
    )
    deleteSessionsForDevice(db, existing.id)
    return { id: existing.id, name: enrollment.name, platform: enrollment.platform }
  }
  const active = db
    .prepare('SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND revoked_at IS NULL')
    .get(userId) as { c: number }
  if (Number(active.c) >= DEVICE_ACTIVE_LIMIT) throw conflict('已登记设备达到上限', 'device_limit')
  const id = newId()
  const now = nowIso()
  db.prepare(
    `INSERT INTO devices (id, user_id, name, platform, public_key, app_version, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(id, userId, enrollment.name, enrollment.platform, enrollment.publicKey, enrollment.appVersion, now)
  return { id, name: enrollment.name, platform: enrollment.platform }
}

export function findActiveDevice(db: DatabaseSync, deviceId: string): DeviceRow | null {
  const row = db
    .prepare(
      `SELECT d.*, u.username AS user_username
       FROM devices d JOIN users u ON u.id = d.user_id
       WHERE d.id = ?`,
    )
    .get(deviceId) as DeviceRow | undefined
  return row ?? null
}

export function listDevices(db: DatabaseSync, userId: string, currentId: string | null, nowMs: number): DeviceView[] {
  const rows = db
    .prepare(
      `SELECT id, name, platform, app_version, last_seen_at
       FROM devices
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(userId) as unknown as Array<{
    id: string
    name: string
    platform: 'windows' | 'android'
    app_version: string
    last_seen_at: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version,
    online: isOnline(row.last_seen_at, nowMs),
    lastSeenAt: row.last_seen_at,
    current: row.id === currentId,
  }))
}

export function renameDevice(db: DatabaseSync, userId: string, deviceId: string, name: string): boolean {
  const result = db
    .prepare('UPDATE devices SET name = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(name, deviceId, userId)
  return Number(result.changes) > 0
}

/** 吊销设备并删除其全部会话。设备不属于该用户时返回 false。 */
export function revokeDevice(db: DatabaseSync, userId: string, deviceId: string): boolean {
  const row = db
    .prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?')
    .get(deviceId, userId) as { id: string } | undefined
  if (!row) return false
  db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(nowIso(), deviceId)
  deleteSessionsForDevice(db, deviceId)
  return true
}

export function touchDevice(db: DatabaseSync, deviceId: string): void {
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), deviceId)
}

/** 记录 nonce。重复或主键冲突返回 false。过期行在写入前清理。 */
export function consumeDeviceNonce(db: DatabaseSync, deviceId: string, nonce: string, expiresAt: string): boolean {
  db.prepare('DELETE FROM device_nonces WHERE expires_at <= ?').run(nowIso())
  try {
    db.prepare('INSERT INTO device_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?)').run(deviceId, nonce, expiresAt)
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) return false
    throw error
  }
}

export function deleteSessionsForDevice(db: DatabaseSync, deviceId: string): void {
  db.prepare('DELETE FROM sessions WHERE device_id = ?').run(deviceId)
}

function isOnline(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return false
  const seen = Date.parse(lastSeenAt)
  return Number.isFinite(seen) && nowMs - seen <= DEVICE_ONLINE_MS
}
