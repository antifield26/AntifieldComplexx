import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindForegroundHeartbeat, setShellEventsForTests } from './heartbeat'

describe('bindForegroundHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers()
    setShellEventsForTests(null)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('可见时立即心跳，并按间隔重复', () => {
    vi.useFakeTimers()
    const beat = vi.fn()
    const stop = bindForegroundHeartbeat(beat, 30_000)
    expect(beat).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(beat).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(30_000)
    expect(beat).toHaveBeenCalledTimes(2)
  })

  it('隐藏时不心跳，重新可见后恢复', () => {
    vi.useFakeTimers()
    let state: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    const beat = vi.fn()
    bindForegroundHeartbeat(beat, 30_000)
    expect(beat).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(beat).not.toHaveBeenCalled()
    state = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(beat).toHaveBeenCalledTimes(1)
  })

  it('壳暂停时停止，恢复且页面可见后继续', () => {
    vi.useFakeTimers()
    let onSuspend = (): void => undefined
    let onResume = (): void => undefined
    setShellEventsForTests((suspend, resume) => {
      onSuspend = suspend
      onResume = resume
      return () => undefined
    })
    const beat = vi.fn()
    const stop = bindForegroundHeartbeat(beat, 30_000)
    expect(beat).toHaveBeenCalledTimes(1)
    onSuspend()
    vi.advanceTimersByTime(60_000)
    expect(beat).toHaveBeenCalledTimes(1)
    onResume()
    expect(beat).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(30_000)
    expect(beat).toHaveBeenCalledTimes(2)
  })
})
