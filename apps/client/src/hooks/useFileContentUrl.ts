/** 原生文件预览使用短期本机资源句柄，关闭后撤销；浏览器保留受 Cookie 保护的相对地址。 */
import { useEffect, useRef, useState } from 'react'
import { createNativePreview, isNativeRuntime, releaseNativePreview } from '../lib/native'

export function useFileContentUrl(path: string | null): { url: string | null; error: string | null; loading: boolean } {
  const native = isNativeRuntime()
  const generation = useRef(0)
  const [preview, setPreview] = useState<{ path: string; url: string | null; error: string | null; generation: number } | null>(null)
  useEffect(() => {
    if (!native || !path) return
    let active = true
    let id: string | null = null
    const current = ++generation.current
    void createNativePreview(path).then((value) => {
      if (!active) { void releaseNativePreview(value.id).catch(() => undefined); return }
      id = value.id
      setPreview({ path, url: value.url, error: null, generation: current })
    }).catch(() => { if (active) setPreview({ path, url: null, error: '无法加载预览，请重试或下载后查看。', generation: current }) })
    return () => { active = false; generation.current += 1; if (id) void releaseNativePreview(id).catch(() => undefined) }
  }, [native, path])
  const current = preview?.path === path && preview.generation === generation.current ? preview : null
  const url = native ? (current?.url ?? null) : path
  const error = current?.error ?? null
  return { url, error, loading: path !== null && url === null && error === null }
}
