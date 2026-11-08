/** DSH Web 本地换票。仅接受专用 Unix socket 发来的会话 Cookie，绝不转发 Workbench 凭据。 */
import { request } from 'node:http'

const COOKIE = /^dsh-auth-[A-Za-z0-9_-]{1,128}=[A-Za-z0-9_.~-]{1,4096}$/

export function dshCookieFromHeader(header: string | undefined): string | null {
  const cookies = header?.split(';').map((part) => part.trim()).filter((part) => COOKIE.test(part)) ?? []
  return cookies.length === 1 ? cookies[0]! : null
}

export function requestDshCookie(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const unavailable = (): void => reject(new Error('DSH Web 换票不可用'))
    const req = request({
      socketPath,
      path: '/session',
      method: 'POST',
      signal: AbortSignal.timeout(4000),
      maxHeaderSize: 8192,
    }, (res) => {
      res.resume()
      const cookies = res.headers['set-cookie']
      const rawCookie = cookies?.length === 1 ? cookies[0]!.split(';', 1)[0] : undefined
      if (res.statusCode === 204 && rawCookie && COOKIE.test(rawCookie)) resolve(rawCookie)
      else unavailable()
    })
    req.once('error', unavailable)
    req.end()
  })
}
