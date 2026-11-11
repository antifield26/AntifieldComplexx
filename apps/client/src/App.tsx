import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppMetaProvider } from './meta/MetaContext'
import { ToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { AppLoading } from './components/Loading'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { PublicShare } from './pages/PublicShare'
import { usePageTitle } from './hooks/usePageTitle'
import { openNativeAiWorkspaceUrl, resolveNativeAiNext } from './lib/ai-workspace'
import { isNativeRuntime } from './lib/native'
import { assignExternalUrl, externalLoginRedirect, sanitizeNext } from './lib/next-url'

const Files = lazy(() => import('./pages/Files').then(({ Files }) => ({ default: Files })))
const Knowledge = lazy(() => import('./pages/Knowledge').then(({ Knowledge }) => ({ default: Knowledge })))
const Shares = lazy(() => import('./pages/Shares').then(({ Shares }) => ({ default: Shares })))
const Trash = lazy(() => import('./pages/Trash').then(({ Trash }) => ({ default: Trash })))
const Minecraft = lazy(() => import('./pages/Minecraft').then(({ Minecraft }) => ({ default: Minecraft })))
const Activity = lazy(() => import('./pages/Activity').then(({ Activity }) => ({ default: Activity })))
const Settings = lazy(() => import('./pages/Settings').then(({ Settings }) => ({ default: Settings })))
const Chatbots = lazy(() => import('./pages/Chatbots').then(({ Chatbots }) => ({ default: Chatbots })))

/** 受保护路由：会话恢复中显示占位；未登录跳转登录页并带上返回地址。 */
function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <AppLoading />
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Layout />
}

/** 登录路由：已登录时按 next 跳转（外部 AI 工作区经 ai-ticket 换票，其他外部地址整页跳转）。 */
function LoginRoute() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = sanitizeNext(searchParams.get('next'))
  const externalRedirect = externalLoginRedirect(next)

  useEffect(() => {
    if (status !== 'authenticated' || !externalRedirect) return
    if (!isNativeRuntime()) {
      assignExternalUrl(externalRedirect)
      return
    }
    let cancelled = false
    void (async () => {
      const aiNext = await resolveNativeAiNext(next)
      if (cancelled) return
      if (aiNext) await openNativeAiWorkspaceUrl(aiNext).catch(() => undefined)
      if (!cancelled) navigate('/', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [status, externalRedirect, next, navigate])

  if (status === 'loading') return <AppLoading />
  if (status === 'authenticated') {
    if (externalRedirect) return <AppLoading text="正在跳转…" />
    return <Navigate to={next ?? '/'} replace />
  }
  return <Login next={next} />
}

function NotFound() {
  usePageTitle('页面不存在')
  return (
    <div className="not-found-page">
      <h1>页面不存在</h1>
      <p>你访问的地址没有对应的页面，可能已经被移动或输入有误。</p>
      <Link className="btn btn-secondary btn-md" to="/">返回工作台</Link>
    </div>
  )
}

/**
 * 应用根节点：错误边界 → Toast → 登录态 → 站点元数据 → 路由。
 * /s/:token 为公开分享页，位于受保护路由之外，不依赖登录态。
 */
export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AppMetaProvider>
            <Suspense fallback={<AppLoading text="正在加载页面…" />}>
              <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route path="/s/:token" element={<PublicShare />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/files" element={<Files />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/shares" element={<Shares />} />
                  <Route path="/trash" element={<Trash />} />
                  <Route path="/minecraft" element={<Minecraft />} />
                  <Route path="/chatbots" element={<Chatbots />} />
                  <Route path="/bots" element={<Navigate to="/chatbots" replace />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </AppMetaProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
