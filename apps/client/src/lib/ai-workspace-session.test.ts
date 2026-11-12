/** 续票只允许一次，退出后的迟到票据不得打开远端容器。 */
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { openNativeAiWorkspace } from './native'
import { clearAiWorkspaceNavigation, openNativeAiWorkspaceUrl, refreshNativeAiWorkspace } from './ai-workspace'
vi.mock('../api/client', () => ({api:{auth:{aiTicket:vi.fn()}}}))
vi.mock('./native', () => ({isNativeRuntime:()=>true,openNativeAiWorkspace:vi.fn(async()=>undefined)}))
afterEach(() => { clearAiWorkspaceNavigation(); vi.clearAllMocks() })
it('一次主动打开最多一次Access续票', async () => {
  vi.mocked(api.auth.aiTicket).mockResolvedValue({url:'https://ai.example.com/__af/sso/fixture'})
  await openNativeAiWorkspaceUrl('https://ai.example.com/')
  await refreshNativeAiWorkspace()
  await refreshNativeAiWorkspace()
  expect(api.auth.aiTicket).toHaveBeenCalledTimes(2)
  expect(openNativeAiWorkspace).toHaveBeenCalledTimes(2)
})
it('登出使等待中的票据失效', async () => {
  let finish!: (value:{url:string})=>void
  vi.mocked(api.auth.aiTicket).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=openNativeAiWorkspaceUrl('https://ai.example.com/')
  const rejected=expect(pending).rejects.toThrow('登录状态已变化')
  clearAiWorkspaceNavigation()
  finish({url:'https://ai.example.com/__af/sso/fixture'})
  await rejected
  expect(openNativeAiWorkspace).not.toHaveBeenCalled()
})
