/**
 * 客户端打开 AI 工作区。浏览器仍整页跳转，不经过这里。
 * 次级窗口只加载服务端返回的一次性地址。
 */
import { api } from '../api/client'
import { safeOrigin } from './origin'
import { isNativeRuntime, openNativeAiWorkspace } from './native'
import { isAiWorkspaceUrl } from './next-url'

let opening: Promise<void> | null = null

export function matchesAiOrigin(next: string, aiOrigin: string): boolean {
  const origin = safeOrigin(aiOrigin)
  if (!origin) return false
  try {
    const target = new URL(next)
    if (target.username || target.password) return false
    return target.origin === origin
  } catch {
    return false
  }
}

/** 原生壳的页面源不是 app 主机。能识别时返回要换票的 next，否则返回 null。 */
export async function resolveNativeAiNext(next: string | null): Promise<string | null> {
  if (!isNativeRuntime() || !next) return null
  if (isAiWorkspaceUrl(next)) return next
  try {
    const version = await api.getVersion()
    if (typeof version.aiOrigin === 'string' && matchesAiOrigin(next, version.aiOrigin)) return next
  } catch {
    return null
  }
  return null
}

async function openOnce(next: string): Promise<void> {
  const ticket = await api.auth.aiTicket(next)
  if (!ticket || typeof ticket.url !== 'string' || ticket.url.length === 0) {
    throw new Error('工作区地址不合法')
  }
  await openNativeAiWorkspace(ticket.url)
}

export async function openNativeAiWorkspaceUrl(next: string): Promise<void> {
  if (opening) return opening
  opening = openOnce(next).finally(() => {
    opening = null
  })
  return opening
}
