// Minecraft Bot 面板只保留三块：状态、会话、事件记录。
// 在线模式与急停在状态卡内；急停需要确认，成功后会话按后续 chat 响应刷新。
// 不展示 Token、地址或内部路径。聊天与事件一律纯文本。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Clock, RefreshCw, Square } from 'lucide-react'
import { api, isAbortError, isApiError, toErrorMessage } from '../../api/client'
import type { McbotPresenceMode, McbotSnapshot } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { EmptyState } from '../EmptyState'
import { InlineError } from '../InlineError'
import { RelativeTime } from '../RelativeTime'
import { SkeletonText } from '../Skeleton'
import { useToast } from '../Toast'
import { McbotChatCard } from './McbotChatCard'
import { McbotEventsCard } from './McbotEventsCard'
import { mcbotBotStateLabel, mcbotErrorLabel, mcbotTaskNameLabel, mcbotTaskStateLabel, safeLofiiStatus } from '../../lib/mcbot'

/** /api/mcbot/status 轮询间隔。 */
const STATUS_POLL_MS = 5000

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

function dashNumber(value: number | null | undefined, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function Fact({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mcbot-fact">
      <span className="mcbot-fact-label">{label}</span>
      <span className="mcbot-fact-value">{children}</span>
      {hint ? <span className="mcbot-fact-hint">{hint}</span> : null}
    </div>
  )
}

function McbotStatusCard({
  snapshot,
  error,
  refreshing,
  controlReady,
  onRefresh,
  onStopped,
}: {
  snapshot: McbotSnapshot
  error: string | null
  refreshing: boolean
  controlReady: boolean
  onRefresh: () => void
  onStopped: () => void
}) {
  const toast = useToast()
  const status = safeLofiiStatus(snapshot.status)
  const connected = status?.minecraft.connected === true
  const tps = status?.admin.tps
  const tpsOne = tps?.one ?? null
  const tpsFive = tps?.five ?? null
  const tpsFifteen = tps?.fifteen ?? null
  const tpsReady =
    typeof tpsOne === 'number' && typeof tpsFive === 'number' && typeof tpsFifteen === 'number'
  const tpsText = tpsReady
    ? `${tpsOne.toFixed(1)} / ${tpsFive.toFixed(1)} / ${tpsFifteen.toFixed(1)}`
    : '—'
  const task = status?.task
  const taskText = !task
    ? '—'
    : task.name
      ? `${mcbotTaskNameLabel(task.name)} · ${mcbotTaskStateLabel(task.state)}`
      : mcbotTaskStateLabel(task.state)
  const mode = status?.presence.mode ?? 'auto'
  const [pendingMode, setPendingMode] = useState<McbotPresenceMode | null>(null)
  const [switching, setSwitching] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)

  async function applyMode(): Promise<void> {
    const next = pendingMode
    if (!next || !controlReady || switching) {
      setPendingMode(null)
      return
    }
    setSwitching(true)
    try {
      await api.mcbot.setPresence(next)
      toast.success(`在线模式已切换为「${PRESENCE_LABELS[next]}」`)
      onRefresh()
    } catch (failure) {
      if (!isAbortError(failure)) toast.error(isApiError(failure) ? toErrorMessage(failure) : '操作失败')
    } finally {
      setSwitching(false)
      setPendingMode(null)
    }
  }

  async function stop(): Promise<void> {
    if (!controlReady || stopping) return
    setStopping(true)
    try {
      const result = await api.mcbot.emergencyStop()
      if (result.ok) toast.success('已急停')
      else toast.error(`急停未全部完成：${result.failures.join('、') || '未知'}`)
      setConfirmStop(false)
      onStopped()
    } catch (failure) {
      toast.error(toErrorMessage(failure, '急停失败'))
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <Card
        title="Bot 状态"
        description="连接、血量、饥饿、任务、TPS 与版本。在线模式和急停也在这里。"
        actions={
          <div className="card-actions-inline">
            <Badge tone={snapshot.reachable ? 'success' : 'danger'} dot>
              {snapshot.reachable ? '可达' : '不可达'}
            </Badge>
            <Badge tone={snapshot.controlEnabled ? 'accent' : 'muted'}>
              {snapshot.controlEnabled ? '控制可用' : '控制未启用'}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新 mcbot 状态"
              title="刷新"
              loading={refreshing}
              onClick={onRefresh}
              icon={<RefreshCw size={16} aria-hidden="true" />}
            />
          </div>
        }
      >
        {error ? <InlineError message={`${error}（显示上次成功获取的数据）`} onRetry={onRefresh} /> : null}

        {status ? (
          <div className="mcbot-status-grid">
            <Fact label="连接">
              <Badge tone={connected ? 'success' : 'danger'} dot>
                {connected ? `已连接（${status.minecraft.username}）` : '未连接'}
              </Badge>
              <span className="mcbot-fact-sub"> · {mcbotBotStateLabel(status.state)}</span>
            </Fact>
            <Fact label="血量">{dashNumber(status.player.health)}</Fact>
            <Fact label="饥饿">{dashNumber(status.player.food)}</Fact>
            <Fact label="任务">{taskText}</Fact>
            <Fact label={status.admin.tick ? '刻率目标 / MSPT' : '刻指标'} hint={status.admin.rcon ? undefined : 'RCON 不可用'}>
              {status.admin.tick ? `${status.admin.tick.targetRate.toFixed(1)} / ${status.admin.tick.averageMs.toFixed(1)} ms` : tpsText}
            </Fact>
            <Fact label="版本">
              {snapshot.version ?? status.version ?? '未知'}
              <span className="mcbot-fact-sub">
                {' '}
                · 契约 {typeof snapshot.contractVersion === 'number' ? `v${snapshot.contractVersion}` : '—'}
              </span>
            </Fact>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Clock size={22} />}
            title="暂无 mcbot 状态快照"
            description="mcbot 不可达或尚未完成首次轮询；可稍后重试。"
          />
        )}

        {status?.minecraft.lastDisconnect ? (
          <div className="notice notice-warning">
            <span>
              上次 Minecraft 断线：<RelativeTime ts={status.minecraft.lastDisconnect.at} />
              {status.minecraft.lastDisconnect.reason ? `（${status.minecraft.lastDisconnect.reason}）` : ''}；累计重连{' '}
              {status.minecraft.reconnects} 次。
            </span>
          </div>
        ) : null}

        <div className="mcbot-presence-controls">
          <span className="mcbot-fact-label">在线模式</span>
          <div className="mcbot-task-controls" role="group" aria-label="在线模式">
            {(Object.keys(PRESENCE_LABELS) as McbotPresenceMode[]).map((item) => (
              <Button
                key={item}
                variant={mode === item ? 'primary' : 'secondary'}
                size="sm"
                disabled={!controlReady || switching || stopping}
                onClick={() => setPendingMode(item)}
              >
                {PRESENCE_LABELS[item]}
              </Button>
            ))}
          </div>
          {status ? <span className="mcbot-fact-hint">{PRESENCE_HINTS[mode]}</span> : null}
        </div>

        <div className="mcbot-chat-stop">
          <Button
            variant="danger"
            icon={<Square size={16} aria-hidden="true" />}
            disabled={!controlReady || stopping}
            onClick={() => setConfirmStop(true)}
          >
            急停
          </Button>
          <span className="field-hint">立即停止任务、自主会话和这次对话，不经过模型。</span>
        </div>

        <p className="card-footnote">
          上次轮询 <RelativeTime ts={snapshot.lastPollAt} fallback="—" />
          {typeof snapshot.contractVersion === 'number' && snapshot.contractVersion !== 2
            ? ' · mcbot 契约不是 v2'
            : ''}
        </p>
      </Card>
      <ConfirmDialog
        open={pendingMode !== null}
        title="切换在线模式"
        message={pendingMode ? `确定切换到「${PRESENCE_LABELS[pendingMode]}」？` : ''}
        confirmText="确认"
        tone="primary"
        loading={switching}
        onConfirm={() => { void applyMode() }}
        onClose={() => {
          if (!switching) setPendingMode(null)
        }}
      />
      <ConfirmDialog
        open={confirmStop}
        title="急停"
        message="确定停止当前任务、自主会话和管理员对话？"
        details="空闲时也算成功。已经发生的世界动作不会回滚。"
        confirmText="急停"
        tone="danger"
        loading={stopping}
        onConfirm={() => { void stop() }}
        onClose={() => {
          if (!stopping) setConfirmStop(false)
        }}
      />
    </>
  )
}

export function McbotPanel() {
  const [snapshot, setSnapshot] = useState<McbotSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [chatReloadToken, setChatReloadToken] = useState(0)
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    try {
      const next = await api.mcbot.status(controller.signal)
      if (requestId !== requestIdRef.current) return
      setSnapshot(next)
      setError(null)
      setErrorCode(null)
    } catch (loadError) {
      if (isAbortError(loadError) || requestId !== requestIdRef.current) return
      setError(toErrorMessage(loadError, '加载 mcbot 状态失败'))
      setErrorCode(isApiError(loadError) ? loadError.code : null)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  usePolling(() => load(), STATUS_POLL_MS)

  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const disabled = snapshot ? !snapshot.enabled : errorCode === 'mcbot_disabled'
  const awaitingFirstPoll =
    snapshot !== null && !snapshot.reachable && snapshot.lastPollAt === null && snapshot.error === null
  const controlReady = snapshot?.enabled === true && snapshot.reachable && snapshot.controlEnabled

  if (disabled) {
    return (
      <div className="mcbot-panel">
        <div className="notice notice-muted">
          <span>
            mcbot 集成未启用（服务端 MCBOT_ENABLED=false）。启用后需要配置 mcbot 地址与 Token 并重启应用；
            本页不展示任何 Token、内部地址或凭据。
          </span>
          <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void refresh()}>
            重新检测
          </Button>
        </div>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="mcbot-panel">
        <Card
          title="Bot 状态"
          loading={loading}
          skeleton={<SkeletonText lines={5} />}
          error={loading ? null : error ?? '无法获取 mcbot 状态'}
          onRetry={() => void refresh()}
        >
          <p className="mcbot-muted">mcbot 状态不可用。</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mcbot-panel">
      {awaitingFirstPoll ? (
        <div className="notice notice-muted">
          <span>正在等待 mcbot 首次轮询结果；轮询完成前状态可能为空，控制操作暂不可用。</span>
        </div>
      ) : !snapshot.reachable ? (
        <div className="notice notice-warning">
          <span>
            无法连接 mcbot：{mcbotErrorLabel(snapshot.error)}。当前显示上次成功轮询的缓存数据，控制操作不可用。
          </span>
        </div>
      ) : null}
      {snapshot.stale ? (
        <div className="notice notice-warning">
          <span>
            mcbot 数据已过期（上次成功轮询 <RelativeTime ts={snapshot.lastSuccessAt ?? null} fallback="尚无成功轮询" />
            ），请检查 mcbot 进程；新数据恢复前请勿依赖当前状态。
          </span>
        </div>
      ) : null}
      {snapshot.eventGap ? (
        <div className="notice notice-warning">
          <span>
            mcbot 事件缺口：启动 {snapshot.eventGap.bootId} 缺少序号 {snapshot.eventGap.fromSeq}–{snapshot.eventGap.toSeq}
            （发现于 <RelativeTime ts={snapshot.eventGap.discoveredAt} />）。下方仍显示当前 Bot 状态。
          </span>
        </div>
      ) : null}
      {snapshot.reachable && snapshot.error ? (
        <div className="notice notice-warning">
          <span>
            mcbot 状态可达，但事件流/告警游标异常：{mcbotErrorLabel(snapshot.error)}；事件流可能停止更新，控制仍可尝试。
          </span>
        </div>
      ) : null}
      {!snapshot.controlEnabled ? (
        <div className="notice notice-muted">
          mcbot 控制未启用（服务端未配置 MCBOT_CONTROL_TOKEN）：对话和急停已禁用。
        </div>
      ) : null}

      <McbotStatusCard
        snapshot={snapshot}
        error={error}
        refreshing={refreshing}
        controlReady={controlReady}
        onRefresh={() => { void refresh() }}
        onStopped={() => setChatReloadToken((value) => value + 1)}
      />
      <McbotChatCard controlReady={controlReady} reloadToken={chatReloadToken} />
      <McbotEventsCard snapshot={snapshot} />
    </div>
  )
}
