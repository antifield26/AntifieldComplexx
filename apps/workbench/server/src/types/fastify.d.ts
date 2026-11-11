/** Fastify 类型增强：@fastify/cookie 的 request.cookies/reply.setCookie 与认证上下文。 */
import '@fastify/cookie'
import type { AuthContext } from '../types.ts'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
    /** Bearer 原文。缺失时走 Cookie。 */
    bearerToken?: string | null
    /** 设备签名覆盖的原始请求体。无请求体时为空缓冲。 */
    deviceRawBody?: Buffer
    /** 本请求已通过设备签名，写操作不再要求 CSRF。 */
    deviceSigned?: boolean
  }
}
