/**
 * mcbot 对接 HTTP 路由。
 *
 * 边界：
 * - 全部需要登录。GET 按 IP 限流 60/min。仍开放的写接口校验 CSRF，控制 20/min，管理员对话 10/min。
 * - 任务开始、目标写、自主开始、移动和游戏发言在 CSRF 之后返回 409，不调用上游。
 * - 管理员对话审计只记字符数。急停审计只记失败腿名。正文不落库。
 * - 上游错误统一映射为 AppError。message 不含内部 URL 或 Token。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from '../../config.ts'
import { McbotError } from '../../mcbot/client.ts'
import type { McbotService } from '../../mcbot/service.ts'
import { SlidingWindowLimiter } from '../../auth/limiter.ts'
import { AppError, badRequest, rateLimited } from '../../util/errors.ts'
import { audit } from '../../auth/audit.ts'
import { asRecord, clientIp, parsePositiveInt } from '../util.ts'
import { csrfGuard, requireAuth } from '../guards.ts'

/** mcbot 支持的 11 种任务名（与上游 /task/start 一致，含 clearing）。 */
export const MCBOT_TASK_NAMES = [
  'fishing',
  'farming',
  'woodcutting',
  'mining',
  'forest',
  'sleep',
  'patrol',
  'guard',
  'escort',
  'explore',
  'clearing',
] as const
export type McbotTaskName = (typeof MCBOT_TASK_NAMES)[number]
/** 自主停止原因上限。 */
export const MCBOT_AUTONOMY_REASON_MAX_CHARS = 200

/** 聊天/taskId 不允许 C0 控制字符与 DEL（避免命令/日志/上游参数注入面）。 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** 可选文本参数：缺省/null/纯空白视为未提供；非字符串、超长、含控制字符返回 400。 */
function optionalBoundedText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw badRequest(`${field} 不合法`, 'invalid_request')
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max) throw badRequest(`${field} 最多 ${max} 字符`, 'invalid_request')
  if (hasControlChars(trimmed)) throw badRequest(`${field} 不能包含控制字符`, 'invalid_request')
  return trimmed
}

/** 上游稳定错误码的中文兜底文案；不含上游 message，避免英文/内部细节外泄。 */
const ERROR_MESSAGES: Record<string, string> = {
  mcbot_disabled: 'mcbot 对接未启用',
  mcbot_control_disabled: 'mcbot 控制接口未启用（未配置控制 Token）',
  mcbot_unavailable: 'mcbot 服务不可用',
  mcbot_auth_failed: 'mcbot 鉴权失败（Token 无效）',
  mcbot_upstream_error: 'mcbot 上游响应异常',
  mcbot_contract_unsupported: 'mcbot 状态或契约尚未确认',
  mcbot_say_unavailable: 'mcbot 发言需要契约 v2',
  mcbot_rate_limited: 'mcbot 请求过于频繁，请稍后重试',
  mcbot_resume_pending: 'mcbot 有待恢复任务，请先恢复或停止',
  mcbot_queue_full: 'mcbot 任务队列已满',
  mcbot_no_active_task: 'mcbot 当前没有运行中的任务',
  mcbot_no_pending_task: 'mcbot 当前没有待恢复的任务',
  mcbot_resume_failed: 'mcbot 任务恢复失败（可能已过期或 taskId 不匹配）',
  mcbot_task_active: 'mcbot 任务运行中，请先停止任务再移动',
  mcbot_target_not_online: '目标玩家不在线',
  mcbot_not_connected: 'mcbot 当前未连接 Minecraft',
  mcbot_task_disabled: 'mcbot 任务功能已关闭',
  mcbot_history_disabled: 'mcbot 历史功能已关闭',
  mcbot_invalid_request: 'mcbot 拒绝了请求参数',
  mcbot_autonomy_disabled: 'mcbot 自主模式未启用',
  mcbot_autonomy_busy: 'mcbot 自主模式正在运行，请先停止',
  mcbot_autonomy_unavailable: 'mcbot 自主模式不可用',
  mcbot_autonomy_failed: 'mcbot 自主模式启动失败',
  mcbot_presence_busy: '有任务或自主会话运行中，无法关闭在线模式',
  mcbot_presence_disabled: 'mcbot 在线模式不可用',
  mcbot_goals_disabled: 'mcbot 长期目标不可用',
  mcbot_goal_busy: '目标当前不可启动或正忙',
  mcbot_control_via_chat: '请通过 Minecraft Bot 对话控制',
  mcbot_chat_busy: '上一条对话还在处理，请稍后再发',
  mcbot_admin_unavailable: 'Minecraft Bot 对话暂不可用',
  mcbot_chat_failed: '对话没有完成',
}

/** 在线模式白名单。 */
export const MCBOT_PRESENCE_MODES = ['auto', 'always', 'off'] as const
export type McbotPresenceMode = (typeof MCBOT_PRESENCE_MODES)[number]

function errorMessageFor(code: string, fallback: string): string {
  return ERROR_MESSAGES[code] ?? fallback
}

/** McbotError → 稳定的 AppError（保留上游 400/409，其余按契约 503/502/429）。 */
export function toLofiiAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof McbotError) {
    const code = error.code
    if (error.statusCode === 400 || error.statusCode === 409) {
      return new AppError(error.statusCode, code, errorMessageFor(code, 'mcbot 拒绝了请求'))
    }
    if (error.statusCode === 429) {
      return new AppError(429, 'mcbot_rate_limited', errorMessageFor('mcbot_rate_limited', '请稍后重试'), {
        retryAfterSec: 60,
      })
    }
    if (code === 'mcbot_auth_failed' || code === 'mcbot_upstream_error') {
      return new AppError(502, code, errorMessageFor(code, 'mcbot 上游响应异常'))
    }
    return new AppError(503, code, errorMessageFor(code, 'mcbot 服务不可用'))
  }
  return new AppError(502, 'mcbot_upstream_error', errorMessageFor('mcbot_upstream_error', 'mcbot 上游响应异常'))
}

/** 查询参数时间：空值忽略；非 ISO 返回 400，避免静默变全量查询。 */
function timeParam(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  if (!Number.isFinite(Date.parse(text))) throw badRequest(`参数 ${field} 必须是 ISO 时间`, 'invalid_request')
  return new Date(Date.parse(text)).toISOString()
}

function requireEnabled(mcbot: McbotService): void {
  if (!mcbot.enabled) throw new AppError(503, 'mcbot_disabled', errorMessageFor('mcbot_disabled', 'mcbot 对接未启用'))
}

export function registerLofiiRoutes(
  app: FastifyInstance,
  config: Config,
  mcbot: McbotService,
  db: DatabaseSync,
): void {
  const csrf = csrfGuard(config)
  const controlLimiter = new SlidingWindowLimiter(60_000, 20)
  const sayLimiter = new SlidingWindowLimiter(60_000, 10)
  // 只读 GET 限流：覆盖 /status、/history、/autonomy，UI 5 秒轮询（12/min）不受影响。
  const getLimiter = new SlidingWindowLimiter(60_000, 60)

  /** GET 限流：超限返回 429 + Retry-After。 */
  function limitGet(request: FastifyRequest): void {
    const retry = getLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
  }

  /** 控制失败审计：只记稳定错误码，不记 Token/URL/上游原文。 */
  function auditFailure(actor: { username: string; ip: string | null }, action: string, error: unknown): void {
    const code = error instanceof McbotError ? error.code : 'mcbot_upstream_error'
    audit(db, actor.username, 'mcbot.control_failed', action, { code }, actor.ip)
  }

  app.get('/api/mcbot/status', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    return mcbot.snapshot()
  })

  app.get('/api/mcbot/history', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    requireEnabled(mcbot)
    const query = asRecord(request.query)
    const rawKind = query.kind === undefined || query.kind === '' ? 'samples' : query.kind
    if (rawKind !== 'samples' && rawKind !== 'alerts') throw badRequest('kind 必须是 samples 或 alerts', 'invalid_request')
    const from = timeParam(query.from, 'from')
    const to = timeParam(query.to, 'to')
    const limit = parsePositiveInt(query.limit, 100, 1, 200)
    try {
      return await mcbot.history(rawKind, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit,
      })
    } catch (error) {
      throw toLofiiAppError(error)
    }
  })

  app.get('/api/mcbot/autonomy', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    requireEnabled(mcbot)
    try {
      return { autonomy: await mcbot.autonomy() }
    } catch (error) {
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/autonomy/start', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/autonomy/stop', { preHandler: [requireAuth, csrf] }, async (request) => {
    requireEnabled(mcbot)
    const actor = { username: request.auth?.user.username ?? '', ip: clientIp(request) }
    const retry = controlLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
    const body = asRecord(request.body)
    const reason = optionalBoundedText(body.reason, 'reason', MCBOT_AUTONOMY_REASON_MAX_CHARS)
    try {
      const result = await mcbot.stopAutonomy(reason)
      audit(db, actor.username, 'mcbot.autonomy.stop', null, { reasonChars: reason?.length ?? 0 }, actor.ip)
      return { ok: true, autonomy: result.autonomy }
    } catch (error) {
      auditFailure(actor, 'mcbot.autonomy.stop', error)
      throw toLofiiAppError(error)
    }
  })

  app.get('/api/mcbot/presence', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    requireEnabled(mcbot)
    try {
      return { presence: await mcbot.presence() }
    } catch (error) {
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/presence', { preHandler: [requireAuth, csrf] }, async (request) => {
    requireEnabled(mcbot)
    const actor = { username: request.auth?.user.username ?? '', ip: clientIp(request) }
    const retry = controlLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
    const body = asRecord(request.body)
    const mode = typeof body.mode === 'string' ? body.mode.trim() : ''
    if (!(MCBOT_PRESENCE_MODES as readonly string[]).includes(mode)) {
      throw badRequest(`mode 必须是 ${MCBOT_PRESENCE_MODES.join('/')} 之一`, 'invalid_request')
    }
    try {
      const result = await mcbot.setPresence(mode)
      audit(db, actor.username, 'mcbot.presence.set', mode, { mode }, actor.ip)
      return { ok: true, presence: result }
    } catch (error) {
      auditFailure(actor, 'mcbot.presence.set', error)
      throw toLofiiAppError(error)
    }
  })

  app.get('/api/mcbot/goals', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    requireEnabled(mcbot)
    const query = asRecord(request.query)
    const limit = parsePositiveInt(query.limit, 20, 1, 50)
    try {
      return await mcbot.goals(limit)
    } catch (error) {
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/goals', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/goals/:goalId/:action', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/tasks', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/tasks/stop', { preHandler: [requireAuth, csrf] }, async (request) => {
    requireEnabled(mcbot)
    const actor = { username: request.auth?.user.username ?? '', ip: clientIp(request) }
    const retry = controlLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
    try {
      const result = await mcbot.stopTask()
      audit(db, actor.username, 'mcbot.task.stop', 'task', null, actor.ip)
      return { ok: true, ...result }
    } catch (error) {
      auditFailure(actor, 'mcbot.task.stop', error)
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/tasks/resume', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/move', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.post('/api/mcbot/say', { preHandler: [requireAuth, csrf] }, async () => {
    throw new AppError(409, 'mcbot_control_via_chat', errorMessageFor('mcbot_control_via_chat', '请通过 Minecraft Bot 对话控制'))
  })

  app.get('/api/mcbot/chat', { preHandler: [requireAuth] }, async (request) => {
    limitGet(request)
    requireEnabled(mcbot)
    try {
      return await mcbot.adminChatState()
    } catch (error) {
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/chat', { preHandler: [requireAuth, csrf] }, async (request) => {
    requireEnabled(mcbot)
    if (!mcbot.controlEnabled) {
      throw new AppError(503, 'mcbot_control_disabled', errorMessageFor('mcbot_control_disabled', 'mcbot 控制接口未启用'))
    }
    const actor = { username: request.auth?.user.username ?? '', ip: clientIp(request) }
    const retry = sayLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
    const body = asRecord(request.body)
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 2000 || hasControlChars(message)) {
      throw badRequest('消息必须是 1..2000 字符且不能包含控制字符', 'invalid_request')
    }
    try {
      const result = await mcbot.adminChat(message)
      audit(db, actor.username, 'mcbot.chat', null, { chars: message.length }, actor.ip)
      return result
    } catch (error) {
      auditFailure(actor, 'mcbot.chat', error)
      throw toLofiiAppError(error)
    }
  })

  app.post('/api/mcbot/emergency-stop', { preHandler: [requireAuth, csrf] }, async (request) => {
    requireEnabled(mcbot)
    const actor = { username: request.auth?.user.username ?? '', ip: clientIp(request) }
    const retry = controlLimiter.hit(clientIp(request))
    if (retry > 0) throw rateLimited(retry)
    try {
      const result = await mcbot.emergencyStop()
      const failures = Array.isArray(result.failures) ? result.failures.filter((item) => typeof item === 'string') : []
      audit(db, actor.username, 'mcbot.emergency_stop', null, { failures }, actor.ip)
      return { ok: failures.length === 0, failures }
    } catch (error) {
      auditFailure(actor, 'mcbot.emergency_stop', error)
      throw toLofiiAppError(error)
    }
  })
}
