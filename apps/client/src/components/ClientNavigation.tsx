/** 原生返回与账号浏览状态。远端容器自行处理返回，不进入主窗口命令范围。 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { recalledScroll, rememberRoute, rememberScroll } from '../lib/browser-state'
import { handleOverlayBack } from '../lib/navigation-guard'
import { usesTauriShell } from '../lib/native'

export function ClientNavigation() {
  const { status } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const routeRef = useRef(location)
  routeRef.current = location
  useEffect(() => {
    if (status !== 'authenticated') return
    const path = `${location.pathname}${location.search}`
    rememberRoute(location.pathname)
    let touched = false
    const onScroll = (): void => { touched = true; rememberScroll(path, window.scrollY) }
    const onPage = (): void => { if (!touched) window.scrollTo({ top: recalledScroll(path), behavior: 'auto' }) }
    const timer = window.setTimeout(onPage, 100)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', onScroll) }
  }, [location.pathname, location.search, status])
  useEffect(() => {
    if (!usesTauriShell()) return
    const onBack = (): void => {
        if (handleOverlayBack()) return
        const current = routeRef.current
        if (current.pathname === '/') {
          void import('@tauri-apps/api/core').then(({ invoke }) => invoke('background_app')).catch(() => undefined)
        } else if (current.pathname === '/files' && current.search) navigate('/files')
        else navigate('/')
    }
    window.addEventListener('af:native-back', onBack)
    return () => window.removeEventListener('af:native-back', onBack)
  }, [navigate])
  return null
}
