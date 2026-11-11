/**
 * 原生壳桥接。浏览器与测试不加载 Tauri。
 * 私钥和会话令牌只留在操作系统密钥库，不写入 web 存储，也不放进页面状态。
 */

export interface PreparedDevice {
  publicKey: string
  platform: 'windows' | 'android'
  suggestedName: string
}

export interface SignedHeaders {
  authorization: string
  deviceId: string
  timestamp: string
  nonce: string
  signature: string
}

export interface NativeBridge {
  isNative: boolean
  prepareDevice(): Promise<PreparedDevice>
  storeSession(sessionToken: string, deviceId: string): Promise<void>
  clearSession(): Promise<void>
  clearDevice(): Promise<void>
  signRequest(method: string, path: string, body: string, bodySha256?: string): Promise<SignedHeaders | null>
  hasSession(): Promise<boolean>
  openAiWorkspace(url: string): Promise<void>
}

let testBridge: NativeBridge | null = null
let tauriBridge: NativeBridge | null = null

/** 测试注入桥接。传 null 恢复浏览器路径。 */
export function setNativeBridgeForTests(bridge: NativeBridge | null): void {
  testBridge = bridge
}

function tauriWindow(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ != null
}

export function isNativeRuntime(): boolean {
  if (testBridge) return testBridge.isNative
  return tauriWindow()
}

/** 真实 Tauri 壳。测试桥接不算，避免测试去加载 Tauri 事件模块。 */
export function usesTauriShell(): boolean {
  return tauriWindow()
}

async function loadTauriBridge(): Promise<NativeBridge> {
  if (tauriBridge) return tauriBridge
  const { invoke } = await import('@tauri-apps/api/core')
  tauriBridge = {
    isNative: true,
    prepareDevice: () => invoke<PreparedDevice>('prepare_device'),
    storeSession: (sessionToken, deviceId) =>
      invoke<void>('store_session', { sessionToken, deviceId }),
    clearSession: () => invoke<void>('clear_session'),
    clearDevice: () => invoke<void>('clear_device'),
    signRequest: (method, path, body, bodySha256) =>
      invoke<SignedHeaders | null>('sign_request', {
        method,
        path,
        body,
        ...(bodySha256 ? { bodySha256 } : {}),
      }),
    hasSession: () => invoke<boolean>('has_session'),
    openAiWorkspace: (url) => invoke<void>('open_ai_workspace', { url }),
  }
  return tauriBridge
}

async function bridge(): Promise<NativeBridge> {
  if (testBridge) return testBridge
  if (!tauriWindow()) throw new Error('当前不是客户端')
  return loadTauriBridge()
}

export async function prepareNativeDevice(): Promise<PreparedDevice> {
  return (await bridge()).prepareDevice()
}

export async function storeNativeSession(sessionToken: string, deviceId: string): Promise<void> {
  await (await bridge()).storeSession(sessionToken, deviceId)
}

export async function clearNativeSession(): Promise<void> {
  if (!isNativeRuntime()) return
  await (await bridge()).clearSession()
}

export async function clearNativeDevice(): Promise<void> {
  if (!isNativeRuntime()) return
  await (await bridge()).clearDevice()
}

export async function signNativeRequest(
  method: string,
  path: string,
  body: string,
  bodySha256?: string,
): Promise<SignedHeaders | null> {
  if (!isNativeRuntime()) return null
  return (await bridge()).signRequest(method, path, body, bodySha256)
}

export async function openNativeAiWorkspace(url: string): Promise<void> {
  if (!isNativeRuntime()) throw new Error('当前不是客户端')
  await (await bridge()).openAiWorkspace(url)
}

export async function hasNativeSession(): Promise<boolean> {
  if (!isNativeRuntime()) return false
  return (await bridge()).hasSession()
}
