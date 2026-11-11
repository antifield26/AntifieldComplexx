/**
 * 前台心跳。页面可见且壳未暂停时立即打一次，之后按间隔重复。
 * 页面隐藏或壳进入后台时停止，这段时间不计入在线。
 */
import { usesTauriShell } from './native'

const DEFAULT_INTERVAL_MS = 30_000

type ShellUnlisten = () => void

let testShell: ((onSuspend: () => void, onResume: () => void) => ShellUnlisten) | null = null

/** 测试注入壳的暂停与恢复。生产只在真实 Tauri 窗口上监听。 */
export function setShellEventsForTests(
  listener: ((onSuspend: () => void, onResume: () => void) => ShellUnlisten) | null,
): void {
  testShell = listener
}

function attachShell(onSuspend: () => void, onResume: () => void): ShellUnlisten {
  if (testShell) return testShell(onSuspend, onResume)
  if (!usesTauriShell()) return () => undefined
  let cancelled = false
  const unlistens: ShellUnlisten[] = []
  void import('@tauri-apps/api/event').then(async ({ listen }) => {
    if (cancelled) return
    const suspended = await listen('tauri://suspended', () => {
      onSuspend()
    })
    const resumed = await listen('tauri://resumed', () => {
      onResume()
    })
    if (cancelled) {
      suspended()
      resumed()
      return
    }
    unlistens.push(suspended, resumed)
  })
  return () => {
    cancelled = true
    for (const unlisten of unlistens) unlisten()
    unlistens.length = 0
  }
}

export function bindForegroundHeartbeat(beat: () => void, intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  let suspended = false

  const stop = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const foreground = (): boolean => !suspended && document.visibilityState === 'visible'

  const start = (): void => {
    if (timer !== null || !foreground()) return
    beat()
    timer = setInterval(() => {
      if (foreground()) beat()
    }, intervalMs)
  }

  const onChange = (): void => {
    if (foreground()) start()
    else stop()
  }

  const detachShell = attachShell(
    () => {
      suspended = true
      stop()
    },
    () => {
      suspended = false
      start()
    },
  )

  document.addEventListener('visibilitychange', onChange)
  start()
  return () => {
    stop()
    document.removeEventListener('visibilitychange', onChange)
    detachShell()
  }
}
