// 备份状态卡：Dashboard 与 Settings 备份区共用的只读健康面板。
// 展示应用归档、密钥包、pending/acked/孤儿、世界备份、PC 拉取与最近演练；
// 状态文件缺失显示“未运行/未知”，异常红黄高亮，不展示归档路径等敏感信息。

import type {
  BackupArchive,
  BackupEncryptionStatus,
  BackupState,
  BackupStatus,
  DrillStatus,
  OffsiteStatus,
  WorldBackupStatus,
  WorldPullStatus,
} from '../../api/types'
import { Badge } from '../Badge'
import type { BadgeTone } from '../Badge'
import { InlineError } from '../InlineError'
import { RelativeTime } from '../RelativeTime'
import { SkeletonText } from '../Skeleton'
import { formatDateTime } from '../../lib/format'
import { cx } from '../../lib/classnames'
import {
  backupHealthLabel,
  buildBackupStatusEntries,
  worstBackupTone,
} from '../../lib/backup-status'
import type { BackupHealthTone } from '../../lib/backup-status'

export interface BackupStatusCardProps {
  /** /api/dashboard 的 backup（含 secretsOk/world/worldPull/drill 扩展字段） */
  health?: BackupStatus['health']
  backup?: BackupStatus | null
  /** /api/backups 的 state */
  state?: BackupState | null
  world?: WorldBackupStatus | null
  worldPull?: WorldPullStatus | null
  drill?: DrillStatus | null
  /** v0.7.0：备份整包加密与异地副本只读状态（缺失时显示未配置/未运行）。 */
  encryption?: BackupEncryptionStatus | null
  offsite?: OffsiteStatus | null
  /** 当前部署 schema 版本；用于“演练 schema 与部署不一致”提示（未知时不比较）。 */
  currentSchemaVersion?: number | null
  archives?: BackupArchive[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  className?: string
}

const TONE_BADGE: Record<BackupHealthTone, BadgeTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'muted',
}

function toneBadgeTone(tone: BackupHealthTone): BadgeTone {
  return TONE_BADGE[tone]
}

/** 备份健康状态面板；所有数据缺失时降级为空态提示而不是报错。 */
export function BackupStatusCard({
  health,
  backup = null,
  state = null,
  world = null,
  worldPull = null,
  drill = null,
  encryption = null,
  offsite = null,
  currentSchemaVersion = null,
  archives = [],
  loading = false,
  error = null,
  onRetry,
  className,
}: BackupStatusCardProps) {
  const legacy = buildBackupStatusEntries({
    backup,
    state,
    world: world ?? backup?.world ?? null,
    worldPull: worldPull ?? backup?.worldPull ?? null,
    drill: drill ?? backup?.drill ?? null,
    encryption: encryption ?? backup?.encryption ?? null,
    offsite: offsite ?? backup?.offsite ?? null,
    currentSchemaVersion,
    archives,
  })
  const facts = health ?? backup?.health
  const entries = facts?.length ? [...facts.map(item => ({
    key: item.key, label: item.title, value: item.state,
    tone: (item.state === '失败' ? 'danger' : ['超期','尚无证据'].includes(item.state) ? 'warning' :
      item.state === '正常' ? 'success' : 'muted') as BackupHealthTone,
    timestamp: null, detail: [item.location, item.reason,
      ...(item.lastRunAt ? ['最近执行 ' + formatDateTime(item.lastRunAt)] : []),
      ...(item.lastSuccessAt ? ['最近成功 ' + formatDateTime(item.lastSuccessAt)] : []),
      ...(item.key === 'drill_stale' || item.key === 'cloud_drill' ? ['已验证可恢复到 ' + (item.recoveryPoint ? formatDateTime(item.recoveryPoint) : '暂无数据')] : [])
    ].join(' · '), alert: ['失败','超期','尚无证据'].includes(item.state),
  })), ...legacy.filter(item => ['encryption','acked','orphan'].includes(item.key))] : legacy
  const hasAnyData =
    Boolean(backup) ||
    Boolean(state) ||
    Boolean(world) ||
    Boolean(worldPull) ||
    Boolean(drill) ||
    Boolean(encryption) ||
    Boolean(offsite) ||
    archives.length > 0
  const allUnknown = entries.every((entry) => entry.tone === 'muted')

  if (loading && !hasAnyData) {
    return (
      <div className={cx('backup-status', className)} aria-busy="true">
        <SkeletonText lines={3} />
      </div>
    )
  }

  return (
    <section className={cx('backup-status', className)} aria-label="备份健康状态">
      <header className="backup-status-header">
        <div className="backup-status-summary">
          <span className="backup-status-title">备份健康</span>
          <Badge tone={toneBadgeTone(worstBackupTone(entries))}>{facts?.[0]?.state ?? backupHealthLabel(entries)}</Badge>
        </div>
        {onRetry ? (
          <button type="button" className="link-button backup-status-retry" onClick={onRetry}>
            刷新状态
          </button>
        ) : null}
      </header>

      {error ? <InlineError message={error} onRetry={onRetry} /> : null}

      {!hasAnyData ? (
        <div className="notice notice-muted">
          尚无备份状态记录：应用归档、密钥包、世界备份、恢复演练、备份加密与异地副本均未上报。完成首次 Pi 备份与 PC 拉取后会在这里显示。
        </div>
      ) : null}

      <ul className="backup-status-grid">
        {entries.map((entry) => (
          <li
            id={'backup-' + entry.key}
            key={entry.key}
            className={cx(
              'backup-status-item',
              `backup-status-item-${entry.tone}`,
              entry.alert && 'backup-status-item-alert',
            )}
          >
            <span className="backup-status-label">{entry.label}</span>
            <span className="backup-status-value">{entry.value}</span>
            <span className="backup-status-meta">
              {entry.timestamp ? (
                <RelativeTime ts={entry.timestamp} className="backup-status-time" />
              ) : (
                <span className="backup-status-time">
                  {facts?.some(item => item.key === entry.key) ? '' : entry.tone === 'muted' ? '未运行' : '—'}
                </span>
              )}
              {entry.detail ? (
                <span className="backup-status-detail" title={entry.detail}>
                  {entry.detail}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {allUnknown && hasAnyData ? (
        <p className="field-hint">状态字段均缺失：可能尚未运行对应脚本，或服务端未下发相关字段。</p>
      ) : null}
    </section>
  )
}
