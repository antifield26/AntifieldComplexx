/** 自主工具的 Unix socket 入口。公网与普通 mcbot HTTP 监听器无法访问此入口。 */
import { chmodSync } from 'node:fs'
import { createServer } from 'node:http'
import { extractBearer } from '../http/auth.ts'
import type { AutonomyService } from './service.ts'

const MAX_BODY_BYTES = 8192

export async function startDshToolSocket (path: string, autonomy: AutonomyService): Promise<() => Promise<void>> {
  const server = createServer({ headersTimeout: 4000, requestTimeout: 5000 }, async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== '/tool') {
      send(404, { error: 'not_found' })
      return
    }
    const token = extractBearer(req)
    if (!token) {
      send(401, { error: 'unauthorized' })
      return
    }
    const chunks: Buffer[] = []
    let length = 0
    try {
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        length += buffer.length
        if (length > MAX_BODY_BYTES) {
          send(413, { error: 'payload_too_large' })
          return
        }
        chunks.push(buffer)
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const result = await autonomy.handleDshTool(token, body)
      send(result.status, result.body)
    } catch {
      if (!res.headersSent && !res.destroyed) send(400, { error: 'invalid_request' })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      try {
        chmodSync(path, 0o660)
        server.off('error', reject)
        resolve()
      } catch {
        server.close()
        reject(new Error('DSH 工具 socket 权限设置失败'))
      }
    })
  })
  return async () => await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}
