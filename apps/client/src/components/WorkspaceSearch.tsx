/** 搜索窗口只在当前会话保留查询，结果经已有资源入口打开。 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api, toErrorMessage, type SearchGroups, type SearchKind } from '../api/client'
import { handoffSearch } from '../lib/search-handoff'
import { Modal } from './Modal'

const names = { files: '文件', notes: '笔记', bookmarks: '书签' }
const kinds = Object.keys(names) as SearchKind[]

export function WorkspaceSearch({ home = false }: { home?: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchGroups | null>(null)
  const [error, setError] = useState('')
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => {
    setResult(null)
    setError('')
    if (!open || !query.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.search(query.trim(), controller.signal)
        if (!controller.signal.aborted) setResult(data)
      } catch (failure) {
        if (!controller.signal.aborted) setError(toErrorMessage(failure, '搜索失败，请检查连接后重试'))
      }
    }, 220)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, open])
  const close = () => { setOpen(false); setQuery(''); setResult(null) }
  function select(kind: SearchKind, id?: string) {
    const path = kind === 'files' ? '/files' : '/knowledge'
    // 筛选词通过一次性内存交接；浏览器历史只记录资源标识。
    const token = handoffSearch(id ? '' : query)
    navigate(path + '?source=' + kind + (id ? '&item=' + encodeURIComponent(id) : ''), { state: { searchToken: token } })
    close()
  }
  return <>
    {home ? <label className="workspace-search-trigger home-search"><Search size={20} aria-hidden="true" />
      <input aria-label="搜索个人工作台" type="search" placeholder="搜索文件、笔记和书签" maxLength={160} value={query}
        onClick={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true) }} />
      <kbd>Ctrl K</kbd></label> : <button type="button" className={'workspace-search-trigger' + (home ? ' home-search' : '')} onClick={() => setOpen(true)}>
      <Search size={19} aria-hidden="true" /><span>{home ? '搜索文件、笔记和书签' : '搜索工作台'}</span><kbd>Ctrl K</kbd>
    </button>}
    <Modal open={open} title="搜索工作台" onClose={close} initialFocus="input" className="workspace-search-modal">
      <div ref={body} onKeyDown={e => {
        const buttons = Array.from(body.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        if (!buttons.length || e.nativeEvent.isComposing) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          buttons[index < 0 && e.key === 'ArrowUp' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        } else if (e.key === 'Enter' && index < 0) buttons[0]?.click()
      }}>
        <input type="search" aria-label="搜索文件、笔记和书签" maxLength={160} placeholder="输入文件名、笔记内容或书签…" value={query} onChange={e => { setResult(null); setQuery(e.target.value) }} />
        <div aria-live="polite">{error || (query.trim() && !result ? '正在搜索…' : '')}</div>
        {result && kinds.every(kind => !result[kind].items.length) && <p>没有找到相关内容</p>}
        {result && kinds.filter(kind => result[kind].items.length).map(kind => <section key={kind}><h3>{names[kind]}</h3>
          {result[kind].items.map(item => <button key={item.id} onClick={() => select(kind, item.id)}><strong>{item.title}</strong><small>{item.detail}</small></button>)}
          {result[kind].more && <button onClick={() => select(kind)}>更多{names[kind]}</button>}
        </section>)}
      </div>
    </Modal>
  </>
}
