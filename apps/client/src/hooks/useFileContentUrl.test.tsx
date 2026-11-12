/** 原生预览代次和迟到释放回归，所有资源均为进程内夹具。 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useFileContentUrl } from './useFileContentUrl'
import { createNativePreview, releaseNativePreview } from '../lib/native'
vi.mock('../lib/native', () => ({ isNativeRuntime: () => true, createNativePreview: vi.fn(), releaseNativePreview: vi.fn(async () => undefined) }))
afterEach(() => vi.clearAllMocks())
it('A→B→A不复用已释放句柄，迟到响应立即释放', async () => {
  const resolvers: Array<(value: {id:string;url:string}) => void> = []
  vi.mocked(createNativePreview).mockImplementation(() => new Promise(resolve => { resolvers.push(resolve) }))
  const view = renderHook(({path}) => useFileContentUrl(path), {initialProps:{path:'/api/files/a/content'}})
  await act(async () => { resolvers[0]?.({id:'a1',url:'http://127.0.0.1/a1'}) })
  expect(view.result.current.url).toContain('a1')
  view.rerender({path:'/api/files/b/content'})
  expect(releaseNativePreview).toHaveBeenCalledWith('a1')
  view.rerender({path:'/api/files/a/content'})
  expect(view.result.current.url).toBeNull()
  expect(view.result.current.loading).toBe(true)
  await act(async () => { resolvers[1]?.({id:'b1',url:'http://127.0.0.1/b1'}); resolvers[2]?.({id:'a2',url:'http://127.0.0.1/a2'}) })
  expect(releaseNativePreview).toHaveBeenCalledWith('b1')
  expect(view.result.current.url).toContain('a2')
  view.unmount()
  expect(releaseNativePreview).toHaveBeenCalledWith('a2')
})
it('原生失败保持关闭，不回退到无签名内容地址', async () => {
  vi.mocked(createNativePreview).mockRejectedValue(new Error('不可用'))
  const view = renderHook(() => useFileContentUrl('/api/files/a/content'))
  await waitFor(() => expect(view.result.current.error).toBeTruthy())
  expect(view.result.current.url).toBeNull()
})
