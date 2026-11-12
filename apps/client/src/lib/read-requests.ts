/**
 * 幂等 JSON 读取的合并、有限退避与取消。每个订阅者独立取消，最后一个离开才撤销上游。
 * 票据签发等有副作用的 GET 不进入此调度器；会话变更时撤销全部在途读取。
 */
interface Entry {
  controller: AbortController
  promise: Promise<unknown>
  readers: number
}

const pending = new Map<string, Entry>()

export function cancelReadRequests(): void {
  for (const entry of pending.values()) entry.controller.abort()
  pending.clear()
}

export function waitForReadRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('读取已取消', 'AbortError')); return }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('读取已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function sharedRead<T>(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('读取已取消', 'AbortError'))
  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, promise: Promise.resolve().then(() => run(controller.signal)), readers: 0 }
    const current = entry
    pending.set(key, current)
    void current.promise.finally(() => {
      if (pending.get(key) === current) pending.delete(key)
    }).catch(() => undefined)
  }
  const current = entry
  current.readers += 1
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const release = (): boolean => {
      if (settled) return false
      settled = true
      signal?.removeEventListener('abort', onAbort)
      current.controller.signal.removeEventListener('abort', onAbort)
      current.readers -= 1
      if (current.readers === 0) {
        current.controller.abort()
        if (pending.get(key) === current) pending.delete(key)
      }
      return true
    }
    const onAbort = (): void => {
      if (release()) reject(new DOMException('读取已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    current.controller.signal.addEventListener('abort', onAbort, { once: true })
    current.promise.then(
      (value) => { if (release()) resolve(value as T) },
      (error: unknown) => { if (release()) reject(error) },
    )
  })
}
