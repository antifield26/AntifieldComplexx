/** 在线模式。世界动作改由管理员对话决定，本卡只切换 auto/always/off。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isAbortError, isApiError, toErrorMessage } from '../../api/client'
import type { McbotPresenceInfo, McbotPresenceMode } from '../../api/types'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { InlineError } from '../InlineError'
import { RelativeTime } from '../RelativeTime'
import { useToast } from '../Toast'
import { usePolling } from '../../hooks/usePolling'

const PRESENCE_LABELS: Record<McbotPresenceMode, string> = {
  auto: '自动在线',
  always: '常驻在线',
  off: '不主动上线',
}

const PRESENCE_HINTS: Record<McbotPresenceMode, string> = {
  auto: '有玩家或任务时在线，空服自动离开。',
  always: '空服也保持在线，占用服务器资源；仅在你确认时使用。',
  off: '不主动上线；不会打断正在运行的任务或自主会话。',
}

export function McbotPresenceGoalsCard({
  controlReady,
  onChanged,
}: {
  controlReady: boolean
  onChanged?: () => void
}) {
  const toast = useToast()
  const [presence, setPresence] = useState<McbotPresenceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingMode, setPendingMode] = useState<McbotPresenceMode | null>(null)
  const requestIdRef = useRef(0)
  const busyRef = useRef(false)

  const load = useCallback(async (signal?: AbortSignal, afterAction = false) => {
    if (busyRef.current && !afterAction) return
    const requestId = ++requestIdRef.current
    try {
      const result = await api.mcbot.presence(signal)
      if (signal?.aborted || requestId !== requestIdRef.current) return
      setPresence(result.presence ?? null)
      setError(null)
    } catch (failure) {
      if (signal?.aborted || isAbortError(failure) || requestId !== requestIdRef.current) return
      setError(isApiError(failure) ? toErrorMessage(failure) : '在线模式读取失败')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
      requestIdRef.current += 1
    }
  }, [load])

  usePolling(() => load(), 5000)

  async function applyMode(): Promise<void> {
    const mode = pendingMode
    if (!mode || !controlReady || busyRef.current) {
      setPendingMode(null)
      return
    }
    busyRef.current = true
    requestIdRef.current += 1
    setBusy(true)
    try {
      await api.mcbot.setPresence(mode)
      toast.success(`在线模式已切换为「${PRESENCE_LABELS[mode]}」`)
      onChanged?.()
      await load(undefined, true)
    } catch (failure) {
      if (!isAbortError(failure)) toast.error(isApiError(failure) ? toErrorMessage(failure) : '操作失败')
    } finally {
      busyRef.current = false
      setBusy(false)
      setPendingMode(null)
    }
  }

  return (
    <>
      <Card
        className="mcbot-goals-card"
        title="在线模式"
        description="只决定 Bot 何时保持在线。任务、移动和目标由管理员对话决定。"
        actions={<Badge tone={controlReady ? 'success' : 'muted'}>{controlReady ? '可控' : '只读'}</Badge>}
      >
        {error ? <InlineError message={error} /> : null}
        <div className="mcbot-presence-controls">
          <span className="mcbot-fact-label">在线模式</span>
          <div className="mcbot-task-controls" role="group" aria-label="在线模式">
            {(Object.keys(PRESENCE_LABELS) as McbotPresenceMode[]).map((mode) => (
              <Button
                key={mode}
                variant={presence?.mode === mode ? 'primary' : 'secondary'}
                size="sm"
                disabled={!controlReady || busy}
                onClick={() => setPendingMode(mode)}
              >
                {PRESENCE_LABELS[mode]}
              </Button>
            ))}
          </div>
          {presence ? (
            <span className="mcbot-fact-hint">
              {PRESENCE_HINTS[presence.mode]}
              {presence.source === 'persisted' && presence.updatedAt ? (
                <> · 已持久化 <RelativeTime ts={presence.updatedAt} /></>
              ) : null}
            </span>
          ) : null}
        </div>
      </Card>

      <ConfirmDialog
        open={pendingMode !== null}
        title="切换在线模式"
        message={pendingMode ? `确定切换到「${PRESENCE_LABELS[pendingMode]}」？` : ''}
        confirmText="确认"
        tone="primary"
        loading={busy}
        onConfirm={() => { void applyMode() }}
        onClose={() => {
          if (!busy) setPendingMode(null)
        }}
      />
    </>
  )
}
