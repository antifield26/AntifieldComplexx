/**
 * 前台心跳。页面可见时立即打一次，之后按间隔重复。
 * 页面隐藏时停止，隐藏期间不计入在线。
 */

const DEFAULT_INTERVAL_MS = 30_000

export function bindForegroundHeartbeat(beat: () => void, intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const start = (): void => {
    if (timer !== null || document.visibilityState !== 'visible') return
    beat()
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') beat()
    }, intervalMs)
  }

  const onChange = (): void => {
    if (document.visibilityState === 'visible') start()
    else stop()
  }

  document.addEventListener('visibilitychange', onChange)
  start()
  return () => {
    stop()
    document.removeEventListener('visibilitychange', onChange)
  }
}
