/** 未保存内容及返回处理注册表。只记录控制状态，不缓存正文或提交参数。 */
import { useEffect } from 'react'

const dirtyEditors = new Set<symbol>()
const backHandlers: Array<() => boolean> = []
export function hasUnsavedChanges(): boolean { return dirtyEditors.size > 0 }
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const id = Symbol('editor')
    dirtyEditors.add(id)
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { dirtyEditors.delete(id); window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty])
}
export function registerBackHandler(handler: () => boolean): () => void {
  backHandlers.push(handler)
  return () => { const index = backHandlers.lastIndexOf(handler); if (index >= 0) backHandlers.splice(index, 1) }
}
export function handleOverlayBack(): boolean {
  for (let index = backHandlers.length - 1; index >= 0; index -= 1) if (backHandlers[index]?.()) return true
  return false
}
