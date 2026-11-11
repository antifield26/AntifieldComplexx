/**
 * 设备路由：列表、心跳、改名与吊销。
 * 浏览器会话可查看和吊销；心跳只接受已登记设备的会话。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../../config.ts'
import { assertDeviceName, listDevices, renameDevice, revokeDevice, touchDevice } from '../../auth/devices.ts'
import { audit } from '../../auth/audit.ts'
import { notFound, deviceRequired } from '../../util/errors.ts'
import { asRecord, clientIp, requireString } from '../util.ts'
import { authOf, csrfGuard, requireAuth } from '../guards.ts'

export function registerDeviceRoutes(app: FastifyInstance, config: Config, db: DatabaseSync): void {
  const csrf = csrfGuard(config)

  app.get('/api/devices', { preHandler: [requireAuth] }, async (request) => {
    const context = authOf(request)
    return { devices: listDevices(db, context.user.id, context.session.device_id, Date.now()) }
  })

  app.post('/api/devices/heartbeat', { preHandler: [requireAuth, csrf] }, async (request) => {
    const context = authOf(request)
    if (!context.session.device_id) throw deviceRequired()
    touchDevice(db, context.session.device_id)
    return { ok: true }
  })

  app.post('/api/devices/:id', { preHandler: [requireAuth, csrf] }, async (request) => {
    const context = authOf(request)
    const id = requireString((request.params as { id?: unknown }).id, 'id', 64)
    const name = assertDeviceName(asRecord(request.body).name)
    if (!renameDevice(db, context.user.id, id, name)) throw notFound('设备不存在', 'device_not_found')
    audit(db, context.user.username, 'device.rename', id, null, clientIp(request))
    return { ok: true }
  })

  app.delete('/api/devices/:id', { preHandler: [requireAuth, csrf] }, async (request) => {
    const context = authOf(request)
    const id = requireString((request.params as { id?: unknown }).id, 'id', 64)
    if (!revokeDevice(db, context.user.id, id)) throw notFound('设备不存在', 'device_not_found')
    audit(db, context.user.username, 'device.revoke', id, null, clientIp(request))
    return { ok: true }
  })
}
