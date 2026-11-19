/** DSH Web 的 QQ 设置入口。只读取公开就绪快照，敏感操作在主站完成。 */
import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs'

export const name = 'antifield-qq-plugin'

export function managementUrl(value) {
  try {
    const origin = new URL(value)
    if (origin.protocol === 'https:' && origin.href === `${origin.origin}/`) {
      return new URL('/settings/qq-robot', origin).href
    }
  } catch { /* 未配置时仅显示就绪状态。 */ }
  return null
}

function phase() {
  const fd = openSync('/run/antifield-dsh-qq-status/status.json',
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 4096) return 'unavailable'
    const buffer = Buffer.alloc(4097)
    const size = readSync(fd, buffer)
    if (size > 4096) return 'unavailable'
    const data = JSON.parse(buffer.toString('utf8', 0, size))
    if (data.bindingPhase === 'unbound') return 'unbound'
    if (data.bindingPhase === 'switching' || data.bindingPhase === 'connecting') return 'connecting'
    return data.ready === true ? 'ready' : 'unavailable'
  } finally { closeSync(fd) }
}

export function apply(ctx) {
  ctx.inject(['webServer'], scoped => scoped.effect(() => scoped.webServer.register({
    kind: 'exact',
    path: '/antifield/qq-status',
    handler(request, response) {
      response.setHeader('cache-control', 'no-store')
      if (request.method !== 'GET') { response.writeHead(405).end(); return }
      let state = 'unavailable'
      try { state = phase() } catch { /* 独立服务未启动。 */ }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ phase: state, managementUrl: managementUrl(process.env.DSH_APP_ORIGIN) }))
    },
  })))
}
