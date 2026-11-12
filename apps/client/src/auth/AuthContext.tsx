// 登录态上下文。
// 浏览器启动时用 Cookie 调 /api/auth/me。客户端没有本地会话时不请求。
// 客户端登录会登记设备，并把会话令牌写入密钥库后再进入已登录状态。
// 前台每 30 秒心跳。退出只清会话令牌，保留设备密钥。吊销当前设备时连密钥一起清。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, isApiError, sessionFailureKind, setCsrfToken, setUnauthorizedHandler, toErrorMessage } from '../api/client'
import type { DeviceEnrollment, LoginResult, PasswordChallenge, SessionInfo, User } from '../api/types'
import { APP_VERSION } from '../lib/app-version'
import { bindForegroundHeartbeat } from '../lib/heartbeat'
import { activateBrowserState, clearBrowserState } from '../lib/browser-state'
import { cancelReadRequests } from '../lib/read-requests'
import { clearAiWorkspaceNavigation } from '../lib/ai-workspace'
import {
  clearNativeDevice,
  clearNativeSession,
  hasNativeSession,
  isNativeRuntime,
  prepareNativeDevice,
  storeNativeSession,
} from '../lib/native'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unavailable'

export interface AuthContextValue {
  status: AuthStatus
  user: User | null
  session: SessionInfo | null
  /** 启动时无法连接服务器等非 401 错误 */
  bootstrapError: string | null
  requestPassword: (username: string, password: string) => Promise<PasswordChallenge>
  completeTotp: (challenge: string, code: string) => Promise<LoginResult>
  completeRecovery: (challenge: string, recoveryCode: string) => Promise<LoginResult>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  clearSession: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return context
}

async function enrollmentBody(): Promise<DeviceEnrollment | undefined> {
  if (!isNativeRuntime()) return undefined
  const prepared = await prepareNativeDevice()
  return {
    name: prepared.suggestedName,
    platform: prepared.platform,
    publicKey: prepared.publicKey,
    appVersion: APP_VERSION,
  }
}

async function acceptNativeSession(result: LoginResult): Promise<void> {
  if (!isNativeRuntime()) return
  if (!result.sessionToken || !result.device?.id) {
    throw new ApiError(0, 'invalid_response', '客户端登录未返回设备会话')
  }
  await storeNativeSession(result.sessionToken, result.device.id)
}

/** 登录成功后立刻以 me 结果刷新会话详情（失败也不阻断登录）。 */
async function fetchCurrentSession(
  setUser: (user: User | null) => void,
  setSession: (session: SessionInfo | null) => void,
): Promise<void> {
  try {
    const me = await api.auth.me()
    setCsrfToken(me.csrfToken)
    setUser(me.user)
    setSession(me.session)
  } catch {
    setSession(null)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const clearSession = useCallback(() => {
    clearBrowserState()
    clearAiWorkspaceNavigation()
    setCsrfToken(null)
    setUser(null)
    setSession(null)
    setStatus('anonymous')
  }, [])

  const handleSessionFailure = useCallback(async (error: unknown): Promise<boolean> => {
    if (!(error instanceof ApiError)) return false
    const kind = sessionFailureKind(error.status, error.code)
    if (!kind) return false
    try {
      if (kind === 'device') await clearNativeDevice()
      else await clearNativeSession()
    } catch { /* 服务端已拒绝凭据，页面仍退出，后续登录明确报告密钥库错误。 */ }
    clearSession()
    setBootstrapError(error.message)
    return true
  }, [clearSession])

  // 恢复会话：只在挂载时执行一次
  useEffect(() => {
    mountedRef.current = true
    const restore = async (): Promise<void> => {
      try {
        if (isNativeRuntime()) {
          const hasSession = await hasNativeSession()
          if (!mountedRef.current) return
          if (!hasSession) {
            setStatus('anonymous')
            setBootstrapError(null)
            return
          }
        }
        const me = await api.auth.me()
        if (!mountedRef.current) return
        activateBrowserState(me.user.username)
        setCsrfToken(me.csrfToken)
        setUser(me.user)
        setSession(me.session)
        setStatus('authenticated')
        setBootstrapError(null)
      } catch (error) {
        if (!mountedRef.current) return
        if (!(await handleSessionFailure(error))) {
          setStatus('unavailable')
          setBootstrapError(toErrorMessage(error, '无法连接服务器，请确认服务已启动'))
        }
      }
    }
    void restore()
    return () => {
      mountedRef.current = false
    }
  }, [handleSessionFailure])

  // 任意业务接口返回会话失效时，清空本地登录态
  useEffect(() => {
    setUnauthorizedHandler((kind) => {
      const clear = kind === 'device' ? clearNativeDevice() : clearNativeSession()
      void clear.catch(() => undefined).finally(() => {
        if (mountedRef.current) clearSession()
      })
    })
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  useEffect(() => {
    if (status !== 'authenticated' || !isNativeRuntime()) return
    return bindForegroundHeartbeat(() => {
      void api.devices.heartbeat().catch(() => undefined)
    })
  }, [status])

  const requestPassword = useCallback(async (username: string, password: string): Promise<PasswordChallenge> => {
    return api.auth.password(username, password)
  }, [])

  const finishLogin = useCallback(
    async (run: () => Promise<LoginResult>): Promise<LoginResult> => {
      try {
        const result = await run()
        cancelReadRequests()
        await acceptNativeSession(result)
        activateBrowserState(result.user.username)
        setCsrfToken(result.csrfToken)
        setUser(result.user)
        setStatus('authenticated')
        await fetchCurrentSession(setUser, setSession)
        return result
      } catch (error) {
        if (isNativeRuntime() && isApiError(error, 'device_revoked')) {
          try {
            await clearNativeDevice()
          } catch {
            // 登录失败仍交给页面；密钥清不掉时下次登记会再次被拒绝。
          }
        }
        throw error
      }
    },
    [],
  )

  const completeTotp = useCallback(
    async (challenge: string, code: string): Promise<LoginResult> => {
      const device = await enrollmentBody()
      return finishLogin(() => api.auth.totp(challenge, code, device))
    },
    [finishLogin],
  )

  const completeRecovery = useCallback(
    async (challenge: string, recoveryCode: string): Promise<LoginResult> => {
      const device = await enrollmentBody()
      return finishLogin(() => api.auth.recovery(challenge, recoveryCode, device))
    },
    [finishLogin],
  )

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.auth.logout()
    } catch {
      // 即使会话已失效或网络中断，本地也按退出处理
    } finally {
      try {
        await clearNativeSession()
      } catch {
        // 密钥库不可用时仍清页面登录态。设备密钥保留。
      }
      clearSession()
    }
  }, [clearSession])

  const logoutAll = useCallback(async (): Promise<void> => {
    await api.account.logoutAll()
    try {
      await clearNativeSession()
    } catch {
      // 页面仍退出。设备密钥保留，下次登录复用。
    }
    clearSession()
  }, [clearSession])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const me = await api.auth.me()
      activateBrowserState(me.user.username)
      setCsrfToken(me.csrfToken)
      setUser(me.user)
      setSession(me.session)
      setStatus('authenticated')
      setBootstrapError(null)
    } catch (error) {
      if (!(await handleSessionFailure(error))) setBootstrapError(toErrorMessage(error, '暂时无法连接服务器'))
      throw error
    }
  }, [handleSessionFailure])

  useEffect(() => {
    if (status !== 'unavailable') return
    const retry = (): void => { void refresh().catch((error: unknown) => setBootstrapError(toErrorMessage(error, '暂时无法连接服务器'))) }
    window.addEventListener('af:refresh', retry)
    return () => window.removeEventListener('af:refresh', retry)
  }, [status, refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      bootstrapError,
      requestPassword,
      completeTotp,
      completeRecovery,
      logout,
      logoutAll,
      clearSession,
      refresh,
    }),
    [
      status,
      user,
      session,
      bootstrapError,
      requestPassword,
      completeTotp,
      completeRecovery,
      logout,
      logoutAll,
      clearSession,
      refresh,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
