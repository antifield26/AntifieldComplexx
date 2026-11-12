/** 首页聚合只读状态与常用入口；刷新失败保留缓存，原生 AI 入口交给受限窗口桥接。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CloudUpload,
  Cpu,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { api, toErrorMessage } from '../api/client'
import { openNativeAiWorkspaceUrl } from '../lib/ai-workspace'
import { isNativeRuntime } from '../lib/native'
import { useToast } from '../components/Toast'
import type { DashboardData, ServiceState, ServicesStatus } from '../api/types'
import { usePolling } from '../hooks/usePolling'
import { useNow } from '../hooks/useNow'
import { useBackups } from '../hooks/useBackups'
import { summarizeBackups } from '../lib/backups'
import { PageHeader } from '../components/PageHeader'
import { Stat } from '../components/Stat'
import { Card } from '../components/Card'
import { Badge } from '../components/Badge'
import type { BadgeTone } from '../components/Badge'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { CopyButton } from '../components/CopyButton'
import { Avatar } from '../components/Avatar'
import { RelativeTime } from '../components/RelativeTime'
import { AuditEntry } from '../components/AuditEntry'
import { AlertsCard } from '../components/alerts/AlertsCard'
import { BackupStatusCard } from '../components/backups/BackupStatusCard'
import { MetricsCharts } from '../components/dashboard/MetricsCharts'
import { SkeletonText } from '../components/Skeleton'
import { useAppMeta } from '../meta/MetaContext'
import { formatBytes, formatClock, formatDateTime, formatPercent, formatUptime, percentOf } from '../lib/format'
import { cx } from '../lib/classnames'

/** 时钟叶子组件：只有它按秒重渲染，避免整个工作台每秒重算。 */
function DashboardClock() {
  const now = useNow(1000)
  return (
    <span className="dashboard-clock" title="Asia/Shanghai">
      {formatClock(new Date(now))}
    </span>
  )
}

const SERVICE_LABELS: Record<keyof ServicesStatus, string> = {
  minecraft: 'Minecraft',
  cloudflared: 'Cloudflare Tunnel',
  opencode: 'opencode',
  dsh_web: 'DeepSeek Harness 工作区',
  dsh_qq: 'DeepSeek Harness QQ',
  dsh_mcbot: 'DeepSeek Harness Minecraft',
  mcbot: 'mcbot',
}

const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  active: '运行中',
  inactive: '已停止',
  unknown: '未知',
}

const SERVICE_BADGE_TONES: Record<ServiceState, BadgeTone> = {
  active: 'success',
  inactive: 'danger',
  unknown: 'muted',
}

/** 工作台：10s 轮询，页面隐藏时暂停；刷新失败保留旧数据并提示。 */
export function Dashboard() {
  const { meta } = useAppMeta()
  const toast = useToast()
  const backups = useBackups()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const dataRef = useRef<DashboardData | null>(null)
  const requestIdRef = useRef(0)

  const load = useCallback(async (mode: 'initial' | 'refresh'): Promise<void> => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    try {
      const result = await api.getDashboard()
      // 10s 轮询、手动刷新与 visibilitychange 可能重叠：只接受最新一次请求的结果。
      if (requestId !== requestIdRef.current) return
      dataRef.current = result
      setData(result)
      setError(null)
      setRefreshError(null)
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      const message = toErrorMessage(loadError, '加载工作台数据失败')
      if (dataRef.current) setRefreshError(message)
      else setError(message)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void load('initial')
    return () => { requestIdRef.current += 1 }
  }, [load])

  usePolling(() => load('refresh'), 10_000)

  if (loading && !data) {
    return (
      <div className="dashboard-page">
        <PageHeader title="首页" description="正在同步你的个人空间…" />
        <div className="stats-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <Stat key={index} label="加载中" value="" loading />
          ))}
        </div>
        <div className="dashboard-row dashboard-row-details">
          <Card loading skeleton={<SkeletonText lines={6} />} />
          <Card loading skeleton={<SkeletonText lines={5} />} />
          <Card loading skeleton={<SkeletonText lines={4} />} />
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="dashboard-page">
        <PageHeader title="首页" description="文件、AI 与 Minecraft，一处连接" />
        <Card title="工作台数据加载失败" error={error} onRetry={() => void load('initial')} />
      </div>
    )
  }

  if (!data) return null

  const { host, storage, minecraft, backup, opencode, services, activity, dsh } = data
  const dshWeb = dsh?.readiness.dsh_web
  const storagePercent = percentOf(storage.usedBytes, storage.quotaBytes)
  const memPercent = percentOf(host.mem.usedBytes, host.mem.totalBytes)
  const rootPercent = percentOf(host.root.usedBytes, host.root.totalBytes)
  const backupStale = backup
    ? Boolean(backup.overdue) || backup.ok === false || (backup.ageHours !== null && backup.ageHours > 48)
    : false
  const backupOverview = backups.data ? summarizeBackups(backups.data) : null
  // 优先使用 dashboard 下发字段；旧服务端回退到 /api/backups 汇总
  const pendingBackups = backup?.pendingCount ?? backupOverview?.pending ?? 0
  const backupError = backup?.lastError ?? backupOverview?.error ?? null
  const mcDegraded = minecraft.tps === null || minecraft.whitelistCount === null
  const tempClass =
    host.tempC === null ? 'text-dim' : host.tempC >= 85 ? 'text-danger' : host.tempC >= 75 ? 'text-warning' : undefined
  // 域名优先取服务端下发的 aiOrigin，其次 opencode.url；均缺失时不渲染可点击链接
  const aiUrl = meta.aiOrigin || dsh?.webUrl || opencode.url || ''
  const aiUnavailable = dshWeb === false || (dshWeb === undefined && !opencode.reachable)
  const concerns: Array<{ label: string; to: string }> = []
  if (!minecraft.online) concerns.push({ label: 'Minecraft 离线', to: '/minecraft' })
  const stoppedServices = Object.entries(services).filter(([key, state]) => key !== 'minecraft' && state === 'inactive')
  if (stoppedServices.length > 0) concerns.push({ label: `${stoppedServices.length} 项服务已停止`, to: '#service-status' })
  const unknownServices = Object.values(services).filter((state) => state === 'unknown')
  if (unknownServices.length > 0) concerns.push({ label: `${unknownServices.length} 项服务状态待确认`, to: '#service-status' })
  if (aiUnavailable && services.dsh_web !== 'inactive' && services.opencode !== 'inactive') concerns.push({ label: 'AI 工作区尚未就绪', to: '#service-status' })
  if (backupStale || backupError) concerns.push({ label: '备份需要处理', to: '/settings#backup' })
  else if (pendingBackups > 0) concerns.push({ label: `${pendingBackups} 个备份待确认`, to: '/settings#backup' })
  else if (!backup?.lastPullAt) concerns.push({ label: '备份尚无拉取记录', to: '/settings#backup' })
  if (storagePercent >= 90) concerns.push({ label: '文件空间紧张', to: '/files' })
  if (rootPercent >= 90 || memPercent >= 90 || host.cpuPercent >= 90 || (host.tempC !== null && host.tempC >= 75)) concerns.push({ label: '主机资源需要留意', to: '#host-status' })

  return (
    <div className="dashboard-page">
      <PageHeader
        title="首页"
        description={`你的个人空间 · 更新于 ${formatDateTime(data.generatedAt)}`}
        actions={
          <div className="dashboard-actions">
            <DashboardClock />
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw size={16} aria-hidden="true" />}
              loading={refreshing}
              onClick={() => void load('refresh')}
            >
              刷新
            </Button>
          </div>
        }
      />

      {refreshError ? (
        <div className="notice notice-warning" role="alert">
          <span>数据刷新失败：{refreshError}，当前显示的是上次成功的数据。</span>
          <Button size="sm" variant="secondary" onClick={() => void load('refresh')}>重试</Button>
        </div>
      ) : null}

      <section className="dashboard-launchpad" aria-label="常用入口">
        <div className="dashboard-launchpad-heading"><span className="section-eyebrow">连接你的日常</span><span>文件 · 智能 · 世界</span></div>
        <div className="dashboard-launchpad-grid">
          {aiUrl ? (
            <a className="launch-card launch-card-ai" href={aiUrl} target="_blank" rel="noopener noreferrer" onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              if (!isNativeRuntime()) return
              event.preventDefault()
              void openNativeAiWorkspaceUrl(aiUrl).catch((failure: unknown) => { toast.error(toErrorMessage(failure, '无法打开工作区')) })
            }}>
              <span className="launch-icon"><Sparkles size={24} aria-hidden="true" /></span>
              <span className="launch-text"><strong>AI 工作区</strong><span>{aiUnavailable ? '尚未就绪 · 查看工作区' : '继续思考，开始创造'}</span></span>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ) : (
            <div className="launch-card launch-card-ai launch-card-disabled" aria-disabled="true"><span className="launch-icon"><Sparkles size={24} aria-hidden="true" /></span><span className="launch-text"><strong>AI 工作区</strong><span>AI 地址尚未配置</span></span></div>
          )}
          <Link className="launch-card" to="/files"><span className="launch-icon"><FolderOpen size={24} aria-hidden="true" /></span><span className="launch-text"><strong>我的文件</strong><span>{storage.fileCount} 个文件，随时取用</span></span><ChevronRight size={17} aria-hidden="true" /></Link>
          <Link className="launch-card" to="/minecraft"><span className="launch-icon"><Gamepad2 size={24} aria-hidden="true" /></span><span className="launch-text"><strong>Minecraft</strong><span>{minecraft.online ? `${minecraft.players.online} 位玩家在线 · 查看 mcbot` : '服务器与 mcbot 控制中心'}</span></span><ChevronRight size={17} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className={cx('dashboard-health', concerns.length > 0 && 'dashboard-health-attention')} aria-label="异常摘要">
        <div className="dashboard-health-heading">{concerns.length > 0 ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<strong>{concerns.length > 0 ? '需要留意' : '暂无已知异常'}</strong></div>
        {concerns.length > 0 ? <div className="dashboard-health-items">{concerns.map((item) => <Link key={item.label} to={item.to}>{item.label}<ChevronRight size={13} aria-hidden="true" /></Link>)}</div> : <span className="dashboard-health-note">主机、文件与服务状态已同步</span>}
      </section>

      <div className="stats-grid" id="host-status">
        <Stat
          label="主机"
          icon={<Cpu size={16} />}
          value={formatPercent(host.cpuPercent, 0)}
          unit="CPU"
          hint={
            <>
              负载 {host.load.map((value) => value.toFixed(2)).join(' / ')}
              {' · '}
              <span className={tempClass}>温度 {host.tempC === null ? '—' : `${host.tempC.toFixed(1)} ℃`}</span>
              {' · '}
              运行 {formatUptime(host.uptimeSec)}
            </>
          }
          footer={
            <>
              <ProgressBar value={memPercent} tone="auto" ariaLabel="内存使用率" />
              <div className="stat-meta">
                <span>内存 {formatBytes(host.mem.usedBytes)} / {formatBytes(host.mem.totalBytes)}</span>
                <span>{formatPercent(memPercent)}</span>
              </div>
            </>
          }
        />

        <Stat
          label="存储"
          icon={<HardDrive size={16} />}
          value={formatBytes(storage.usedBytes)}
          unit={`/ ${formatBytes(storage.quotaBytes)}`}
          tone={storagePercent >= 90 ? 'warning' : 'default'}
          badge={storagePercent >= 90 ? <Badge tone="warning">空间紧张</Badge> : undefined}
          hint={`文件 ${storage.fileCount} 个 · 回收站 ${formatBytes(storage.trashBytes)}`}
          footer={
            <>
              <ProgressBar value={storagePercent} tone="auto" ariaLabel="存储配额使用率" />
              <div className="stat-meta">
                <span>已用 {formatPercent(storagePercent, 1)}</span>
                <span>剩余 {formatBytes(storage.freeBytes)}</span>
              </div>
            </>
          }
        />

        <Stat
          label="Minecraft"
          icon={<Gamepad2 size={16} />}
          value={minecraft.online ? `${minecraft.players.online}/${minecraft.players.max}` : '离线'}
          unit={minecraft.online ? '在线玩家' : undefined}
          tone={minecraft.online ? 'success' : 'danger'}
          badge={<Badge tone={minecraft.online ? 'success' : 'danger'} dot>{minecraft.online ? '在线' : '离线'}</Badge>}
          hint={
            minecraft.online ? (
              <>
                {minecraft.version || '版本未知'}
                {' · '}
                TPS {minecraft.tps ? minecraft.tps.m1.toFixed(2) : '—'}
                {' · '}
                白名单 {minecraft.whitelistCount ?? '—'}
              </>
            ) : (
              <span className="text-warning">{minecraft.error ?? '服务器未响应'}</span>
            )
          }
        />

        <Stat
          label="备份"
          icon={<CloudUpload size={16} />}
          value={backup?.lastPullAt ? <RelativeTime ts={backup.lastPullAt} /> : '无记录'}
          tone={backupStale ? 'danger' : 'default'}
          badge={
            backupStale ? (
              <Badge tone="danger" dot>备份已过期</Badge>
            ) : pendingBackups > 0 ? (
              <Badge tone="warning" dot>{pendingBackups} 个待确认</Badge>
            ) : backupError ? (
              <Badge tone="danger">备份异常</Badge>
            ) : backup === null ? (
              <Badge tone="muted">无数据</Badge>
            ) : (
              <Badge tone="success" dot>正常</Badge>
            )
          }
          hint={
            backup
              ? `${formatBytes(backup.sizeBytes)} · 最近拉取 ${formatDateTime(backup.lastPullAt)}${pendingBackups > 0 ? ` · ${pendingBackups} 个归档待 Windows 拉取确认` : ''}`
              : '尚未收到 Windows 备份任务的上报'
          }
          footer={
            <>
              {backupStale ? (
                <span className="stat-note text-danger">最近拉取已超过 48 小时，请检查 Windows 备份计划任务。</span>
              ) : null}
              {backupError ? <span className="stat-note text-danger">最近错误：{backupError}</span> : null}
              <div className="stat-footer-row">
                <Link className="text-link" to="/settings#backup">管理备份</Link>
                {pendingBackups > 0 ? <span className="stat-note">待确认归档需 PC 拉取并 ack</span> : null}
              </div>
            </>
          }
        />
      </div>

      <div className="dashboard-row dashboard-row-backup">
        <Card
          title="备份状态"
          description="应用归档、密钥包、世界备份与恢复演练；异常项会高亮。"
          actions={<Link className="text-link" to="/settings#backup">管理备份<ChevronRight size={14} aria-hidden="true" /></Link>}
        >
          <BackupStatusCard
            backup={backup}
            state={backups.data?.state ?? null}
            world={backup?.world ?? backups.data?.world ?? null}
            worldPull={backup?.worldPull ?? backups.data?.worldPull ?? null}
            drill={backup?.drill ?? backups.data?.drill ?? null}
            encryption={backup?.encryption ?? null}
            offsite={backup?.offsite ?? backups.data?.offsite ?? null}
            currentSchemaVersion={meta.schemaVersion}
            archives={backups.data?.items ?? []}
            loading={backups.loading && !backups.data}
            error={backups.errorStatus === 404 ? null : backups.error}
            onRetry={() => void backups.refresh()}
          />
        </Card>
      </div>

      <div className="dashboard-row dashboard-row-alerts">
        <AlertsCard />
      </div>

      <div className="dashboard-row dashboard-row-details">
        <Card
          title="Minecraft 详情"
          actions={<Link className="text-link" to="/minecraft">管理白名单<ChevronRight size={14} aria-hidden="true" /></Link>}
          className="mc-detail-card"
        >
          <div className="mc-detail-head">
            <div className="mc-detail-status">
              <Badge tone={minecraft.online ? 'success' : 'danger'} dot>
                {minecraft.online ? '在线' : '离线'}
              </Badge>
              {minecraft.version ? <span className="mc-version">{minecraft.version}</span> : null}
            </div>
            {minecraft.publicAddress ? (
              <div className="mc-address">
                <span className="mono">{minecraft.publicAddress}</span>
                <CopyButton value={minecraft.publicAddress} label="复制地址" ariaLabel="复制 Minecraft 公共地址" />
              </div>
            ) : null}
          </div>

          {minecraft.motd ? <p className="mc-motd">{minecraft.motd}</p> : null}
          {minecraft.error ? <div className="notice notice-warning">{minecraft.error}</div> : null}
          {mcDegraded && !minecraft.error ? (
            <div className="notice notice-warning">RCON 不可用，TPS 与白名单数据暂时无法读取。</div>
          ) : null}

          <div className="mc-facts">
            <div className="mc-fact">
              <span className="mc-fact-label">在线玩家</span>
              <span className="mc-fact-value">{minecraft.players.online} / {minecraft.players.max}</span>
            </div>
            <div className="mc-fact">
              <span className="mc-fact-label">TPS（1m / 5m / 15m）</span>
              <span className="mc-fact-value">
                {minecraft.tps
                  ? `${minecraft.tps.m1.toFixed(1)} / ${minecraft.tps.m5.toFixed(1)} / ${minecraft.tps.m15.toFixed(1)}`
                  : '—'}
              </span>
            </div>
            <div className="mc-fact">
              <span className="mc-fact-label">白名单</span>
              <span className="mc-fact-value">{minecraft.whitelistCount ?? '—'}</span>
            </div>
            <div className="mc-fact">
              <span className="mc-fact-label">服务状态</span>
              <span className="mc-fact-value">{SERVICE_STATE_LABELS[minecraft.serviceActive]}</span>
            </div>
          </div>

          <div className="subsection">
            <h3 className="subsection-title">在线玩家</h3>
            {minecraft.players.names.length > 0 ? (
              <ul className="player-chips">
                {minecraft.players.names.map((name) => (
                  <li key={name} className="player-chip">
                    <Avatar name={name} size={22} />
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">暂无玩家在线</p>
            )}
          </div>

          <p className="card-footnote">
            状态更新于 <RelativeTime ts={minecraft.checkedAt} />
          </p>
        </Card>

        <Card title="连接信息">
          <ul className="quick-links">
            <li>
              <a className="quick-link" href="https://connect.raspberrypi.com" target="_blank" rel="noopener noreferrer">
                <span className="quick-icon" aria-hidden="true"><Cloud size={18} /></span>
                <span className="quick-text"><strong>RPi Connect</strong><span>远程连接树莓派</span></span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </li>
            <li>
              <div className="quick-link">
                <span className="quick-icon" aria-hidden="true"><Gamepad2 size={18} /></span>
                <span className="quick-text"><strong>Minecraft 地址</strong><span className="mono">{minecraft.publicAddress || '尚未配置'}</span></span>
                <CopyButton value={minecraft.publicAddress ?? ''} label="复制" ariaLabel="复制 Minecraft 连接地址" disabled={!minecraft.publicAddress} />
              </div>
            </li>
          </ul>
        </Card>

        <Card title={<span id="service-status">服务状态</span>}>
          <ul className="service-list">
            {(Object.entries(services) as [string, ServiceState][]).map(([key, state]) => (
              <li key={key} className="service-item">
                <span className={cx('service-dot', `service-dot-${state}`)} aria-hidden="true" />
                <span className="service-name">{SERVICE_LABELS[key as keyof ServicesStatus] ?? key}</span>
                <Badge tone={SERVICE_BADGE_TONES[state]}>{SERVICE_STATE_LABELS[state]}</Badge>
              </li>
            ))}
          </ul>
          {dshWeb === false ? <div className="notice notice-warning">DeepSeek Harness 工作区尚未就绪。</div> : null}
          {dshWeb === undefined && (opencode.error || !opencode.reachable) ? (
            <div className="notice notice-warning">
              opencode 当前不可达{opencode.error ? `：${opencode.error}` : '，请检查服务状态。'}
            </div>
          ) : null}
          <div className="service-extra">
            {dshWeb === undefined ? <div className="service-extra-row">
              <span>opencode 会话</span>
              <span>{opencode.sessions ?? '—'}</span>
            </div> : null}
            <div className="service-extra-row">
              <span>根分区使用</span>
              <span>{formatPercent(rootPercent, 1)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="dashboard-row dashboard-row-metrics">
        <MetricsCharts />
      </div>

      <Card
        title="最近活动"
        actions={<Link className="text-link" to="/activity">查看全部<ChevronRight size={14} aria-hidden="true" /></Link>}
        flush
      >
        {activity.length > 0 ? (
          <ul className="audit-list">
            {activity.slice(0, 8).map((item) => (
              <AuditEntry key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={<Activity size={22} />}
            title="暂无活动记录"
            description="登录、文件操作与白名单变更会记录在这里。"
          />
        )}
      </Card>
    </div>
  )
}
