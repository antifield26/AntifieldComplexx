/**
 * 公网管理入口开关。
 * PUBLIC_APP_SHELL 关闭且 Host 是应用公网主机时，不提供管理 SPA、PWA 与静态资源；
 * 只返回说明页和由服务端渲染的分享页。loopback Host 始终提供完整界面。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.ts'
import { SlidingWindowLimiter } from '../auth/limiter.ts'
import type { ShareService } from '../shares/service.ts'
import { SHARE_SESSION_TTL_SECONDS } from '../shares/service.ts'
import { AppError, rateLimited } from '../util/errors.ts'
import { sha256Hex } from '../util/ids.ts'
import { hostFromOrigin, isLoopbackHostname, normalizeHost } from './host.ts'
import { requestMeta } from './request-meta.ts'
import { assertPublicShareOrigin, setShareCookie } from './routes/shares.ts'
import { clientIp, wantsHtml } from './util.ts'

const SHELL_FILES = new Set(['/sw.js', '/manifest.webmanifest', '/offline.html', '/favicon.svg', '/index.html'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

const NOTICE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>AntifieldComplexx</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0a0e14; color: #e8eef7; }
  main { max-width: 28rem; margin: 4rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.5rem; font-weight: 650; }
  p { line-height: 1.6; color: #b7c3d4; }
</style>
</head>
<body>
<main>
  <h1>请使用客户端</h1>
  <p>管理功能由 AntifieldComplexx 客户端提供。公开分享链接仍可在浏览器中打开。</p>
</main>
</body>
</html>
`

export function requestPathname(url: string | undefined): string {
  const raw = url && url.length > 0 ? url : '/'
  const end = raw.search(/[?#]/)
  const path = end === -1 ? raw : raw.slice(0, end)
  return path.startsWith('/') ? path : `/${path}`
}

export function hidesPublicShell(config: Config, hostHeader: string | undefined): boolean {
  if (config.publicAppShell) return false
  const host = normalizeHost(hostHeader)
  if (host === '' || isLoopbackHostname(host)) return false
  return host === hostFromOrigin(config.appOrigin)
}

export function isPublicShellAsset(path: string): boolean {
  return SHELL_FILES.has(path) || path.startsWith('/assets/') || path.startsWith('/icons/')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0a0e14; color: #e8eef7; }
  main { max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.25rem; overflow-wrap: anywhere; }
  p, li { line-height: 1.5; color: #b7c3d4; }
  a { color: #8ec5ff; }
  form { margin-top: 1rem; }
  input, button { font: inherit; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.5rem; }
  button { margin-top: 0.75rem; padding: 0.45rem 0.9rem; }
  .error { color: #ffb4b4; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}

function sendHtml(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply.code(status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html)
}

function shareCookieValue(request: FastifyRequest): string | null {
  const value = request.cookies?.af_share
  return typeof value === 'string' && value.length > 0 ? value : null
}

function writePageShareCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  token: string,
  value: string,
): void {
  const secure = requestMeta(request).protocol === 'https'
  reply.setCookie('af_share', value, {
    path: `/s/${token}`,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SHARE_SESSION_TTL_SECONDS,
  })
}

function renderShare(token: string, info: {
  share: {
    fileName: string
    totalSizeBytes: number
    itemCount: number
    mime: string | null
    items?: { id: string; name: string; size: number }[]
  }
  requiresPassword: boolean
}, passwordError: string | null): string {
  const share = info.share
  const count = share.itemCount > 0 ? share.itemCount : 1
  const heading = count > 1 ? `${count} 个文件` : escapeHtml(share.fileName)
  const subtitle = `${formatBytes(share.totalSizeBytes)}${count > 1 ? ` · ${count} 个文件` : share.mime ? ` · ${escapeHtml(share.mime)}` : ''}`
  if (info.requiresPassword) {
    const error = passwordError ? `<p class="error">${escapeHtml(passwordError)}</p>` : ''
    return page('文件分享', `
<h1>${heading}</h1>
<p>${subtitle}</p>
<p>该分享需要密码。</p>
${error}
<form method="post" action="/s/${token}/unlock">
  <label>分享密码
    <input type="password" name="password" autocomplete="current-password" required>
  </label>
  <button type="submit">解锁</button>
</form>`)
  }
  const items = share.items ?? []
  const links = count > 1
    ? `<ul>${items.map((item) => `<li><a href="/api/public/shares/${token}/items/${encodeURIComponent(item.id)}/content">${escapeHtml(item.name)}</a> · ${formatBytes(item.size)}</li>`).join('')}</ul>`
    : `<p><a href="/api/public/shares/${token}/content">下载</a></p>`
  return page('文件分享', `
<h1>${heading}</h1>
<p>${subtitle}</p>
${links}`)
}

function renderShareError(error: AppError): { status: number; html: string } {
  const title = error.statusCode === 404 ? '分享不存在' : error.statusCode === 410 ? '分享已失效' : '无法打开分享'
  return { status: error.statusCode, html: page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(error.message)}</p>`) }
}

export async function registerPublicShell(
  app: FastifyInstance,
  config: Config,
  shares: ShareService,
  webRoot: string,
  hasWeb: boolean,
): Promise<void> {
  const metadataLimiter = new SlidingWindowLimiter(60_000, 120)
  const unlockLimiter = new SlidingWindowLimiter(15 * 60_000, 8)
  const unlockGlobalLimiter = new SlidingWindowLimiter(15 * 60_000, 100)

  await app.register(async (scope) => {
    // 只在分享页作用域解析表单，避免覆盖 Webhook 自己的原始正文解析器。
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 4096 },
      (_request, body, done) => {
        done(null, typeof body === 'string' ? body : Buffer.from(body).toString('utf8'))
      },
    )

    function limit(limiter: SlidingWindowLimiter, key: string): void {
      const retry = limiter.hit(key)
      if (retry > 0) throw rateLimited(retry)
    }

    scope.get('/s/:token', async (request, reply) => {
      if (!hidesPublicShell(config, request.headers.host)) {
        if ((request.method === 'GET' || request.method === 'HEAD') && wantsHtml(request) && hasWeb) {
          return reply.type('text/html; charset=utf-8').sendFile('index.html', webRoot)
        }
        return reply.code(404).send({ error: { code: 'not_found', message: '未找到' } })
      }
      const token = (request.params as { token: string }).token
      if (!wantsHtml(request)) {
        return reply.code(404).send({ error: { code: 'not_found', message: '未找到' } })
      }
      if (!TOKEN_PATTERN.test(token)) {
        const rendered = renderShareError(new AppError(404, 'not_found', '分享链接不存在'))
        return sendHtml(reply, rendered.status, rendered.html)
      }
      try {
        limit(metadataLimiter, clientIp(request))
        const info = shares.metadata(token, shareCookieValue(request))
        return sendHtml(reply, 200, renderShare(token, info, null))
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 429) throw error
        if (error instanceof AppError) {
          const rendered = renderShareError(error)
          return sendHtml(reply, rendered.status, rendered.html)
        }
        request.log.error({ err: error }, '公开分享页渲染失败')
        return sendHtml(reply, 500, page('无法打开分享', '<h1>无法打开分享</h1><p>请稍后重试。</p>'))
      }
    })

    scope.post('/s/:token/unlock', async (request, reply) => {
      if (!hidesPublicShell(config, request.headers.host)) {
        return reply.code(404).send({ error: { code: 'not_found', message: '未找到' } })
      }
      const token = (request.params as { token: string }).token
      if (!TOKEN_PATTERN.test(token)) {
        const rendered = renderShareError(new AppError(404, 'not_found', '分享链接不存在'))
        return sendHtml(reply, rendered.status, rendered.html)
      }
      const ip = clientIp(request)
      try {
        assertPublicShareOrigin(request, config)
        limit(metadataLimiter, ip)
        limit(unlockGlobalLimiter, 'global')
        limit(unlockLimiter, `${ip}|${sha256Hex(token)}`)
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 429) throw error
        if (error instanceof AppError) {
          const rendered = renderShareError(error)
          return sendHtml(reply, rendered.status, rendered.html)
        }
        throw error
      }
      const raw = typeof request.body === 'string' ? request.body : ''
      const password = new URLSearchParams(raw).get('password') ?? ''
      if (!password) {
        try {
          const info = shares.metadata(token, null)
          return sendHtml(reply, 400, renderShare(token, info, '请输入分享密码'))
        } catch (error) {
          if (error instanceof AppError) {
            const rendered = renderShareError(error)
            return sendHtml(reply, rendered.status, rendered.html)
          }
          throw error
        }
      }
      try {
        const result = await shares.unlock(token, password, ip)
        setShareCookie(reply, request, token, result.sessionToken, SHARE_SESSION_TTL_SECONDS)
        writePageShareCookie(reply, request, token, result.sessionToken)
        return reply.code(303).header('location', `/s/${token}`).send()
      } catch (error) {
        if (error instanceof AppError && error.code === 'invalid_password') {
          try {
            const info = shares.metadata(token, null)
            return sendHtml(reply, 401, renderShare(token, info, '密码错误，请重试'))
          } catch (metadataError) {
            if (metadataError instanceof AppError) {
              const rendered = renderShareError(metadataError)
              return sendHtml(reply, rendered.status, rendered.html)
            }
            throw metadataError
          }
        }
        if (error instanceof AppError) {
          const rendered = renderShareError(error)
          return sendHtml(reply, rendered.status, rendered.html)
        }
        request.log.error({ err: error }, '公开分享解锁失败')
        return sendHtml(reply, 500, page('无法打开分享', '<h1>无法打开分享</h1><p>请稍后重试。</p>'))
      }
    })
  })
}

export function sendClientNotice(reply: FastifyReply): FastifyReply {
  return reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-robots-tag', 'noindex, nofollow')
    .send(NOTICE_HTML)
}
