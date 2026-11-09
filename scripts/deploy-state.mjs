/**
 * 部署前检查生产运行时和 SQLite 快照，失败时只输出稳定错误码。
 */
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseEnv } from 'node:util'

export function detectRuntime(env) {
  const raw = (env.DSH_QQ_MANAGED ?? '').trim().toLowerCase()
  if (!['', 'true', '1', 'yes', 'on', 'false', '0', 'no', 'off'].includes(raw)) throw new Error('invalid_dsh_flag')
  const qq = ['true', '1', 'yes', 'on'].includes(raw)
  const url = Boolean(env.DSH_WEB_URL?.trim())
  const socket = Boolean(env.DSH_WEB_SSO_SOCKET?.trim())
  if (url !== socket || url !== qq) throw new Error('conflicting_agent_config')
  // DSH 接管时旧 QQ 开关只用于回滚，Workbench 会强制停用旧链路。
  return qq ? 'dsh' : 'opencode'
}

function databaseSchema(db) {
  const schema = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value)
  if (!Number.isSafeInteger(schema) || schema < 1) throw new Error('invalid_database_schema')
  return schema
}

export async function validateSnapshot(file, expectedHash) {
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || !lstatSync(file).isFile()) throw new Error('invalid_snapshot_input')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== expectedHash) throw new Error('snapshot_hash_mismatch')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('invalid_snapshot_integrity')
    return databaseSchema(db)
  } finally {
    db.close()
  }
}

export function requireSameSchema(path, expected) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const schema = databaseSchema(db)
    if (schema !== expected) throw new Error('cross_schema_requires_maintenance')
    return schema
  } finally {
    db.close()
  }
}

function loadEnv(path) {
  return parseEnv(readFileSync(path, 'utf8'))
}

async function assertMcbotIdle(path) {
  const env = loadEnv(path)
  if (!env.HTTP_TOKEN) throw new Error('mcbot_idle_check_failed')
  const port = Number(env.HTTP_PORT || 3010)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('mcbot_idle_check_failed')
  const get = async (endpoint) => {
    const response = await globalThis.fetch('http://127.0.0.1:' + port + endpoint, {
      headers: { Authorization: 'Bearer ' + env.HTTP_TOKEN },
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error('mcbot_idle_check_failed')
    return response.json()
  }
  const [status, result] = await Promise.all([get('/status'), get('/goals?limit=50')])
  if (status.contractVersion !== 2 || !Array.isArray(status.task?.queue) || !Array.isArray(result.goals) ||
      !status.autonomy || !status.navigation) throw new Error('mcbot_idle_check_failed')
  if (status.task.active || status.task.queue.length || status.autonomy.active ||
      status.navigation.state !== 'idle' ||
      result.goals.some(goal => goal.status === 'running')) throw new Error('mcbot_busy')
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'runtime') {
      console.log(detectRuntime(loadEnv(args[0])))
    } else if (command === 'snapshot') {
      console.log(await validateSnapshot(args[0], args[1]))
    } else if (command === 'same-schema') {
      const env = loadEnv(args[0])
      if (!env.DATA_DIR?.startsWith('/')) throw new Error('invalid_data_dir')
      requireSameSchema(join(env.DATA_DIR, 'db.sqlite'), Number(args[1]))
    } else if (command === 'dsh-ready') {
      for (const role of ['web', 'qq', 'mcbot-agent']) {
        const state = JSON.parse(readFileSync('/run/antifield-dsh-' + role + '-status/status.json', 'utf8'))
        if (state.ready !== true || state.version !== args[0] ||
            (role === 'qq' && state.pluginVersion !== args[1])) throw new Error('dsh_not_ready')
      }
    } else if (command === 'mcbot-idle') {
      await assertMcbotIdle(args[0])
    } else if (command === 'mcbot-ready') {
      const env = loadEnv(args[0])
      if (env.DSH_AGENT_SOCKET && !lstatSync(env.DSH_AGENT_SOCKET).isSocket()) throw new Error('dsh_not_ready')
    } else {
      throw new Error('invalid_deploy_command')
    }
  } catch (error) {
    const safeCodes = ['cross_schema_requires_maintenance', 'conflicting_agent_config',
      'invalid_dsh_flag', 'snapshot_hash_mismatch', 'invalid_snapshot_integrity', 'dsh_not_ready',
      'mcbot_idle_check_failed', 'mcbot_busy']
    console.error(safeCodes.includes(error.message) ? error.message : 'deploy_state_check_failed')
    process.exitCode = 1
  }
}
