/** 全局连接提示只保存可达性，不保存请求地址、凭据或业务正文。 */
export type ConnectionState = 'online' | 'offline' | 'unavailable'
let state: ConnectionState = 'online'
const listeners = new Set<() => void>()

export function reportConnection(next: ConnectionState): void {
  if (state === next) return
  state = next
  for (const listener of listeners) listener()
}

export function connectionSnapshot(): ConnectionState { return state }
export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
