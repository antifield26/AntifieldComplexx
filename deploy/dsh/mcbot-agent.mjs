/**
 * 独立 Minecraft Agent 运行器。只有 mcbot 可通过专用 socket 发起文本或自主会话。
 * 模型进程仅继承自己的凭据。每次运行的会话文件和工具凭据均存放在专用目录。
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { validateBinding } from './dsh-mcbot.mjs'
import { publishRuntimeStatus } from './runtime-status.mjs'

const runtime = fileURLToPath(new URL('.', import.meta.url))
const MAX_BYTES = 256 * 1024
const TEXT_LIMIT = 16_000
const MAX_TEXT_RUNS = 2

function readPayload(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BYTES) req.destroy()
      else chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('aborted', reject)
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
        resolve(payload)
      } catch {
        reject(new Error('无效的 Minecraft Agent 请求'))
      }
    })
  })
}

function makeRun(config, tools) {
  const id = `session-${randomUUID()}`
  const home = mkdtempSync(join(config.home, 'run-'))
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    DEEPSEEK_API_KEY: config.apiKey,
    DSH_SYSTEM_PROMPT: '你是 Minecraft 助手。按本轮明确给出的目标和约束行动。',
  }
  const patches = [join(runtime, 'mcbot-minimal.yml')]
  try {
    if (tools) {
      const binding = validateBinding({ ...tools, socketPath: config.toolSocket, sessionId: id })
      env.DSH_MCBOT_BINDING = join(home, 'tool-binding.json')
      writeFileSync(env.DSH_MCBOT_BINDING, JSON.stringify(binding), { mode: 0o600, flag: 'wx' })
      const overlay = join(home, 'autonomy.yml')
      writeFileSync(overlay, `- insert:\n    - id: dsh-mcbot\n      name: ${JSON.stringify(join(runtime, 'dsh-mcbot.mjs'))}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      patches.push(overlay)
    }
    const harness = new DeepSeekHarness({
      dshBin: join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      profile: 'sdk-minimal',
      dshHome: home,
      processCwd: home,
      patches,
      env,
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      initializeTimeoutMs: 7000,
      shutdownTimeoutMs: 750,
      disposeEofGraceMs: 1000,
      disposeGraceMs: 1500,
      maxTokens: tools ? 4096 : 2048,
    })
    let closing
    return {
      id,
      harness,
      result: null,
      pending: false,
      async start() {
        await harness.start()
        if (tools && !existsSync(env.DSH_MCBOT_BINDING + '.ready')) {
          throw new Error('DSH 自主工具未完成注册')
        }
      },
      close() {
        closing ??= harness.close().then(() => rmSync(home, { recursive: true, force: true }))
        return closing
      },
    }
  } catch (error) {
    rmSync(home, { recursive: true, force: true })
    throw error
  }
}

async function prompt(run, text) {
  const result = await run.harness.session(run.id).run([{ type: 'text', text }])
  if (['error', 'cancelled', 'aborted'].includes(result.finishReason)) throw new Error('模型回合未完成')
  return result.finalResponse.slice(0, TEXT_LIMIT)
}

function send(res, status, data) {
  if (res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

export function startAgent(config) {
  const textRuns = new Set()
  let autonomy = null
  let ready = false
  let stopping = false
  let probe
  const server = createServer({ requestTimeout: 8000, headersTimeout: 4000 }, async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      send(res, ready && !stopping ? 200 : 503, { ready: ready && !stopping, version: '0.2.2-rc.1' })
      return
    }
    if (req.method !== 'POST' || !ready || stopping) {
      send(res, 503, { error: 'agent_unavailable' })
      return
    }
    try {
      const data = await readPayload(req)
      if (req.url === '/text') {
        if (typeof data.prompt !== 'string' || data.prompt.length === 0 || data.prompt.length > 48_000) {
          send(res, 400, { error: 'invalid_prompt' })
          return
        }
        if (textRuns.size >= MAX_TEXT_RUNS) {
          send(res, 409, { error: 'agent_busy' })
          return
        }
        const run = makeRun(config)
        textRuns.add(run)
        res.once('close', () => { if (!res.writableEnded) void run.close().catch(fatalCleanup) })
        try {
          send(res, 200, { text: await prompt(run, data.prompt) })
        } finally {
          await run.close().catch(fatalCleanup)
          textRuns.delete(run)
        }
      } else if (req.url === '/run/start') {
        if (autonomy) {
          send(res, 409, { error: 'agent_busy' })
          return
        }
        const run = makeRun(config, { tools: data.tools, bearer: data.bearer })
        autonomy = run
        res.once('close', () => { if (!res.writableEnded) void closeAutonomy(run).catch(fatalCleanup) })
        try {
          await run.start()
          send(res, 200, { id: run.id })
        } catch {
          await closeAutonomy(run)
          send(res, 503, { error: 'agent_unavailable' })
        }
      } else {
        const run = autonomy
        if (!run || data.id !== run.id) {
          send(res, req.url === '/run/stop' ? 200 : 404, { error: 'run_not_found' })
          return
        }
        if (req.url === '/run/prompt') {
          if (run.pending || typeof data.text !== 'string' || data.text.length === 0 || data.text.length > 48_000) {
            send(res, 409, { error: 'run_busy_or_invalid_prompt' })
            return
          }
          run.pending = true
          run.result = prompt(run, data.text).then(
            (text) => ({ text }),
            () => ({ error: 'turn_failed' }),
          ).finally(() => { run.pending = false })
          send(res, 200, { ok: true })
        } else if (req.url === '/run/wait') {
          const result = run.result ? await run.result : { text: '' }
          send(res, result.error ? 502 : 200, result)
        } else if (req.url === '/run/stop') {
          await closeAutonomy(run)
          send(res, 200, { ok: true })
        } else {
          send(res, 404, { error: 'unknown_operation' })
        }
      }
    } catch {
      send(res, 503, { error: 'agent_unavailable' })
    }
  })

  async function closeAutonomy(run) {
    try {
      await run.close()
      if (autonomy === run) autonomy = null
    } catch (error) {
      fatalCleanup()
      throw error
    }
  }
  function fatalCleanup() {
    console.error('DSH Minecraft Agent 子进程清理失败')
    process.exitCode = 1
    void stop()
  }
  async function stop() {
    if (stopping) return
    stopping = true
    publishRuntimeStatus(config.statusPath, false)
    server.close()
    server.closeAllConnections()
    const results = await Promise.allSettled([
      ...[...textRuns].map((run) => run.close()),
      ...(autonomy ? [autonomy.close()] : []),
      ...(probe ? [probe.close()] : []),
    ])
    if (results.some((result) => result.status === 'rejected')) process.exit(1)
  }
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
  server.on('error', fatalCleanup)
  publishRuntimeStatus(config.statusPath, false)
  server.listen(config.socket, () => {
    try {
      chmodSync(config.socket, 0o660)
      probe = makeRun(config)
      void probe.start().then(() => probe.close()).then(() => {
        probe = null
        if (stopping) return
        ready = true
        publishRuntimeStatus(config.statusPath, true)
      }).catch(fatalCleanup)
    } catch {
      fatalCleanup()
    }
  })
}

try {
  process.umask(0o077)
  const { DSH_AGENT_SOCKET: socket, DSH_MCBOT_TOOL_SOCKET: toolSocket, DSH_HOME: home, CREDENTIALS_DIRECTORY } = process.env
  if (![socket, toolSocket, home, CREDENTIALS_DIRECTORY].every((value) => typeof value === 'string' && isAbsolute(value))) {
    throw new Error()
  }
  const apiKey = readFileSync(join(CREDENTIALS_DIRECTORY, 'deepseek-key'), 'utf8').trim()
  if (!apiKey || /\s/.test(apiKey)) throw new Error()
  startAgent({ socket, toolSocket, home, apiKey, statusPath: process.env.DSH_STATUS_PATH })
} catch {
  console.error('DSH Minecraft Agent 配置不完整')
  process.exitCode = 1
}
