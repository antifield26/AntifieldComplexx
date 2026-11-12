/** 启动时无法验证会话只展示重试，保留密钥库中的会话，不把网络故障视为退出。 */
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'
import { Logo } from './Logo'

export function ConnectionRecovery() {
  const { bootstrapError, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  return <main className="app-loading"><Logo size={48} /><h1>暂时无法连接</h1>
    <p role="status">{bootstrapError || '请确认网络连接后重试，已有登录状态已保留。'}</p>
    <Button loading={busy} onClick={() => {
      if (busy) return
      setBusy(true)
      void refresh().catch(() => undefined).finally(() => setBusy(false))
    }}>重新连接</Button>
  </main>
}
