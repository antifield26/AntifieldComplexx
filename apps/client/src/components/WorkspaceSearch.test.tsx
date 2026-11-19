/** 搜索响应竞争、键盘直达、无结果和离线反馈均用内存路由验证。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { WorkspaceSearch } from './WorkspaceSearch'
import { api, type SearchGroups } from '../api/client'

const empty = { files: { items: [], more: false }, notes: { items: [], more: false }, bookmarks: { items: [], more: false } }
function Location() { const location = useLocation(); return <output>{location.pathname + location.search}</output> }
function setup() {
  render(<MemoryRouter><WorkspaceSearch /><Location /></MemoryRouter>)
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  return screen.getByRole('searchbox')
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('迟到响应不覆盖新结果，回车直达笔记', async () => {
  let resolveFirst!: (result: SearchGroups) => void
  const search = vi.spyOn(api, 'search')
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    .mockResolvedValueOnce({ ...empty, notes: { items: [{ id: 'n1', title: '迁移笔记', detail: '树莓派' }], more: false } })
  const input = setup()
  fireEvent.change(input, { target: { value: '旧词' } })
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: '迁移' } })
  await screen.findByText('迁移笔记')
  resolveFirst(empty)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('/knowledge?source=notes&item=n1')).toBeInTheDocument()
})
it('空结果、离线和关闭搜索', async () => {
  vi.spyOn(api, 'search').mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('离线'))
  const input = setup()
  fireEvent.change(input, { target: { value: '无匹配' } })
  await screen.findByText('没有找到相关内容')
  fireEvent.change(input, { target: { value: '离线' } })
  await waitFor(() => expect(screen.getByText(/离线|搜索失败/)).toBeInTheDocument())
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})
