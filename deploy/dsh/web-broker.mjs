/**
 * DSH Web 的本机 SSO 换票器。启动令牌仅保留在进程内，Unix socket 只返回 DSH 会话 Cookie。
 * 上游固定为本机服务，外部请求不参与构造换票 URL、Host 或任何上游凭据。
 */
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishRuntimeStatus } from './runtime-status.mjs'

const COOKIE_PATTERN = /^(dsh-auth-[A-Za-z0-9_-]{1,128})=([A-Za-z0-9_.~-]{1,4096})$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/
const ANNOUNCEMENT = 'dsh web: '
const MAX_ANNOUNCEMENT_BYTES = 4096

export function advertisedOrigin(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) {
    throw new Error('DSH Web 公网地址必须为 HTTPS 根地址')
  }
  return url.origin
}

export function readLaunchToken(line, origin) {
  if (!line.startsWith(ANNOUNCEMENT) || line.length > MAX_ANNOUNCEMENT_BYTES) return null
  try {
    const url = new URL(line.slice(ANNOUNCEMENT.length))
    const tokens = url.searchParams.getAll('token')
    if (url.origin !== origin || url.pathname !== '/' || url.username || url.password || url.hash) return null
    if ([...url.searchParams].length !== 1 || tokens.length !== 1 || !TOKEN_PATTERN.test(tokens[0])) return null
    return tokens[0]
  } catch {
    return null
  }
}

export function secureDshCookie(headers) {
  if (!Array.isArray(headers) || headers.length !== 1) return null
  const value = headers[0].split(';', 1)[0]
  if (!COOKIE_PATTERN.test(value)) return null
  return `${value}; Path=/; Secure; HttpOnly; SameSite=Strict`
}

function exchangeCookie(port, host, token) {
  return new Promise((resolveExchange, reject) => {
    const upstream = request({
      hostname: '127.0.0.1',
      port,
      path: `/?token=${encodeURIComponent(token)}`,
      headers: { host },
      signal: AbortSignal.timeout(3000),
    }, (response) => {
      response.resume()
      const cookie = response.statusCode === 303 && response.headers.location === './'
        ? secureDshCookie(response.headers['set-cookie'])
        : null
      if (cookie) resolveExchange(cookie)
      else reject(new Error('DSH Cookie 换票失败'))
    })
    upstream.once('error', reject)
    upstream.end()
  })
}

export function runWebBroker({ binary, origin, port, socketPath, apiKey, authMode = 'api-key', statusPath }) {
  const host = new URL(origin).host
  let token = null
  let announcedToken = null
  let line = ''
  let truncated = false
  publishRuntimeStatus(statusPath, false)
  const { CREDENTIALS_DIRECTORY: _credentials, DEEPSEEK_API_KEY: _apiKey, ...env } = process.env
  const patches = ['--patch', fileURLToPath(new URL('./web-policy.yml', import.meta.url))]
  if (authMode === 'account') patches.push('--patch', fileURLToPath(new URL('./web-account.yml', import.meta.url)))
  const policyDir = mkdtempSync(join(tmpdir(), 'dsh-web-policy-'))
  const ready = join(policyDir, 'ready')
  const overlay = join(policyDir, 'workspace.yml')
  const plugin = fileURLToPath(new URL('./web-workspace.mjs', import.meta.url))
  writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'antifield-workspace', name: plugin }] }]), { mode: 0o600, flag: 'wx' })
  patches.push('--patch', fileURLToPath(new URL('./web-scope.yml', import.meta.url)), '--patch', overlay)
  const worker = spawn(process.execPath, [
    binary, '--profile', 'web', ...patches,
    '--no-open', '--host', '127.0.0.1', '--port', String(port), '--public-url', origin, '--trusted-host', host,
  ], { env: { ...env, ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}), DSH_WEB_POLICY_READY: ready }, stdio: ['ignore', 'pipe', 'pipe'] })
  worker.once('close', () => rmSync(policyDir, { recursive: true, force: true }))
  worker.stderr.resume()
  const readinessCheck = setInterval(refreshReadiness, 100)
  readinessCheck.unref()
  function refreshReadiness() {
    if (token !== null || announcedToken === null || !existsSync(ready)) return
    token = announcedToken
    announcedToken = null
    clearInterval(readinessCheck)
    publishRuntimeStatus(statusPath, true)
  }
  worker.stdout.setEncoding('utf8').on('data', (chunk) => {
    for (const character of chunk) {
      if (character === '\n') {
        if (!truncated && token === null && announcedToken === null) {
          announcedToken = readLaunchToken(line.trimEnd(), origin)
          refreshReadiness()
        }
        truncated = false
        line = ''
      } else if (line.length < MAX_ANNOUNCEMENT_BYTES) {
        line += character
      } else {
        truncated = true
      }
    }
  })

  const server = createServer({ requestTimeout: 4000, headersTimeout: 4000 }, async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(token === null ? 503 : 204).end()
      return
    }
    if (req.method !== 'POST' || req.url !== '/session' || req.headers['transfer-encoding']
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      res.writeHead(404).end()
      return
    }
    if (token === null) {
      res.writeHead(503).end()
      return
    }
    try {
      const cookie = await exchangeCookie(port, host, token)
      res.writeHead(204, { 'set-cookie': cookie }).end()
    } catch {
      res.writeHead(503).end()
    }
  })

  const readyTimeout = setTimeout(() => {
    if (token === null) {
      console.error(`DSH Web 未在期限内报告就绪（启动通告=${announcedToken !== null}，工作区=${existsSync(ready)}）`)
      process.exitCode = 1
      stop()
    }
  }, 60_000)
  readyTimeout.unref()
  function stop() {
    token = null
    announcedToken = null
    clearInterval(readinessCheck)
    publishRuntimeStatus(statusPath, false)
    worker.kill('SIGTERM')
    server.closeAllConnections()
    server.close()
  }
  worker.on('error', () => {
    console.error('DSH Web 进程启动失败')
    process.exitCode = 1
    stop()
  })
  worker.on('exit', (code, signal) => {
    token = null
    announcedToken = null
    clearInterval(readinessCheck)
    publishRuntimeStatus(statusPath, false)
    clearTimeout(readyTimeout)
    server.closeAllConnections()
    server.close()
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error('DSH Web 进程异常退出')
      process.exitCode = 1
    }
  })
  server.on('error', () => {
    console.error('DSH Web 换票 socket 无法启动')
    process.exitCode = 1
    stop()
  })
  // 限制 socket 的初始权限，避免 listen 回调之前出现可写窗口。
  const previousMask = process.umask(0o117)
  try {
    server.listen(socketPath, () => chmodSync(socketPath, 0o660))
  } finally {
    process.umask(previousMask)
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

if (import.meta.main) {
  const {
    DSH_BIN, DSH_WEB_ORIGIN, DSH_WEB_PORT = '3080', DSH_WEB_SSO_SOCKET, DSH_STATUS_PATH,
    DSH_WEB_AUTH: authMode = 'api-key', CREDENTIALS_DIRECTORY, DSH_HOME,
  } = process.env
  try {
    const port = Number(DSH_WEB_PORT)
    if (!DSH_BIN || !isAbsolute(DSH_BIN) || !DSH_WEB_SSO_SOCKET || !isAbsolute(DSH_WEB_SSO_SOCKET)
      || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('DSH Web 换票器配置不完整')
    }
    if (authMode !== 'api-key' && authMode !== 'account') throw new Error('未知的 DSH Web 登录模式')
    if (authMode === 'account' && (!DSH_HOME || !isAbsolute(DSH_HOME)
      || !readFileSync(join(DSH_HOME, '.credentials.yaml'), 'utf8').includes('deepseek-account-platform/default:'))) {
      throw new Error('DSH Web 尚未完成账号授权')
    }
    const apiKey = authMode === 'api-key' ? readFileSync(join(CREDENTIALS_DIRECTORY, 'deepseek-key'), 'utf8').trim() : undefined
    if (authMode === 'api-key' && (!apiKey || /\s/.test(apiKey))) throw new Error('模型凭据未配置')
    runWebBroker({ binary: DSH_BIN, origin: advertisedOrigin(DSH_WEB_ORIGIN), port, socketPath: DSH_WEB_SSO_SOCKET,
      apiKey, authMode, statusPath: DSH_STATUS_PATH })
  } catch {
    console.error('DSH Web 换票器配置无效')
    process.exitCode = 1
  }
}
