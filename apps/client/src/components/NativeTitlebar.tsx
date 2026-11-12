/** Windows 原生窗口标题栏：仅调用当前窗口操作；浏览器与 Android 不加载 Tauri 窗口模块。 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Square, Copy, X } from 'lucide-react'
import type { Window as TauriWindow } from '@tauri-apps/api/window'
import { isNativeRuntime } from '../lib/native'

const TITLES: Record<string, string> = {
  '/': '首页', '/login': '登录', '/files': '文件', '/knowledge': '知识库',
  '/shares': '分享', '/trash': '回收站', '/minecraft': 'Minecraft',
  '/chatbots': '机器人', '/activity': '活动', '/settings': '设置', '/more': '更多',
}

export function NativeTitlebar() {
  const location = useLocation()
  const nativeWindows = isNativeRuntime() && /Windows/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)
  const windowRef = useRef<TauriWindow | null>(null)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = TITLES[location.pathname] ?? (location.pathname.startsWith('/s/') ? '分享文件' : 'AntifieldComplexx')

  useEffect(() => {
    if (!nativeWindows) return
    document.body.classList.add('native-windows')
    let active = true
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (!active) return
      const current = getCurrentWindow()
      windowRef.current = current
      setReady(true)
      const syncMaximized = async (): Promise<void> => {
        try {
          const value = await current.isMaximized()
          if (active) setMaximized(value)
        } catch {
          if (active) setError('无法读取窗口状态')
        }
      }
      await syncMaximized()
      if (!active) return
      const stop = await current.onResized(() => { void syncMaximized() })
      if (active) unlisten = stop
      else stop()
    }).catch(() => {
      if (active) setError('窗口控制暂不可用')
    })
    return () => {
      active = false
      windowRef.current = null
      unlisten?.()
      document.body.classList.remove('native-windows')
    }
  }, [nativeWindows])

  async function act(action: 'minimize' | 'maximize' | 'close' | 'drag'): Promise<void> {
    const current = windowRef.current
    if (!current || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (action === 'maximize') {
        await current.toggleMaximize()
        setMaximized(await current.isMaximized())
      } else if (action === 'drag') await current.startDragging()
      else if (action === 'close') await current.close()
      else await current.minimize()
    } catch {
      setError('窗口操作失败，请重试')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!nativeWindows) return null
  return (
    <header className="native-titlebar" aria-label="应用窗口">
      <div
        className="native-titlebar-drag"
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail < 2) void act('drag')
        }}
        onDoubleClick={() => { void act('maximize') }}
      >
        <span className="native-titlebar-mark" aria-hidden="true">AC</span>
        <span className="native-titlebar-product">AntifieldComplexx</span>
        <span className="native-titlebar-separator" aria-hidden="true">/</span>
        <span className="native-titlebar-page">{title}</span>
        {error ? <span className="native-titlebar-error" role="status">{error}</span> : null}
      </div>
      <div className="native-window-controls">
        <button type="button" onClick={() => { void act('minimize') }} disabled={!ready || busy} aria-label="最小化" title="最小化"><Minus size={15} aria-hidden="true" /></button>
        <button type="button" onClick={() => { void act('maximize') }} disabled={!ready || busy} aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'}>{maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}</button>
        <button type="button" className="native-window-close" onClick={() => { void act('close') }} disabled={!ready || busy} aria-label="关闭窗口" title="关闭窗口"><X size={17} aria-hidden="true" /></button>
      </div>
    </header>
  )
}
