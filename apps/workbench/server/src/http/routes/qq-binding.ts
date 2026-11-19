/** 主站管理员绑定入口。只携带验证后的操作，经固定 Unix socket 访问独立 QQ 服务。 */
import { request as httpRequest } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { audit } from '../../auth/audit.ts'
import type { AuthService } from '../../auth/service.ts'
import { allowedOrigins } from '../../auth/csrf.ts'
import type { Config } from '../../config.ts'
import { AppError, badRequest, csrfFailed, forbidden } from '../../util/errors.ts'
import { authOf, csrfGuard, requireAuth } from '../guards.ts'
import { asRecord, clientIp, requireString } from '../util.ts'

const socketPath = '/run/antifield-dsh-qq-link/binding.sock'
const bodyLimit = 64 * 1024
const stableErrors: Record<string, [number, string]> = {
  invalid_request: [400, '绑定操作无效'],
  invalid_allowlist: [400, '请填写有效的私聊及群白名单'],
  binding_busy: [409, '另一项绑定操作正在进行'],
  binding_expired: [410, '绑定操作已过期，请重新开始'],
}

export function callQqBinding(input: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(input)
    const request = httpRequest({
      socketPath, path: '/binding', method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > bodyLimit) request.destroy(new Error())
        else chunks.push(chunk)
      })
      response.once('error', reject)
      response.once('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error()
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) { reject(error) }
      })
    })
    request.once('error', reject)
    request.end(body)
  })
}

function hint(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]{1,4}$/.test(value) ? value : null
}

function publicStatus(value: unknown) {
  const state = asRecord(value)
  const failure = typeof state.error === 'string' ? Object.hasOwn(stableErrors, state.error) && stableErrors[state.error] : null
  if (failure) throw new AppError(failure[0], state.error as string, failure[1])
  if (typeof state.phase !== 'string' || !['unbound', 'connecting', 'ready', 'switching'].includes(state.phase)) {
    throw new AppError(503, 'qq_binding_unavailable', 'QQ 管理服务暂时不可用')
  }
  const op = state.operation ? asRecord(state.operation) : null
  return {
    bound: state.bound === true, ready: state.ready === true, phase: state.phase, appIdHint: hint(state.appIdHint),
    operation: op && typeof op.id === 'string' && /^[\da-f-]{36}$/.test(op.id)
      && typeof op.phase === 'string' && ['waiting', 'confirm', 'complete', 'failed'].includes(op.phase)
      ? {
          id: op.id, phase: op.phase, expiresAt: typeof op.expiresAt === 'string' && Number.isFinite(Date.parse(op.expiresAt)) ? op.expiresAt : null,
          qr: typeof op.qr === 'string' && /^data:image\/png;base64,[\w+/=]{1,32000}$/.test(op.qr) ? op.qr : null,
          needsAllowlist: op.needsAllowlist === true, appIdHint: hint(op.appIdHint),
          error: typeof op.error === 'string' && ['qr_failed', 'binding_switch_failed', 'binding_rollback_failed'].includes(op.error) ? op.error : null,
        }
      : null,
  }
}

export function registerQqBindingRoutes(
  app: FastifyInstance, config: Config, auth: AuthService, db: DatabaseSync,
  call = callQqBinding,
): void {
  async function requireBrowser(request: FastifyRequest, reply: FastifyReply) {
    reply.header('cache-control', 'no-store')
    await requireAuth(request)
    if (request.headers.authorization || request.deviceSigned) throw forbidden('请在主站浏览器中管理 QQ 绑定')
    if (!config.dshWebUrl) throw new AppError(503, 'qq_binding_unavailable', 'QQ 管理服务未配置')
  }

  async function forward(request: FastifyRequest, data: Record<string, unknown>) {
    let raw
    try { raw = await call({ ...data, owner: String(authOf(request).session.id) }) }
    catch { throw new AppError(503, 'qq_binding_unavailable', 'QQ 管理服务暂时不可用') }
    return publicStatus(raw)
  }

  const csrf = csrfGuard(config)
  app.get('/api/qq-binding', { preHandler: [requireBrowser] }, (request) => forward(request, { action: 'status' }))
  app.post('/api/qq-binding', { bodyLimit, preHandler: [requireBrowser, csrf] }, async (request) => {
    if (!request.headers.origin || !allowedOrigins(config, request).includes(request.headers.origin)) throw csrfFailed()
    const body = asRecord(request.body)
    const context = authOf(request)
    const ip = clientIp(request)
    const action = body.action
    let result
    try {
      if (action === 'start') {
        const kind = body.kind
        if (kind !== 'qr' && kind !== 'manual' && kind !== 'unbind') throw badRequest()
        const credentials = kind === 'manual'
          ? { appId: requireString(body.appId, 'appId', 128), appSecret: requireString(body.appSecret, 'appSecret', 512) }
          : {}
        await auth.confirmQqBinding(context, {
          password: requireString(body.password, 'password', 256), totpCode: requireString(body.totpCode, 'totpCode', 16), ip,
        })
        result = await forward(request, { action, kind, ...credentials })
      } else if (action === 'confirm' || action === 'cancel' || action === 'refresh') {
        const id = requireString(body.id, 'id', 36)
        result = await forward(request, { action, id, ...(action === 'confirm' ? { direct: body.direct, groups: body.groups } : {}) })
      } else {
        throw badRequest()
      }
      audit(db, context.user.username, 'qq_binding', null, { operation: action, accepted: true }, ip)
      return result
    } catch (error) {
      audit(db, context.user.username, 'qq_binding', null, {
        operation: action === 'start' || action === 'confirm' || action === 'cancel' || action === 'refresh' ? action : 'invalid',
        accepted: false,
      }, ip)
      throw error
    }
  })
}
