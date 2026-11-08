/** 企业微信群机器人的固定出站协议。链接包含密钥，响应正文不进入日志。 */
const ORIGIN = 'https://qyapi.weixin.qq.com'
const PATH = '/cgi-bin/webhook/send'
const MAX_TEXT_BYTES = 2048
const MAX_REPLY_BYTES = 16 * 1024

export function validateWecomWebhookUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.origin === ORIGIN && url.pathname === PATH && !url.username && !url.password && !url.hash
      && [...url.searchParams].length === 1 && /^[A-Za-z0-9_-]{8,128}$/u.test(url.searchParams.get('key') ?? '')) return
  } catch {
    // 错误由固定提示报告，避免把 URL 中的密钥写入日志。
  }
  throw new Error('ALERT_WEBHOOK_URL 必须是企业微信群机器人的 HTTPS Webhook 地址')
}

function clean(value: string): string {
  return value.replace(/https?:\/\/\S+/giu, '[链接]').replace(/\bBearer\s+\S+/giu, '[凭据]').trim()
}

export function wecomPayload(event: { title: string; message: string; status: string; severity: string; created_at: string }): string {
  const message = `【AntifieldComplexx】${clean(event.title)}\n${clean(event.message)}\n${event.status} · ${event.severity} · ${event.created_at}`
  let bytes = 0
  let content = ''
  for (const character of message) {
    bytes += Buffer.byteLength(character)
    if (bytes > MAX_TEXT_BYTES) break
    content += character
  }
  return JSON.stringify({ msgtype: 'text', text: { content } })
}

export async function verifyWecomReply(response: Response): Promise<void> {
  if (!response.body) throw new Error('企业微信响应无效')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_REPLY_BYTES) throw new Error('企业微信响应超限')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  let reply: { errcode?: unknown }
  try {
    reply = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { errcode?: unknown }
  } catch {
    throw new Error('企业微信响应无效')
  }
  if (reply?.errcode === 0) return
  const code = Number.isSafeInteger(reply?.errcode) ? `（${String(reply.errcode)}）` : ''
  throw new Error(`企业微信拒绝投递${code}`)
}
