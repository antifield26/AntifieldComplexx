/** 读取合并的取消隔离及会话切换回归；不访问真实服务。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelReadRequests, sharedRead, waitForReadRetry } from './read-requests'

afterEach(() => { cancelReadRequests(); vi.useRealTimers() })
describe('合并读取', () => {
  it('同一读取共享一次上游，单个调用取消不影响另一个', async () => {
    let finish!: (value: number) => void
    let upstream!: AbortSignal
    const run = vi.fn((signal: AbortSignal) => {
      upstream = signal
      return new Promise<number>((resolve) => { finish = resolve })
    })
    const controller = new AbortController()
    const first = sharedRead('same', run, controller.signal)
    const second = sharedRead('same', run)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(upstream.aborted).toBe(false)
    finish(42)
    await expect(second).resolves.toBe(42)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('最后一个调用离开即中断上游，后续读取重新发送', async () => {
    const controller = new AbortController()
    let upstream!: AbortSignal
    const pending = sharedRead('leave', (signal) => { upstream = signal; return new Promise(() => undefined) }, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(upstream.aborted).toBe(true)
    await expect(sharedRead('leave', async () => 2)).resolves.toBe(2)
  })
  it('会话变更立即拒绝读取，忽略不响应取消的迟到上游', async () => {
    let finish!: (value: string) => void
    const pending = sharedRead('session', () => new Promise<string>((resolve) => { finish = resolve }))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    cancelReadRequests()
    await rejected
    finish('旧账号数据')
    await expect(sharedRead('session', async () => '新账号数据')).resolves.toBe('新账号数据')
  })
  it('取消期间不再等退避计时', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = waitForReadRetry(2000, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
