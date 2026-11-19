/**
 * 启动独立 QQ Agent。模型凭据由 systemd 提供，QQ 平台凭据与白名单属于独立绑定文件。
 * 子进程输出只识别就绪标记，聊天正文、平台身份和密钥不进入 journal。
 */
import { fork, spawn } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { publishRuntimeStatus } from './runtime-status.mjs'
import { createQqWatchdog } from './qq-watchdog.mjs'
import { bindingServer, QqBindingManager, readBinding, writeBinding } from './qq-binding.mjs'

const runtime = fileURLToPath(new URL('.', import.meta.url))
const { CREDENTIALS_DIRECTORY, DSH_HOME, DSH_QQ_MEMORY_DB, DSH_STATUS_PATH,
  DSH_QQ_BINDING, DSH_QQ_SOCKET } = process.env
const credential = (name) => readFileSync(join(CREDENTIALS_DIRECTORY, name), 'utf8').trim()

function spawnGateway({ appId, appSecret, direct, groups }, apiKey, onStatus) {
  const policyDir = mkdtempSync(join(DSH_HOME, 'policy-'))
  const overlay = join(policyDir, 'qq.yml')
  const config = {
    appId: '__FROM_ENV__', appSecret: '__FROM_ENV__', provider: 'deepseek-official', model: 'deepseek-flash',
    cwd: process.cwd(), requireMention: true, textChunkLimit: 1800, streaming: false,
    debug: false, showToolResults: false, maxQueue: 12, historyLimit: 0,
    sessionIdleTimeout: 600_000, processingTimeoutMs: 120_000,
    access: { c2cMode: 'allowlist', c2cAllow: direct, groupMode: 'allowlist', groupAllow: groups },
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
  const child = spawn(process.execPath, [
    join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'sdk-minimal',
    '--patch', join(runtime, 'mcbot-minimal.yml'), '--patch', overlay,
  ], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DSH_HOME, DSH_QQ_MEMORY_DB, DEEPSEEK_API_KEY: apiKey, QQBOT_APPID: appId, QQBOT_SECRET: appSecret },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.on('error', () => undefined)
  child.stderr.resume()
  const ready = Promise.withResolvers()
  const closed = Promise.withResolvers()
  const watchdog = createQqWatchdog(child, (value) => {
    if (value) ready.resolve()
    onStatus()
  }, {
    report: (message) => console.warn(message),
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (line === 'antifieldcomplexx-qq-ready' || line === 'antifieldcomplexx-qq-disconnected') {
      watchdog.status(line === 'antifieldcomplexx-qq-ready')
    }
  })
  child.once('error', () => ready.reject(new Error('QQ 网关无法启动')))
  child.once('close', () => {
    watchdog.close()
    try { rmSync(policyDir, { recursive: true, force: true }) } catch { console.warn('QQ 临时策略清理失败') }
    ready.reject(new Error('QQ 网关已退出'))
    closed.resolve()
    onStatus()
  })
  return { ready: ready.promise, closed: closed.promise, stop: watchdog.stop, watchdog }
}

function scan(receive) {
  const worker = fork(join(runtime, 'qq-scan.mjs'), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} })
  let active = true
  worker.on('message', (event) => {
    if (active && event && typeof event === 'object') receive(event)
  })
  worker.once('error', () => { if (active) receive({ failed: true }) })
  worker.once('exit', () => { if (active) receive({ failed: true }) })
  return () => { active = false; worker.kill() }
}

async function main() {
  process.umask(0o077)
  const apiKey = credential('deepseek-key')
  if (!apiKey || /\s/.test(apiKey) || !DSH_QQ_BINDING || !DSH_QQ_SOCKET) throw new Error()
  const initial = readBinding(DSH_QQ_BINDING)

  let gateway
  let stopping = false
  let switching = false
  let queued = Promise.resolve()
  let manager
  const readiness = () => gateway?.watchdog.ready === true
  const publish = () => {
    const state = manager.view('')
    try { publishRuntimeStatus(DSH_STATUS_PATH, state.ready, '0.5.5', { bindingPhase: state.phase }) }
    catch { console.warn('QQ 就绪状态写入失败') }
  }
  async function applyGateway(binding) {
    switching = true
    try {
      if (gateway) {
        gateway.stop()
        await gateway.closed
        gateway = undefined
      }
      if (stopping || !binding) return
      const next = spawnGateway(binding, apiKey, publish)
      gateway = next
      await next.ready
    } finally {
      switching = false
    }
  }
  function switchGateway(binding) {
    const next = queued.then(() => applyGateway(binding))
    queued = next.catch(() => undefined)
    return next
  }
  manager = new QqBindingManager({
    binding: initial, switchGateway, persist: (binding) => writeBinding(DSH_QQ_BINDING, binding),
    scan, readiness, onChange: publish,
  })
  const server = bindingServer(manager)
  const reconnect = setInterval(() => {
    if (!switching) void manager.reconnect()
  }, 30_000)
  reconnect.unref()
  function stop(code = 0) {
    if (stopping) return
    stopping = true
    manager.close()
    clearInterval(reconnect)
    gateway?.stop()
    server.closeAllConnections()
    server.close()
    process.exitCode = code
  }
  server.on('error', () => stop(1))
  process.once('SIGTERM', () => stop())
  process.once('SIGINT', () => stop())
  // setgid 运行目录给 Workbench 组继承；侦听开始时即限制为 0660。
  const previousMode = process.umask(0o117)
  try { server.listen(DSH_QQ_SOCKET, () => chmodSync(DSH_QQ_SOCKET, 0o660)) }
  finally { process.umask(previousMode) }
  publish()
  await manager.reconnect()
}

try { await main() } catch {
  console.error('DSH QQ Agent 配置无效')
  process.exitCode = 1
}
