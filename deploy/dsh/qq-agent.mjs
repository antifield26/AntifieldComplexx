/**
 * 启动独立 QQ Agent。凭据由 systemd 提供，群聊与私聊名单从受限配置读取。
 * 子进程输出只识别就绪标记，聊天正文、平台身份和密钥不进入 journal。
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { publishRuntimeStatus } from './runtime-status.mjs'

const runtime = fileURLToPath(new URL('.', import.meta.url))
const id = /^[A-Za-z0-9_-]{1,128}$/

try {
  process.umask(0o077)
  const { CREDENTIALS_DIRECTORY, DSH_HOME, DSH_QQ_ACCESS, DSH_QQ_MEMORY_DB, DSH_STATUS_PATH } = process.env
  const credential = (name) => readFileSync(join(CREDENTIALS_DIRECTORY, name), 'utf8').trim()
  const apiKey = credential('deepseek-key')
  const appId = credential('qq-app-id')
  const appSecret = credential('qq-app-secret')
  const access = JSON.parse(readFileSync(DSH_QQ_ACCESS, 'utf8'))
  const allowlist = (value) => Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every((entry) => typeof entry === 'string' && id.test(entry))
  if (!apiKey || !appSecret || /\s/.test(apiKey) || /\s/.test(appSecret) || !id.test(appId)
    || !allowlist(access.direct) || !allowlist(access.groups)) {
    throw new Error('QQ Agent 白名单或凭据无效')
  }
  const policyDir = mkdtempSync(join(DSH_HOME, 'policy-'))
  const overlay = join(policyDir, 'qq.yml')
  const config = {
    appId: '__FROM_ENV__', appSecret: '__FROM_ENV__', provider: 'deepseek-official', model: 'deepseek-flash',
    cwd: process.cwd(), requireMention: true, textChunkLimit: 1800, streaming: false,
    debug: false, showToolResults: false, maxQueue: 12, historyLimit: 0,
    sessionIdleTimeout: 600_000, processingTimeoutMs: 120_000,
    access: { c2cMode: 'allowlist', c2cAllow: access.direct, groupMode: 'allowlist', groupAllow: access.groups },
    media: { enabled: true, maxMB: 10, ttlHours: 1 },
    vision: { enabled: true, provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 1024 },
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: false },
  }
  // JSON 是 YAML 的子集。凭据始终通过子进程环境提供。
  const plugin = join(runtime, 'node_modules/@tencent-connect/dsh-qqbot/lib/index.js')
  writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'im-qqbot', name: plugin, config }] }]), {
    mode: 0o600,
    flag: 'wx',
  })
  publishRuntimeStatus(DSH_STATUS_PATH, false, '0.5.5')
  const child = spawn(process.execPath, [
    join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'sdk-minimal',
    '--patch', join(runtime, 'mcbot-minimal.yml'), '--patch', overlay,
  ], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DSH_HOME, DSH_QQ_MEMORY_DB, DEEPSEEK_API_KEY: apiKey, QQBOT_APPID: appId, QQBOT_SECRET: appSecret },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.on('error', () => undefined)
  child.stderr.resume()
  let stopping = false
  let ready = false
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (line === 'antifieldcomplexx-qq-ready' || line === 'antifieldcomplexx-qq-disconnected') {
      ready = line === 'antifieldcomplexx-qq-ready'
      publishRuntimeStatus(DSH_STATUS_PATH, ready, '0.5.5')
    }
  })
  const health = setInterval(() => {
    if (!ready) console.warn('DSH QQ 网关尚未就绪')
  }, 60_000)
  health.unref()
  const stop = () => {
    stopping = true
    child.kill('SIGTERM')
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  child.once('error', () => {
    console.error('DSH QQ Agent 启动失败')
    process.exitCode = 1
  })
  child.once('close', () => {
    clearInterval(health)
    publishRuntimeStatus(DSH_STATUS_PATH, false, '0.5.5')
    rmSync(policyDir, { recursive: true, force: true })
    if (!stopping) process.exitCode = 1
  })
} catch {
  console.error('DSH QQ Agent 配置无效')
  process.exitCode = 1
}
