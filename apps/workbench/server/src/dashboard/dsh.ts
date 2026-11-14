/** 仅发布固定 DSH 服务的就绪信息，避免把状态文件中的任意内容传给客户端。 */
import type { Config } from '../config.ts'
import { readStatusFile } from '../util/status.ts'

const UNITS = {
  dsh_web: 'antifield-dsh-web',
  dsh_qq: 'antifield-dsh-qq',
  dsh_mcbot: 'antifield-dsh-mcbot-agent',
} as const

type DshService = keyof typeof UNITS

export function agentServiceUnits(config: Config): Record<string, string> {
  return {
    ...(config.dshWebUrl ? { dsh_web: UNITS.dsh_web } : { opencode: 'opencode' }),
    ...(config.dshQqManaged ? { dsh_qq: UNITS.dsh_qq } : {}),
    ...(config.dshWebUrl && config.mcbotEnabled ? { dsh_mcbot: UNITS.dsh_mcbot } : {}),
  }
}

export function dshReadiness(config: Config) {
  const enabled = agentServiceUnits(config)
  return Object.fromEntries((Object.keys(UNITS) as DshService[]).filter((id) => id in enabled).map((id) => {
    const status = readStatusFile(`/run/${UNITS[id]}-status/status.json`)
    return [id, status?.ready === true && status.version === '0.2.2-rc.3'
      && (id !== 'dsh_qq' || status.pluginVersion === '0.5.5')]
  })) as Partial<Record<DshService, boolean>>
}

export function withDshReadiness<T extends string>(states: Record<string, T>, readiness: ReturnType<typeof dshReadiness>) {
  const result: Record<string, T | 'inactive'> = { ...states }
  for (const [id, ready] of Object.entries(readiness)) {
    if (states[id] === 'active' && !ready) result[id] = 'inactive'
  }
  return result
}
