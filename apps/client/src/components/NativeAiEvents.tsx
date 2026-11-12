/** 主窗口只接收无载荷的原生续票通知，远端页面无设备命令桥。 */
import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { refreshNativeAiWorkspace } from '../lib/ai-workspace'
import { usesTauriShell } from '../lib/native'
import { useToast } from './Toast'

export function NativeAiEvents() {
  const { status } = useAuth()
  const toast = useToast()
  useEffect(() => {
    if (status !== 'authenticated' || !usesTauriShell()) return
    const refresh = (): void => {
      void refreshNativeAiWorkspace().catch(() => toast.error('工作区登录暂时未完成，请返回首页重新打开'))
    }
    window.addEventListener('af:ai-refresh', refresh)
    return () => window.removeEventListener('af:ai-refresh', refresh)
  }, [status, toast])
  return null
}
