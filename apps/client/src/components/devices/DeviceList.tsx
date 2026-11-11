/**
 * 已登录设备：列表、改名、吊销。
 * 吊销当前设备后只清本地密钥和页面会话，不再请求退出接口。
 */
import { useCallback, useEffect, useState } from 'react'
import { api, toErrorMessage } from '../../api/client'
import type { DeviceView } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { clearNativeDevice } from '../../lib/native'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'

function platformLabel(platform: DeviceView['platform']): string {
  return platform === 'android' ? 'Android' : 'Windows'
}

export function DeviceList() {
  const { clearSession } = useAuth()
  const toast = useToast()
  const [devices, setDevices] = useState<DeviceView[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<DeviceView | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.devices.list()
      setDevices(result.devices)
      setDrafts(Object.fromEntries(result.devices.map((device) => [device.id, device.name])))
    } catch (loadError) {
      setError(toErrorMessage(loadError, '设备列表加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rename = async (device: DeviceView): Promise<void> => {
    const name = (drafts[device.id] ?? '').trim()
    if (!name || name === device.name) return
    setBusyId(device.id)
    try {
      await api.devices.rename(device.id, name)
      toast.success('已更新设备名称')
      await load()
    } catch (renameError) {
      toast.error(toErrorMessage(renameError, '改名失败，请重试'))
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (): Promise<void> => {
    if (!pendingRevoke) return
    const target = pendingRevoke
    setBusyId(target.id)
    try {
      await api.devices.revoke(target.id)
      setPendingRevoke(null)
      if (target.current) {
        await clearNativeDevice()
        clearSession()
        toast.success('已吊销当前设备')
        return
      }
      toast.success('已吊销设备')
      await load()
    } catch (revokeError) {
      toast.error(toErrorMessage(revokeError, '吊销失败，请重试'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card
      title="已登录设备"
      description="只有正在使用的客户端计为在线。"
      className="settings-card"
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      {devices.length === 0 ? <p className="muted">还没有登记设备。</p> : null}
      <ul className="settings-list">
        {devices.map((device) => (
          <li key={device.id} className="settings-list-row">
            <div className="device-row-main">
              <div className="device-row-title">
                <span>{device.name}</span>
                <Badge tone="muted">{platformLabel(device.platform)}</Badge>
                <Badge tone={device.online ? 'success' : 'muted'} dot>
                  {device.online ? '在线' : '离线'}
                </Badge>
                {device.current ? <Badge tone="accent">当前设备</Badge> : null}
              </div>
              <label className="device-rename">
                <span className="sr-only">设备名称</span>
                <input
                  className="input"
                  aria-label={`${device.name} 的名称`}
                  value={drafts[device.id] ?? ''}
                  maxLength={32}
                  disabled={busyId === device.id}
                  onChange={(event) => setDrafts((current) => ({ ...current, [device.id]: event.target.value }))}
                />
              </label>
            </div>
            <div className="device-row-actions">
              <Button
                size="sm"
                disabled={busyId === device.id || (drafts[device.id] ?? '').trim() === device.name}
                onClick={() => void rename(device)}
              >
                保存
              </Button>
              <Button size="sm" variant="danger" disabled={busyId === device.id} onClick={() => setPendingRevoke(device)}>
                吊销
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingRevoke !== null}
        title="吊销设备"
        message={
          pendingRevoke?.current
            ? '吊销后这台设备需要重新登录，本机会退出。'
            : '吊销后这台设备需要重新登录。'
        }
        confirmText="吊销"
        loading={pendingRevoke !== null && busyId === pendingRevoke.id}
        onConfirm={() => void revoke()}
        onClose={() => {
          if (busyId) return
          setPendingRevoke(null)
        }}
      />
    </Card>
  )
}
