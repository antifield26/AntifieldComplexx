/** 展示最近一次磁盘采样和可回收预览，读取失败保留已显示的数据。 */
import { useState } from 'react'
import { api, toErrorMessage } from '../api/client'
import { formatBytes, formatDateTime } from '../lib/format'

export interface InventoryRow { label: string; bytes: number; delta?: number | null; complete: boolean; reclaimable: number; reason: string }
interface Snapshot { at: string; rows: InventoryRow[]; complete: boolean; total?: number; used?: number }
export interface InventoryResult { snapshot: Snapshot | null; lastComplete: Snapshot | null }

export function StorageInventory() {
  const [data, setData] = useState<InventoryResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function read() {
    setBusy(true)
    try { setData(await api.storageInventory()); setError('') }
    catch (e) { setError(toErrorMessage(e, '读取盘点结果失败')) }
    finally { setBusy(false) }
  }
  const current = data?.snapshot
  return <details id="storage-inventory" className="card" onToggle={e => { if (e.currentTarget.open) void read() }}>
    <summary>主机磁盘占用与清理预览</summary>
    {busy && <p>正在读取快照…</p>}{error && <p role="alert">{error}</p>}
    {current ? <>
      <p>{formatDateTime(current.at)} · {current.complete ? '完整采样' : '部分目录未能盘点'}
        {Date.now() - Date.parse(current.at) > 48 * 3600000 && ' · 快照已过期'}</p>
      {typeof current.total === 'number' && typeof current.used === 'number' && <p>主机已用 {formatBytes(current.used)} / {formatBytes(current.total)}</p>}
      {!current.complete && data?.lastComplete && <p>上次完整采样 {formatDateTime(data.lastComplete.at)} · 已用 {formatBytes(data.lastComplete.used ?? 0)}</p>}
      {current.rows.map(row => <div className="inventory-row" key={row.label}><strong>{row.label}</strong> {formatBytes(row.bytes)}
        {row.delta != null && <span> · 较上次 {row.delta < 0 ? '−' : '+'}{formatBytes(Math.abs(row.delta))}</span>}
        <p>{row.complete ? '' : '数据不完整 · '}预计可回收 {formatBytes(row.reclaimable)} · {row.reason}</p></div>)}
    </> : !error && !busy && <p>尚无磁盘采样记录</p>}
  </details>
}
