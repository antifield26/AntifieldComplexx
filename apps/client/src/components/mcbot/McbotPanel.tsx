// Minecraft Bot 面板：只读状态、在线模式、管理员对话、事件与历史。
// 世界动作只经对话发起。急停在对话卡内二次确认，不经过模型。
// 不展示 Token、地址或内部路径。聊天与事件一律纯文本。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Clock, RefreshCw } from 'lucide-react'
import { api, isAbortError, isApiError, toErrorMessage } from '../../api/client'
import type { McbotSnapshot } from '../../api/types'
import { usePolling } from '../../hooks/usePolling'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Card } from '../Card'
import { EmptyState } from '../EmptyState'
import { InlineError } from '../InlineError'
import { RelativeTime } from '../RelativeTime'
import { SkeletonText } from '../Skeleton'
import { McbotChatCard } from './McbotChatCard'
import { McbotEventsCard } from './McbotEventsCard'
import { McbotHistoryCard } from './McbotHistoryCard'
import { McbotPresenceGoalsCard } from './McbotPresenceGoalsCard'
import { formatDuration } from '../../lib/format'
import { mcbotBotStateLabel, mcbotErrorLabel, safeLofiiStatus, safeMcbotAutonomy, mcbotAutonomyStateLabel } from '../../lib/mcbot'

/** /api/mcbot/status 轮询间隔。 */
const STATUS_POLL_MS = 5000

const NAVIGATION_STATE_LABELS: Record<string, string> = {
  idle: '待机',
  planning: '规划中',
  executing: '移动中',
  fallback: '兜底',
}

const NAVIGATION_SOURCE_LABELS: Record<string, string> = {
  pathfinder: 'pathfinder',
  planner: '确定性规划',
  ai: 'AI 路点',
  teleport: '安全传送',
  stopped: '已停止',
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

/* ---------- 状态卡 ---------- */

function McbotStatusCard({
  snapshot,
  error,
  refreshing,
  onRefresh,
}: {
  snapshot: McbotSnapshot
  error: string | null
  refreshing: boolean
  onRefresh: () => void
}) {
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

  return (
    <Card
      title="mcbot 状态"
      description="mcbot 每 5 秒被轮询一次；页面隐藏时暂停请求，刷新失败时保留上次成功的数据。"
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
          <Fact label="运行状态">
            <Badge tone={status.state === 'connected' ? 'success' : status.state === 'idle' ? 'muted' : 'warning'}>
              {mcbotBotStateLabel(status.state)}
            </Badge>
          </Fact>
          <Fact label="Minecraft 连接">
            <Badge tone={connected ? 'success' : 'danger'} dot>
              {connected ? `已连接（${status.minecraft.username}）` : '未连接'}
            </Badge>
          </Fact>
          <Fact label="服务器在线 / 上限" hint={status.server.reachable ? status.server.versionName ?? undefined : '服务器状态不可达'}>
            {status.server.reachable ? `${status.server.online} / ${status.server.max}` : '—'}
          </Fact>
          <Fact
            label="TPS（1m / 5m / 15m）"
            hint={status.admin.rcon ? undefined : 'RCON 不可用'}
          >
            {tpsText}
          </Fact>
          <Fact label="mcbot 血量 / 饥饿" hint={status.player.dimension ?? undefined}>
            {dashNumber(status.player.health)} / {dashNumber(status.player.food)}
          </Fact>
          <Fact
            label="AI 队列"
            hint={
              status.ai.enabled
                ? `失败 ${status.ai.failures} 次 · 最近延迟 ${dashNumber(status.ai.lastLatencyMs)} ms`
                : 'AI 已关闭'
            }
          >
            {status.ai.enabled ? `${status.ai.queued} 排队 / ${status.ai.inFlight} 处理中` : '—'}
          </Fact>
          <Fact label="记忆">
            {status.memory.players} 位玩家 / {status.memory.turns} 轮
          </Fact>
          {status.navigation ? (
            <Fact
              label="寻路"
              hint={
                status.navigation.lastFallback
                  ? `最近兜底：${status.navigation.lastFallback === 'teleport' ? '安全传送' : '停止'}`
                  : status.navigation.aiUsed
                    ? 'AI 已参与本次路线'
                    : undefined
              }
            >
              {NAVIGATION_STATE_LABELS[status.navigation.state] ?? status.navigation.state}
              {status.navigation.source
                ? ` · ${NAVIGATION_SOURCE_LABELS[status.navigation.source] ?? status.navigation.source}`
                : ''}
              {status.navigation.lastFallbackReason ? (
                <span className="mcbot-fact-sub">兜底原因：{status.navigation.lastFallbackReason}</span>
              ) : null}
            </Fact>
          ) : null}
          {safeMcbotAutonomy(snapshot.autonomy) ? (
            <Fact label="自主会话">
              {mcbotAutonomyStateLabel(safeMcbotAutonomy(snapshot.autonomy)?.state ?? 'idle')}
            </Fact>
          ) : null}
          <Fact label="mcbot 版本">
            {snapshot.version ?? status.version ?? '未知'}
            <span className="mcbot-fact-sub">
              {' '}
              · 契约 {typeof snapshot.contractVersion === 'number' ? `v${snapshot.contractVersion}` : '—'}
            </span>
          </Fact>
          <Fact label="mcbot 运行时长">{formatDuration(status.uptimeSec)}</Fact>
          <Fact label="白名单数量" hint={status.admin.lastError ?? undefined}>
            {status.admin.whitelist.count ?? '—'}
          </Fact>
          <Fact label="告警联动">
            <Badge tone={snapshot.alertsEnabled ? 'success' : 'muted'}>
              {snapshot.alertsEnabled ? '已启用' : '未启用'}
            </Badge>
          </Fact>
          <Fact label="事件流">
            {Array.isArray(snapshot.events) ? snapshot.events.length : 0} 条
            <span className="mcbot-fact-sub"> · 内存环</span>
          </Fact>
        </div>
      ) : (
        <EmptyState
          compact
          icon={<Clock size={22} />}
          title="暂无 mcbot 状态快照"
          description="mcbot 不可达或尚未完成首次轮询；可稍后重试或查看下方缓存的事件与历史。"
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

      {status?.ai.lastError ? (
        <div className="notice notice-warning">AI 最近错误：{status.ai.lastError}</div>
      ) : null}

      <p className="card-footnote">
        上次轮询 <RelativeTime ts={snapshot.lastPollAt} fallback="—" />
        {typeof snapshot.contractVersion === 'number' && snapshot.contractVersion < 1
          ? ' · mcbot 契约版本过低'
          : ''}
      </p>
    </Card>
  )
}

/* ---------- 面板 ---------- */

export function McbotPanel() {
  const [snapshot, setSnapshot] = useState<McbotSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
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
          title="mcbot 状态"
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

      <McbotPresenceGoalsCard controlReady={controlReady} onChanged={() => { void load() }} />
      <McbotStatusCard snapshot={snapshot} error={error} refreshing={refreshing} onRefresh={() => void refresh()} />
      <McbotChatCard controlReady={controlReady} />

      <section className="mcbot-section" aria-label="事件与历史区">
        <div className="mcbot-section-label"><span>事件与历史</span><span>查看动作结果与状态记录</span></div>
        <McbotEventsCard snapshot={snapshot} />
        <McbotHistoryCard />
      </section>
    </div>
  )
}
