/** 原生下载走系统选择器与可取消的流式传输；浏览器仍使用原来的受认证地址。 */
import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { cancelNativeTransfer, downloadNativeFile, isNativeRuntime } from '../../lib/native'

export interface DownloadButtonProps { path: string; name: string; label?: string }
export function DownloadButton({ path, name, label = '下载' }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const transfer = useRef<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    setBusy(false)
    setMessage('')
    return () => {
      generation.current += 1
      const id = transfer.current
      transfer.current = null
      if (id) void cancelNativeTransfer(id).catch(() => undefined)
    }
  }, [path, name])
  if (!isNativeRuntime()) return (
    <a className="btn btn-secondary btn-md" href={path}><Download size={16} aria-hidden="true" /><span className="btn-label">{label}</span></a>
  )
  const download = async (): Promise<void> => {
    if (transfer.current) return
    const id = crypto.randomUUID()
    const current = generation.current
    transfer.current = id
    setBusy(true)
    setMessage('请选择保存位置…')
    try {
      const result = await downloadNativeFile(path, name, id)
      if (generation.current === current) setMessage(result.status === 'saved' ? '已保存到所选位置' : '下载已取消')
    } catch { if (generation.current === current) setMessage('下载失败，请检查连接后重试') }
    finally { if (generation.current === current && transfer.current === id) { transfer.current = null; setBusy(false) } }
  }
  return <span className="file-download-feedback">
    <button type="button" className="btn btn-secondary btn-md" disabled={busy} onClick={() => void download()}>
      <Download size={16} aria-hidden="true" />{busy ? '正在下载…' : label}
    </button>
    {busy ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
      if (transfer.current) void cancelNativeTransfer(transfer.current).catch(() => undefined)
    }}>取消</button> : null}
    {message ? <span role="status" className="field-hint">{message}</span> : null}
  </span>
}
