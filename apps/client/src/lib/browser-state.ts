/** 浏览偏好按服务来源和账号隔离。持久化内容限于普通路由、视图与排序，搜索及滚动只存内存。 */
import { readApiOrigin } from './api-origin'

const ROUTES = new Set(['/', '/files', '/knowledge', '/shares', '/trash', '/minecraft', '/chatbots', '/activity', '/settings', '/more'])
interface Preferences { route: string; view: 'list' | 'grid'; sort: 'name' | 'size' | 'updated'; dir: 'asc' | 'desc' }
export interface FileSession { search: string; page: number }
let ownerKey: string | null = null
let preferences: Preferences = defaults()
const scroll = new Map<string, number>()
const files = new Map<string, FileSession>()
function defaults(): Preferences { return { route: '/', view: 'list', sort: 'name', dir: 'asc' } }

export function activateBrowserState(username: string): void {
  const origin = readApiOrigin() || window.location.origin
  const key = `af-browser-v1:${encodeURIComponent(origin)}:${encodeURIComponent(username)}`
  if (ownerKey === key) return
  ownerKey = key
  preferences = defaults()
  scroll.clear()
  files.clear()
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!raw || typeof raw !== 'object') return
    const value = raw as Partial<Preferences>
    if (typeof value.route === 'string' && ROUTES.has(value.route)) preferences.route = value.route
    if (value.view === 'grid') preferences.view = 'grid'
    if (value.sort === 'size' || value.sort === 'updated') preferences.sort = value.sort
    if (value.dir === 'desc') preferences.dir = 'desc'
  } catch { /* 偏好不可用时使用默认值。 */ }
}

function persist(): void {
  if (!ownerKey) return
  try { localStorage.setItem(ownerKey, JSON.stringify(preferences)) } catch { /* 不阻断操作。 */ }
}

export function clearBrowserState(): void {
  if (ownerKey) { try { localStorage.removeItem(ownerKey) } catch { /* 仍清内存。 */ } }
  ownerKey = null
  preferences = defaults()
  scroll.clear()
  files.clear()
}
export function rememberedRoute(): string { return preferences.route }
export function rememberRoute(route: string): void {
  if (!ROUTES.has(route)) return
  preferences.route = route
  persist()
}
export function filePreferences(): Readonly<Preferences> { return { ...preferences } }
export function rememberFilePreferences(value: Pick<Preferences, 'view' | 'sort' | 'dir'>): void {
  preferences = { ...preferences, ...value }
  persist()
}
export function rememberScroll(path: string, top: number): void { scroll.set(path, Math.max(0, top)) }
export function recalledScroll(path: string): number { return scroll.get(path) ?? 0 }
export function rememberFileSession(path: string, value: FileSession): void { files.set(path, value) }
export function recalledFileSession(path: string): FileSession { return files.get(path) ?? { search: '', page: 1 } }
