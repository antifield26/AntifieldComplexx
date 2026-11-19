/** 将告警评估结果压缩为客户端可读事实，只回传受限时间字段。 */
import type { AlertCondition } from '../alerts/service.ts'

const locations: Record<string, string> = { backup_overdue: '树莓派', world_backup_stale: '树莓派' }
const priorities = ['失败', '超期', '尚无证据', '等待调度', '正常', '未启用']
function timestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}
export function backupHealth(conditions: AlertCondition[]) {
  const items = conditions.map(({ event, title, message, status, details }) => {
    const state = status === 'unknown' ? '尚无证据' : status === 'firing'
      ? (details.ok === false || details.error || message.includes('失败') ? '失败' : '超期')
      : details.waiting || (typeof details.pending === 'number' && details.pending > 0) ? '等待调度' : '正常'
    return { key: event, title, reason: message, state, location: locations[event] ?? 'Windows',
      lastSuccessAt: timestamp(details.lastSuccessAt ?? details.lastSecretsAt ?? details.lastBackupAt),
      recoveryPoint: timestamp(details.recoveryPoint) }
  })
  if (!items.some(item => item.key === 'offsite_overdue')) items.push({ key: 'offsite_overdue', title: '异地副本',
    reason: '未启用异地监控', state: '未启用', location: 'Windows', lastSuccessAt: null, recoveryPoint: null })
  return items.sort((a, b) => priorities.indexOf(a.state) - priorities.indexOf(b.state))
}
