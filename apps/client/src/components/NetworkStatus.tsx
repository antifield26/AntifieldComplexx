/** 连接状态条。保留当前画面，恢复时只触发各页面的只读刷新。 */
import { useEffect, useSyncExternalStore } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { connectionSnapshot, reportConnection, subscribeConnection } from '../lib/connection'

export function NetworkStatus() {
  const state = useSyncExternalStore(subscribeConnection, connectionSnapshot)
  useEffect(() => {
    const online = (): void => {
      reportConnection('online')
      window.dispatchEvent(new Event('af:refresh'))
    }
    const offline = (): void => reportConnection('offline')
    if (!navigator.onLine) offline()
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])
  if (state === 'online') return null
  return (
    <div className="network-banner" role="status">
      <WifiOff size={16} aria-hidden="true" />
      <span>{state === 'offline' ? '网络已断开，当前显示的内容可能不是最新。' : '暂时无法更新，当前内容已保留。'}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.dispatchEvent(new Event('af:refresh'))}>
        <RefreshCw size={14} aria-hidden="true" />重试
      </button>
    </div>
  )
}
