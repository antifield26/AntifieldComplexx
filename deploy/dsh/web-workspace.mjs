/**
 * DSH Web 的工作区工具。所有命令在只挂载工作区和系统运行库的独立命名空间执行。
 * 命令无网络、无宿主环境变量、无 Agent 凭据，并逐次请求 DSH 审批。
 */
import { execFile } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

export const name = 'antifield-workspace'
export const inject = ['tools', 'approval']
const runFile = promisify(execFile)
const READ = 'workspace_read'
const COMMAND = 'workspace_command'
const APPROVED = new Set([READ, COMMAND])
const READ_SCRIPT = 'p=$(realpath -e -- "$1") && [[ $p == /workspace/* && -f $p ]] && head -c 65536 -- "$p"'

export function sandboxArgs(root, args) {
  return [
    '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
    // 保留 systemd 的内核保护，隔离子进程只看到空的 proc 目录。
    '--dir', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', root, '/workspace',
    '--chdir', '/workspace', '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin',
    '--', '/usr/bin/bash', '--noprofile', '--norc', ...args,
  ]
}

async function sandbox(root, args, signal) {
  try {
    const { stdout } = await runFile('/usr/bin/bwrap', sandboxArgs(root, args), {
      maxBuffer: 64 * 1024,
      timeout: 15_000,
      signal,
      env: { PATH: '/usr/bin:/bin' },
    })
    return stdout
  } catch {
    throw new Error('工作区操作失败、被隔离策略拒绝或超出限制')
  }
}

function spec(name, description, property, limit, execute) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { [property]: { type: 'string', minLength: 1, maxLength: limit } }, required: [property], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute,
  }
}

export async function apply(ctx) {
  const root = realpathSync(process.cwd())
  await sandbox(root, ['-c', 'test ! -e /var/lib && test ! -e /run/credentials && test ! -e /proc/self/environ && test -d /workspace'], AbortSignal.timeout(5000))
  ctx.tools.guard(({ name, agent }) => agent && APPROVED.has(name) ? undefined : '仅可使用隔离的工作区工具')
  ctx.tools.register(spec(READ, '读取工作区内的普通文本文件。路径必须相对于工作区。', 'path', 512, async ({ path }, exec) => {
    if (typeof path !== 'string' || path.length > 512 || path.startsWith('/') || path.split('/').includes('..') || /[\x00-\x1f\x7f]/u.test(path)) {
      throw new Error('只允许工作区相对路径')
    }
    return sandbox(root, ['-c', READ_SCRIPT, 'workspace_read', path], exec.signal)
  }))
  ctx.tools.register(spec(COMMAND, '请求一次人工审批，在无网络的隔离工作区运行 Bash 命令。', 'command', 8192, async ({ command }, exec) => {
    if (typeof command !== 'string' || command.length < 1 || command.length > 8192 || command.includes('\0')) throw new Error('命令格式无效')
    if (!exec.agent || exec.signal.aborted) throw new Error('命令缺少有效会话')
    const decision = await ctx.approval.request({
      agent: exec.agent,
      toolName: COMMAND,
      callId: exec.callId,
      reason: '仅在隔离工作区执行此命令',
      signal: exec.signal,
    })
    if (decision !== 'allowed-once' || exec.signal.aborted) throw new Error('命令审批未通过')
    return sandbox(root, ['-c', command], exec.signal)
  }))
  writeFileSync(process.env.DSH_WEB_POLICY_READY, 'ready\n', { flag: 'wx', mode: 0o600 })
}
