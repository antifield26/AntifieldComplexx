/** mcbot 路由与接线测试：认证/CSRF/校验/限流/错误映射/审计/历史透传/version 字段。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../src/config.ts'
import { buildApp } from '../src/app.ts'
import { DashboardService } from '../src/dashboard/service.ts'
import { FileService } from '../src/files/service.ts'
import { McbotClient } from '../src/mcbot/client.ts'
import { McbotService } from '../src/mcbot/service.ts'
import { MinecraftService } from '../src/mc/service.ts'
import { registerDashboardRoutes } from '../src/http/routes/dashboard.ts'
import { registerLofiiRoutes } from '../src/http/routes/mcbot.ts'
import { createSession } from '../src/auth/sessions.ts'
import { cleanupDir, seedAdmin, tempDataDir, testConfig, testDb } from './helpers.ts'
import { authHeaders, createAuthedApp, csrfHeadersOnly, phase2Fixture, type Phase2Fixture } from './phase2-fixtures.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>

function defaultHandler(url: URL, init?: RequestInit): Response {
  if (url.pathname === '/healthz') return json({ status: 'ok', version: '0.6.0', contractVersion: 2 })
  if (url.pathname === '/status') return json({ version: '0.6.0', contractVersion: 2, state: 'connected', minecraft: { connected: true }, task: { active: false, state: 'idle', queue: [] } })
  if (url.pathname === '/events/recent') {
    return json({ contractVersion: 2, bootId: 'b1', lastEventId: null, events: [] })
  }
  if (url.pathname === '/history') {
    const kind = url.searchParams.get('kind') ?? 'samples'
    return json({ kind, from: null, to: null, count: 0, [kind]: [] })
  }
  if (url.pathname === '/task/start') {
    return json(
      { ok: true, queued: true, position: 1, requestId: 'r1', task: { name: 'fishing', state: 'running' } },
      202,
    )
  }
  if (url.pathname === '/task/stop') {
    return json({ ok: true, requestId: 'r2', task: { active: false, state: 'idle' } }, 202)
  }
  if (url.pathname === '/task/resume') {
    return json({ ok: true, requestId: 'r3', task: { state: 'running' } }, 202)
  }
  if (url.pathname === '/move') return json({ ok: true, requestId: 'r4', action: 'home', target: null }, 202)
  if (url.pathname === '/say') return json({ ok: true, lines: 1 })
  if (url.pathname === '/admin/chat') {
    const method = String(init?.method ?? 'GET').toUpperCase()
    if (method === 'GET') return json({ messages: [{ id: 'm1', role: 'user', text: '看看状态', at: '2026-11-14T00:00:00.000Z' }], turn: null })
    return json({ ok: true, turnId: 'turn-1', status: 'pending' }, 202)
  }
  if (url.pathname === '/emergency-stop') return json({ ok: true, failures: [] })
  return json({ error: 'not_found', message: 'not found' }, 404)
}

interface McbotAppFixture {
  fixture: Phase2Fixture
  app: FastifyInstance
  service: McbotService
  calls: { url: URL; init: RequestInit }[]
  close: () => Promise<void>
}

async function makeLofiiApp(options: { config?: Partial<Config>; handler?: Handler } = {}): Promise<McbotAppFixture> {
  const fixture = phase2Fixture({
    mcbotEnabled: true,
    mcbotReadToken: 'read-token',
    mcbotControlToken: 'control-token',
    mcbotPollMs: 60_000,
    mcbotTimeoutMs: 500,
    ...options.config,
  })
  const calls: { url: URL; init: RequestInit }[] = []
  const handler = options.handler ?? defaultHandler
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  }) as typeof fetch
  const client = new McbotClient({
    baseUrl: fixture.config.mcbotUrl,
    readToken: fixture.config.mcbotReadToken,
    controlToken: fixture.config.mcbotControlToken,
    timeoutMs: fixture.config.mcbotTimeoutMs,
    fetch: impl,
  })
  const service = new McbotService({
    db: fixture.db,
    config: fixture.config,
    alerts: { recordExternal: () => 1 },
    client,
    log: () => {},
  })
  const app = await createAuthedApp(fixture.db, (instance) => {
    registerLofiiRoutes(instance, fixture.config, service, fixture.db)
  })
  return {
    fixture,
    app,
    service,
    calls,
    close: async () => {
      service.stop()
      await app.close()
      fixture.close()
    },
  }
}

function authOf(call: { init: RequestInit }): string {
  return String((call.init.headers as Record<string, string>)?.authorization ?? '')
}

function auditRows(db: Phase2Fixture['db']): { action: string; target: string | null; detail_json: string | null }[] {
  return db.prepare('SELECT action, target, detail_json FROM audit_log ORDER BY id ASC').all() as unknown as {
    action: string
    target: string | null
    detail_json: string | null
  }[]
}

const SENSITIVE = ['read-token', 'control-token', '127.0.0.1:3010']

test('GET /api/mcbot/status：登录校验、快照字段（含 eventsSupported）与禁用降级', async () => {
  const fx = await makeLofiiApp()
  try {
    const anonymous = await fx.app.inject({ method: 'GET', url: '/api/mcbot/status' })
    assert.equal(anonymous.statusCode, 401)

    const before = await fx.app.inject({ method: 'GET', url: '/api/mcbot/status', headers: authHeaders() })
    assert.equal(before.statusCode, 200)
    const initial = before.json() as Record<string, unknown>
    assert.equal(initial.enabled, true)
    assert.equal(initial.reachable, false)
    assert.equal(initial.eventsSupported, true)
    assert.equal(initial.controlEnabled, true)
    assert.equal(initial.alertsEnabled, true)
    assert.equal(initial.lastPollAt, null)
    assert.deepEqual(initial.events, [])

    await fx.service.pollOnce()
    const after = await fx.app.inject({ method: 'GET', url: '/api/mcbot/status', headers: authHeaders() })
    const body = after.json() as Record<string, unknown>
    assert.equal(body.reachable, true)
    assert.equal(body.stale, false)
    assert.equal(body.version, '0.6.0')
    assert.equal(body.contractVersion, 2)
    assert.equal(body.eventsSupported, true)
    assert.equal(body.error, null)
    assert.equal(typeof body.lastPollAt, 'string')
    assert.deepEqual(body.status, {
      version: '0.6.0', contractVersion: 2, state: 'connected',
      minecraft: { connected: true }, task: { active: false, state: 'idle', queue: [] },
    })
    assert.equal(body.sayEnabled, true)
    assert.deepEqual(body.events, [])
  } finally {
    await fx.close()
  }

  const disabled = await makeLofiiApp({ config: { mcbotEnabled: false } })
  try {
    const status = await disabled.app.inject({ method: 'GET', url: '/api/mcbot/status', headers: authHeaders() })
    assert.equal(status.statusCode, 200)
    const body = status.json() as Record<string, unknown>
    assert.equal(body.enabled, false)
    assert.equal(body.eventsSupported, false)
    assert.deepEqual(body.events, [])
    assert.equal(disabled.calls.length, 0)

    const blocked = await disabled.app.inject({
      method: 'POST',
      url: '/api/mcbot/tasks/stop',
      headers: authHeaders(),
    })
    assert.equal(blocked.statusCode, 503)
    assert.equal(blocked.json().error.code, 'mcbot_disabled')

    const history = await disabled.app.inject({ method: 'GET', url: '/api/mcbot/history', headers: authHeaders() })
    assert.equal(history.statusCode, 503)
    assert.equal(history.json().error.code, 'mcbot_disabled')
  } finally {
    await disabled.close()
  }
})

test('控制路由：CSRF、上游字段保留、审计动作（不记 say 正文）', async () => {
  const fx = await makeLofiiApp()
  try {
    const noCsrf = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/tasks',
      headers: csrfHeadersOnly(),
      payload: { name: 'fishing' },
    })
    assert.equal(noCsrf.statusCode, 403)
    assert.equal(noCsrf.json().error.code, 'csrf_failed')

    for (const url of ['/api/mcbot/tasks', '/api/mcbot/tasks/resume', '/api/mcbot/move', '/api/mcbot/say', '/api/mcbot/autonomy/start', '/api/mcbot/goals']) {
      const retired = await fx.app.inject({
        method: 'POST',
        url,
        headers: authHeaders(),
        payload: { name: 'fishing', message: '秘密正文', action: 'come', target: 'Antifield', goal: '秘密目标' },
      })
      assert.equal(retired.statusCode, 409, url)
      assert.equal(retired.json().error.code, 'mcbot_control_via_chat')
    }
    assert.equal(fx.calls.filter((call) => ['/task/start', '/task/resume', '/move', '/say', '/autonomy/start', '/goals'].includes(call.url.pathname)).length, 0)

    const stopped = await fx.app.inject({ method: 'POST', url: '/api/mcbot/tasks/stop', headers: authHeaders() })
    assert.equal(stopped.statusCode, 200)
    assert.equal(stopped.json().ok, true)

    const anonymousChat = await fx.app.inject({ method: 'POST', url: '/api/mcbot/chat', payload: { message: '你好' } })
    assert.equal(anonymousChat.statusCode, 401)

    const secret = '去砍点木头 / 然后回家'
    const said = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: secret },
    })
    assert.equal(said.statusCode, 200)
    assert.equal(said.json().status, 'pending')
    const chatCall = fx.calls.find((call) => call.url.pathname === '/admin/chat' && String(call.init.method).toUpperCase() === 'POST')
    assert.ok(chatCall)
    assert.equal(authOf(chatCall), 'Bearer control-token')
    assert.equal(JSON.parse(String(chatCall.init.body)).message, secret)

    const busy = await fx.app.inject({ method: 'GET', url: '/api/mcbot/chat', headers: authHeaders() })
    assert.equal(busy.statusCode, 200)
    assert.equal((busy.json() as { messages: unknown[] }).messages.length, 1)

    const emergency = await fx.app.inject({ method: 'POST', url: '/api/mcbot/emergency-stop', headers: authHeaders() })
    assert.equal(emergency.statusCode, 200)
    assert.deepEqual(emergency.json(), { ok: true, failures: [] })
    const stopCall = fx.calls.find((call) => call.url.pathname === '/emergency-stop')
    assert.equal(authOf(stopCall!), 'Bearer control-token')

    const rows = auditRows(fx.fixture.db)
    const actions = rows.map((row) => row.action)
    assert.ok(actions.includes('mcbot.task.stop'))
    assert.ok(actions.includes('mcbot.chat'))
    assert.ok(actions.includes('mcbot.emergency_stop'))
    assert.ok(!actions.includes('mcbot.task.start'))
    const chatAudit = rows.find((row) => row.action === 'mcbot.chat')
    assert.deepEqual(JSON.parse(chatAudit?.detail_json ?? '{}'), { chars: secret.length })
    const serializedAudit = JSON.stringify(rows)
    assert.ok(!serializedAudit.includes(secret), '审计不得包含聊天正文')
    for (const value of SENSITIVE) {
      assert.ok(!serializedAudit.includes(value), `审计不得包含 ${value}`)
    }
  } finally {
    await fx.close()
  }
})

test('参数校验：任务名/action/taskId/say 长度与 / 前缀、history kind 与时间', async () => {
  const fx = await makeLofiiApp()
  try {
    for (const url of ['/api/mcbot/tasks', '/api/mcbot/move', '/api/mcbot/tasks/resume', '/api/mcbot/say']) {
      const retired = await fx.app.inject({
        method: 'POST',
        url,
        headers: authHeaders(),
        payload: { name: 'cooking', action: 'teleport', taskId: 'a\u0000b', message: '/help' },
      })
      assert.equal(retired.statusCode, 409)
      assert.equal(retired.json().error.code, 'mcbot_control_via_chat')
    }
    assert.equal(fx.calls.filter((call) => ['/task/start', '/move', '/task/resume', '/say'].includes(call.url.pathname)).length, 0)

    const emptyChat = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: '   ' },
    })
    assert.equal(emptyChat.statusCode, 400)

    const longChat = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: 'x'.repeat(2001) },
    })
    assert.equal(longChat.statusCode, 400)

    const slashChat = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: '看看 /help 是否只是文字' },
    })
    assert.equal(slashChat.statusCode, 200)

    const controlCharChat = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: 'hello\u0000world' },
    })
    assert.equal(controlCharChat.statusCode, 400)
    assert.equal(fx.calls.filter((call) => call.url.pathname === '/admin/chat' && String(call.init.method).toUpperCase() === 'POST').length, 1, '非法消息不应发往上游')

    const badKind = await fx.app.inject({
      method: 'GET',
      url: '/api/mcbot/history?kind=bogus',
      headers: authHeaders(),
    })
    assert.equal(badKind.statusCode, 400)

    const badTime = await fx.app.inject({
      method: 'GET',
      url: '/api/mcbot/history?from=not-a-date',
      headers: authHeaders(),
    })
    assert.equal(badTime.statusCode, 400)

    const overLimit = await fx.app.inject({
      method: 'GET',
      url: '/api/mcbot/history?limit=9999',
      headers: authHeaders(),
    })
    assert.equal(overLimit.statusCode, 200)
    const historyCall = fx.calls.find((call) => call.url.pathname === '/history')
    assert.equal(historyCall?.url.searchParams.get('limit'), '100', 'limit 越界回落默认 100')
    assert.equal(authOf(historyCall!), 'Bearer read-token')
  } finally {
    await fx.close()
  }
})

test('history 原样透传上游响应 {kind,from,to,count,samples|alerts}', async () => {
  const upstreamBody = {
    kind: 'alerts',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    count: 1,
    alerts: [{ id: 1, ts: '2026-10-01T01:00:00.000Z', type: 'low_health', severity: 'warning', message: 'x' }],
  }
  const fx = await makeLofiiApp({
    handler: (url) => {
      if (url.pathname === '/history') return json(upstreamBody)
      return defaultHandler(url)
    },
  })
  try {
    const from = '2026-10-01T00:00:00.000Z'
    const to = '2026-10-02T00:00:00.000Z'
    const response = await fx.app.inject({
      method: 'GET',
      url: `/api/mcbot/history?kind=alerts&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50`,
      headers: authHeaders(),
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), upstreamBody)
    const call = fx.calls.find((item) => item.url.pathname === '/history')
    assert.equal(call?.url.searchParams.get('kind'), 'alerts')
    assert.equal(call?.url.searchParams.get('limit'), '50')
    assert.equal(call?.url.searchParams.get('from'), from)
  } finally {
    await fx.close()
  }
})

test('限流：控制 20/min/IP、say 10/min/IP，超限 429 rate_limited', async () => {
  const fx = await makeLofiiApp()
  try {
    for (let index = 0; index < 20; index += 1) {
      const response = await fx.app.inject({ method: 'POST', url: '/api/mcbot/tasks/stop', headers: authHeaders() })
      assert.equal(response.statusCode, 200, `第 ${index + 1} 次控制应放行`)
    }
    const controlLimited = await fx.app.inject({ method: 'POST', url: '/api/mcbot/tasks/stop', headers: authHeaders() })
    assert.equal(controlLimited.statusCode, 429)
    assert.equal(controlLimited.json().error.code, 'rate_limited')
    assert.ok(controlLimited.headers['retry-after'])

    for (let index = 0; index < 10; index += 1) {
      const response = await fx.app.inject({
        method: 'POST',
        url: '/api/mcbot/chat',
        headers: authHeaders(),
        payload: { message: `hi ${index}` },
      })
      assert.equal(response.statusCode, 200, `第 ${index + 1} 次 say 应放行`)
    }
    const sayLimited = await fx.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: 'one too many' },
    })
    assert.equal(sayLimited.statusCode, 429)
    assert.equal(sayLimited.json().error.code, 'rate_limited')
  } finally {
    await fx.close()
  }
})

test('错误映射：unavailable 503 / auth_failed 502 / upstream_error 502 / 上游 400·409 透传', async () => {
  let mode: 'ok' | 'unavailable' | 'auth' | 'upstream' | 'resume' | 'bad' = 'ok'
  const fx = await makeLofiiApp({
    handler: (url) => {
      if (url.pathname === '/status' || url.pathname === '/healthz') return defaultHandler(url)
      if (url.pathname === '/events/recent') {
        return json({ contractVersion: 2, bootId: 'b1', lastEventId: null, events: [] })
      }
      if (mode === 'unavailable') throw new TypeError(`connect ECONNREFUSED http://127.0.0.1:3010/ token read-token control-token`)
      if (mode === 'auth') return json({ error: 'unauthorized', message: 'bad read-token' }, 401)
      if (mode === 'upstream') return json({ error: 'internal_error', message: 'boom' }, 500)
      if (mode === 'resume') return json({ error: 'resume_pending', message: 'pending task; see http://127.0.0.1:3010' }, 409)
      if (mode === 'bad') return json({ error: 'invalid_request', message: 'bad request' }, 400)
      return defaultHandler(url)
    },
  })
  try {
    async function postAndExpect(expectedStatus: number, expectedCode: string): Promise<Record<string, unknown>> {
      const response = await fx.app.inject({
        method: 'POST',
        url: '/api/mcbot/tasks/stop',
        headers: authHeaders(),
        payload: {},
      })
      assert.equal(response.statusCode, expectedStatus)
      const body = response.json() as { error: { code: string; message: string } }
      assert.equal(body.error.code, expectedCode)
      for (const value of SENSITIVE) {
        assert.ok(!body.error.message.includes(value), `错误消息不得包含 ${value}`)
      }
      return response.json() as Record<string, unknown>
    }

    mode = 'unavailable'
    await postAndExpect(503, 'mcbot_unavailable')
    mode = 'auth'
    await postAndExpect(502, 'mcbot_auth_failed')
    mode = 'upstream'
    await postAndExpect(502, 'mcbot_upstream_error')
    mode = 'resume'
    await postAndExpect(409, 'mcbot_resume_pending')
    mode = 'bad'
    await postAndExpect(400, 'mcbot_invalid_request')

    // 失败也必须留下 mcbot.control_failed 审计，且不带敏感信息。
    const failures = auditRows(fx.fixture.db).filter((row) => row.action === 'mcbot.control_failed')
    assert.equal(failures.length, 5)
    assert.deepEqual(
      failures.map((row) => JSON.parse(row.detail_json ?? '{}').code),
      ['mcbot_unavailable', 'mcbot_auth_failed', 'mcbot_upstream_error', 'mcbot_resume_pending', 'mcbot_invalid_request'],
    )
    for (const value of SENSITIVE) {
      assert.ok(!JSON.stringify(failures).includes(value))
    }
  } finally {
    await fx.close()
  }

  // 只读模式（无控制 Token）：任务/移动/聊天写操作均 503 mcbot_control_disabled。
  const readonly = await makeLofiiApp({ config: { mcbotControlToken: '' } })
  try {
    const blocked = await readonly.app.inject({
      method: 'POST',
      url: '/api/mcbot/tasks/stop',
      headers: authHeaders(),
    })
    assert.equal(blocked.statusCode, 503)
    assert.equal(blocked.json().error.code, 'mcbot_control_disabled')

    const chat = await readonly.app.inject({
      method: 'POST',
      url: '/api/mcbot/chat',
      headers: authHeaders(),
      payload: { message: '只读不能对话' },
    })
    assert.equal(chat.statusCode, 503)
    assert.equal(chat.json().error.code, 'mcbot_control_disabled')
  } finally {
    await readonly.close()
  }
})

test('/api/version 增加 mcbotEnabled/mcbotControlEnabled', async () => {
  const dir = tempDataDir()
  const config = testConfig(dir, {
    mcbotEnabled: true,
    mcbotReadToken: 'read-token',
    mcbotControlToken: 'control-token',
  })
  const db = testDb(dir)
  try {
    const files = new FileService(db, config)
    const minecraft = new MinecraftService(db, config)
    const dashboard = new DashboardService(db, config, files, minecraft)
    const app = await createAuthedApp(db, (instance) => {
      registerDashboardRoutes(instance, config, dashboard, db)
    })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/version', headers: authHeaders() })
      assert.equal(response.statusCode, 200)
      const body = response.json() as Record<string, unknown>
      assert.equal(body.mcbotEnabled, true)
      assert.equal(body.mcbotControlEnabled, true)
    } finally {
      await app.close()
    }
  } finally {
    db.close()
    cleanupDir(dir)
  }
})

test('app.ts 接线：AppContext.mcbot / startLofii / 关闭无悬挂定时器，API 可用', async () => {
  const dir = tempDataDir()
  const config = testConfig(dir, { mcbotEnabled: false })
  const db = testDb(dir)
  const seeded = await seedAdmin(db)
  const context = await buildApp(config, db)
  try {
    assert.equal(context.mcbot.snapshot().enabled, false)
    context.startLofii()
    context.startLofii()
    const session = createSession(db, seeded.userId, 'csrf-version', 7, '127.0.0.1', 'test')
    const headers = { cookie: `af_session=${session.token}` }

    const status = await context.app.inject({ method: 'GET', url: '/api/mcbot/status', headers })
    assert.equal(status.statusCode, 200)
    assert.equal(status.json().enabled, false)

    const version = await context.app.inject({ method: 'GET', url: '/api/version', headers })
    assert.equal(version.statusCode, 200)
    assert.equal(version.json().mcbotEnabled, false)
    assert.equal(version.json().mcbotControlEnabled, false)
  } finally {
    await context.app.close()
    db.close()
    cleanupDir(dir)
  }
})
