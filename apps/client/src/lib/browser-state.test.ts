/** 验证浏览状态隔离及敏感路由拒绝，不依赖原生密钥库。 */
import { afterEach, describe, expect, it } from 'vitest'
import { activateBrowserState, clearBrowserState, filePreferences, recalledFileSession, rememberedRoute, rememberFilePreferences, rememberFileSession, rememberRoute } from './browser-state'

afterEach(() => { clearBrowserState(); localStorage.clear() })
describe('浏览状态', () => {
  it('账号间隔离，仅保存普通页面和固定显示偏好', () => {
    activateBrowserState('first')
    rememberRoute('/minecraft')
    rememberFilePreferences({ view: 'grid', sort: 'size', dir: 'desc' })
    rememberRoute('/api/auth/ai-ticket?secret=must-not-save')
    expect(rememberedRoute()).toBe('/minecraft')
    activateBrowserState('second')
    expect(rememberedRoute()).toBe('/')
    expect(filePreferences().view).toBe('list')
    activateBrowserState('first')
    expect(rememberedRoute()).toBe('/minecraft')
    expect(filePreferences().view).toBe('grid')
    expect(JSON.stringify(localStorage)).not.toContain('secret')
  })
  it('搜索只在内存保存，退出清除偏好和临时状态', () => {
    activateBrowserState('owner')
    rememberFileSession('root', { search: '私密文件', page: 2 })
    expect(recalledFileSession('root').search).toBe('私密文件')
    expect(JSON.stringify(localStorage)).not.toContain('私密文件')
    clearBrowserState()
    activateBrowserState('owner')
    expect(recalledFileSession('root').search).toBe('')
    expect(rememberedRoute()).toBe('/')
  })
})
