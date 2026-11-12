/**
 * 客户端打开 AI 工作区。浏览器仍整页跳转，不经过这里。
 * 次级窗口只加载服务端返回的一次性地址。
 */
import { api } from '../api/client'
import { safeOrigin } from './origin'
import { isNativeRuntime, openNativeAiWorkspace } from './native'
import { isAiWorkspaceUrl } from './next-url'

let opening: Promise<void> | null = null
let lastNext: string | null = null
let refreshed = false
let generation = 0

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

async function openOnce(next: string, currentGeneration = generation): Promise<void> {
  const ticket = await api.auth.aiTicket(next)
  if (currentGeneration !== generation) throw new Error('登录状态已变化，请重新打开工作区')
  if (!ticket || typeof ticket.url !== 'string' || ticket.url.length === 0) {
    throw new Error('工作区地址不合法')
  }
  await openNativeAiWorkspace(ticket.url)
}

export async function openNativeAiWorkspaceUrl(next: string): Promise<void> {
  if (opening) return opening
  lastNext = next
  refreshed = false
  const current = openOnce(next).finally(() => { if (opening === current) opening = null })
  opening = current
  return current
}

/** 首次 Access 登录可能超过旧票有效期；只在受限原生容器通知后补发一次新票。 */
export async function refreshNativeAiWorkspace(): Promise<void> {
  if (!lastNext || refreshed || opening) return
  refreshed = true
  const current = openOnce(lastNext).finally(() => { if (opening === current) opening = null })
  opening = current
  return current
}

export function clearAiWorkspaceNavigation(): void {
  generation += 1
  opening = null
  lastNext = null
  refreshed = false
}
