/** 固定包的进程级验证。QQ Gateway 使用本地夹具，模型凭据为占位值。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { WebSocketServer } from 'ws'
import { buildToolDefinitions } from '../../apps/mcbot/src/autonomy/tools.ts'
import { QqMemory, qqScope } from './qq-memory.mjs'
import { apply as registerWorkspace } from './web-workspace.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const bin = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const patch = join(root, 'mcbot-minimal.yml')
const temp = await mkdtemp(join(tmpdir(), 'antifield-dsh-test-'))
const env = { PATH: process.env.PATH, HOME: temp, DEEPSEEK_API_KEY: 'dsh-fixture-key' }
const cleared = Promise.withResolvers()
const server = createServer((request, response) => {
  if (request.url === '/app/getAppAccessToken') response.end(JSON.stringify({ access_token: 'qq-fixture-token', expires_in: 7200 }))
  else if (request.url === '/gateway') response.end(JSON.stringify({ url: `ws://127.0.0.1:${server.address().port}/gateway` }))
  else if (request.method === 'POST' && request.url === '/v2/users/user/messages') {
    let body = ''
    request.setEncoding('utf8').on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      if (body.includes('可确认属于你的记忆已清除')) cleared.resolve()
      response.end(JSON.stringify({ id: 'fixture-reply' }))
    })
  }
  else response.writeHead(404).end()
})
const ws = new WebSocketServer({ server })
const connected = Promise.withResolvers()
ws.on('connection', (socket) => {
  socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }))
  socket.on('message', (body) => {
    if (JSON.parse(body).op !== 2) return
    socket.send(JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'gateway-test', user: { id: 'qq-fixture' } } }))
    connected.resolve(socket)
  })
})
let child
let harness

/** 实际固定 QQ 插件面对本地假平台负路径，不得发布 ready 或触及真实平台。 */
async function verifyQqFailures() {
  for (const status of [401, 429, 503]) {
    let tokenCalls = 0
    let gatewayCalls = 0
    const failed = createServer((req, res) => {
      if (req.url === '/app/getAppAccessToken') tokenCalls += 1
      else if (req.url === '/gateway') gatewayCalls += 1
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '1' } : {}) })
      res.end(JSON.stringify({ code: status, message: 'fixture unavailable' }))
    })
    failed.listen(0, '127.0.0.1')
    await once(failed, 'listening')
    const origin = `http://127.0.0.1:${failed.address().port}`
    const overlay = join(temp, `qq-failure-${status}.yml`)
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'im-qqbot', name: join(root, 'node_modules/@tencent-connect/dsh-qqbot/lib/index.js'), config: {
      appId: '__FROM_ENV__', appSecret: '__FROM_ENV__', provider: 'deepseek-official', model: 'deepseek-flash', cwd: temp,
      access: { c2cMode: 'allowlist', c2cAllow: ['user'], groupMode: 'allowlist', groupAllow: ['group'] },
      requireMention: true, historyLimit: 0, media: { enabled: false },
    } }] }]))
    const candidate = spawn(process.execPath, [bin, '--profile', 'sdk-minimal', '--patch', patch, '--patch', overlay], {
      cwd: temp, env: { ...env, DSH_HOME: join(temp, `qq-failure-${status}`), DSH_QQ_MEMORY_DB: join(temp, `qq-failure-${status}.sqlite`), QQBOT_APPID: 'testappid', QQBOT_SECRET: 'qq-fixture-secret', QQBOT_BASE_URL: origin, QQBOT_TOKEN_BASE_URL: origin },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    for (const stream of [candidate.stdout, candidate.stderr]) stream.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-8000) })
    const exited = once(candidate, 'exit')
    try {
      const deadline = Date.now() + 12_000
      while (!tokenCalls && candidate.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      assert.ok(tokenCalls > 0, `QQ ${status} 夹具未收到实际插件请求：${output.replaceAll('qq-fixture-secret', '<fixture>').replaceAll('dsh-fixture-key', '<fixture>')}`)
      await new Promise(resolve => setTimeout(resolve, 1200))
      assert.equal(gatewayCalls, 0, `QQ ${status} 不应连接网关`)
      assert.ok(tokenCalls <= 3, `QQ ${status} 不得密集重试`)
      assert.ok(!output.includes('antifieldcomplexx-qq-ready'), `QQ ${status} 不得虚报就绪`)
      assert.ok(!output.includes('qq-fixture-secret'), `QQ ${status} 日志不得包含凭据`)
    } finally {
      if (candidate.exitCode === null && candidate.signalCode === null) candidate.kill()
      const force = setTimeout(() => candidate.kill('SIGKILL'), 4000)
      try { await exited } finally { clearTimeout(force) }
      failed.closeAllConnections()
      await new Promise(resolve => failed.close(resolve))
    }
  }
  console.log('固定 DSH QQ 已通过凭据拒绝、限流与平台不可用负路径，无真实平台请求')
}

async function verifyWorkspace() {
  const cwd = process.cwd()
  const directory = join(temp, 'workspace')
  await mkdir(directory)
  const secret = join(temp, 'fixture-credential')
  await writeFile(secret, 'private-test-value')
  await writeFile(join(directory, 'example.txt'), 'workspace fixture')
  await symlink(secret, join(directory, 'outside'))
  const definitions = new Map()
  let guard
  let approve = false
  const ctx = {
    tools: {
      register(definition) { definitions.set(definition.name, definition) },
      guard(check) { guard = check },
    },
    approval: { request: async () => approve ? 'allowed-once' : 'rejected' },
  }
  const envName = 'DSH_WEB_POLICY_READY'
  const original = process.env[envName]
  try {
    process.chdir(directory)
    process.env[envName] = join(temp, 'workspace.ready')
    await registerWorkspace(ctx)
  } finally {
    process.chdir(cwd)
    if (original === undefined) delete process.env[envName]
    else process.env[envName] = original
  }
  const execution = { agent: {}, signal: AbortSignal.timeout(6000) }
  assert.equal(await definitions.get('workspace_read').execute({ path: 'example.txt' }, execution), 'workspace fixture')
  await assert.rejects(definitions.get('workspace_read').execute({ path: 'outside' }, execution))
  assert.equal(typeof guard({ name: 'bash', agent: {} }), 'string')
  const command = definitions.get('workspace_command')
  await assert.rejects(command.execute({ command: 'echo forbidden' }, execution))
  approve = true
  const output = await command.execute({ command: 'test ! -e /run/credentials && test ! -e /var/lib && test ! -e /proc/self/environ && test -z "$DEEPSEEK_API_KEY" && printf allowed' }, execution)
  assert.equal(output, 'allowed')
  console.log('DSH Web 工作区已通过越界读取、审批拒绝及凭据隔离检查')
}

async function verifyWebBroker() {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((done) => reservation.close(done))
  const directory = join(temp, 'credentials')
  const socketPath = join(temp, 'sso.sock')
  await mkdir(directory, { mode: 0o700 })
  await writeFile(join(directory, 'deepseek-key'), 'dsh-fixture-key', { mode: 0o600 })
  const entry = join(temp, 'web-broker.mjs')
  await symlink(join(root, 'web-broker.mjs'), entry)
  const broker = spawn(process.execPath, [entry], {
    cwd: temp,
    env: {
      PATH: process.env.PATH, HOME: temp, DSH_HOME: join(temp, 'web'), CREDENTIALS_DIRECTORY: directory,
      DSH_BIN: bin, DSH_WEB_ORIGIN: 'https://ai.example.test', DSH_WEB_PORT: String(port), DSH_WEB_SSO_SOCKET: socketPath,
    },
    stdio: 'ignore',
  })
  try {
    const deadline = Date.now() + 15_000
    for (;;) {
      const result = await new Promise((resolve) => {
        const exchange = request({ socketPath, path: '/session', method: 'POST', signal: AbortSignal.timeout(4000) }, (response) => {
          response.resume()
          resolve(response.headers['set-cookie']?.[0] ?? null)
        })
        exchange.on('error', () => resolve(null))
        exchange.end()
      })
      if (result) {
        assert.match(result, /^dsh-auth-[\w-]+=[\w.~-]+; Path=\/; Secure; HttpOnly; SameSite=Strict$/u)
        const settingsReply = await new Promise((resolve, reject) => {
          const settings = request({
            host: '127.0.0.1', port, path: '/api/settings/describe', method: 'POST',
            headers: {
              host: 'ai.example.test', origin: 'https://ai.example.test',
              cookie: result.split(';', 1)[0], 'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(4000),
          }, (response) => {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('error', reject)
            response.on('end', () => resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
            }))
          })
          settings.on('error', reject)
          settings.end(JSON.stringify({
            type: 'client-request', rpcId: 'smoke-settings', method: 'settings/describe', payload: { args: {} },
          }))
        })
        assert.equal(settingsReply.status, 200, '原生换票后设置控制器必须可达')
        assert.equal(JSON.parse(settingsReply.body).result?.ok, true, '设置接口必须成功完成 RPC')
        console.log('固定 DSH Web 已通过 Unix socket 原生换票及设置 API')
        return
      }
      if (Date.now() >= deadline || broker.exitCode !== null) throw new Error('DSH Web 换票器未就绪')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    if (broker.exitCode === null && broker.signalCode === null) {
      broker.kill()
      await once(broker, 'exit')
    }
  }
}

try {
  await verifyQqFailures()
  const binding = join(temp, 'tool-binding.json')
  const autonomy = join(temp, 'autonomy.yml')
  if (process.platform !== 'win32') {
    await verifyWorkspace()
    await verifyWebBroker()
    await writeFile(binding, JSON.stringify({
      socketPath: join(temp, 'tools.sock'), bearer: 'mcbot-fixture-binding-token',
      sessionId: 'session-runtime-test', tools: buildToolDefinitions(),
    }), { mode: 0o600 })
    await writeFile(autonomy, JSON.stringify([{ insert: [{ id: 'dsh-mcbot', name: join(root, 'dsh-mcbot.mjs') }] }]))
    harness = new DeepSeekHarness({
      dshBin: bin, profile: 'sdk-minimal', dshHome: join(temp, 'mcbot'), processCwd: temp,
      patches: [patch, autonomy], env: { ...env, DSH_MCBOT_BINDING: binding }, provider: 'deepseek-official', model: 'deepseek-flash',
    })
    await harness.start()
    assert.equal(await readFile(binding + '.ready', 'utf8'), 'ready\n')
    await harness.close()
    harness = undefined
    console.log('固定 DSH SDK 已加载 dsh-mcbot 的 13 个工具')
  }

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const overlay = join(temp, 'qq.yml')
  const dbPath = join(temp, 'memory.sqlite')
  const scope = qqScope('testappid', 'c2c', 'user', 'user')
  const groupScope = qqScope('testappid', 'group', 'group', 'user')
  const otherScope = qqScope('testappid', 'group', 'group', 'other')
  const memory = new QqMemory(dbPath)
  const candidate = memory.propose(scope, { op: 'upsert', category: 'fact', key: 'fixture', value: '模拟数据' })
  const groupCandidate = memory.propose(groupScope, { op: 'upsert', category: 'fact', key: 'fixture', value: '群聊模拟数据' })
  const otherCandidate = memory.propose(otherScope, { op: 'upsert', category: 'fact', key: 'fixture', value: '其他成员模拟数据' })
  memory.db.close()
  await writeFile(overlay, JSON.stringify([{ insert: [{
    id: 'im-qqbot', name: join(root, 'node_modules/@tencent-connect/dsh-qqbot/lib/index.js'), config: {
      appId: '__FROM_ENV__', appSecret: '__FROM_ENV__', provider: 'deepseek-official', model: 'deepseek-flash', cwd: temp,
      access: { c2cMode: 'allowlist', c2cAllow: ['user'], groupMode: 'allowlist', groupAllow: ['group'] },
      requireMention: true, historyLimit: 0, media: { enabled: false },
      vision: { enabled: true, provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 1024 },
    },
  }] }]))
  child = spawn(process.execPath, [bin, '--profile', 'sdk-minimal', '--patch', patch, '--patch', overlay], {
    cwd: temp,
    env: {
      ...env, DSH_HOME: join(temp, 'qq'), DSH_QQ_MEMORY_DB: dbPath,
      QQBOT_APPID: 'testappid', QQBOT_SECRET: 'qq-fixture-secret', QQBOT_BASE_URL: origin, QQBOT_TOKEN_BASE_URL: origin,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const ready = Promise.withResolvers()
  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk) => {
      output = (output + chunk).slice(-8000)
      if (output.includes('antifieldcomplexx-qq-ready')) ready.resolve()
    })
  }
  const time = AbortSignal.timeout(12_000)
  try {
    const driveGateway = async () => {
      const [socket] = await Promise.all([connected.promise, ready.promise])
      socket.send(JSON.stringify({ op: 0, s: 2, t: 'C2C_MESSAGE_CREATE', d: {
        author: { user_openid: 'user' }, id: 'fixture-message', content: '/forget confirm', timestamp: new Date().toISOString(),
      } }))
      await cleared.promise
    }
    await Promise.race([
      driveGateway(),
      once(child, 'exit').then(([status]) => { throw new Error(`QQ 插件退出 ${status}`) }),
      once(time, 'abort').then(() => { throw new Error('QQ 本地网关握手超时') }),
    ])
  } catch (error) {
    throw new Error(error.message + '\n' + output)
  }
  assert.ok(output.includes('antifieldcomplexx-qq-ready'))
  const verified = new QqMemory(dbPath)
  try {
    assert.equal(verified.review(candidate, true), false)
    assert.equal(verified.review(groupCandidate, true), false)
    assert.equal(verified.review(otherCandidate, true), true)
    assert.ok(verified.generation('testappid', 'user'))
    assert.equal(verified.generation('testappid', 'other'), null)
  } finally {
    verified.db.close()
  }
  console.log('固定 QQ 插件已通过本地网关握手和私聊清除')
} finally {
  await harness?.close()
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill()
    await once(child, 'exit')
  }
  for (const client of ws.clients) client.terminate()
  ws.close()
  server.close()
  await rm(temp, { recursive: true, force: true })
}
