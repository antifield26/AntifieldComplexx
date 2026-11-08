/**
 * dsh-mcbot 原生工具注册。执行权限与游戏状态均由 mcbot 校验。
 * 启动凭据通过一次性 0600 文件注入，工具只在绑定会话中可见并可调用。
 */
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { isAbsolute } from 'node:path'

export const name = 'dsh-mcbot'
export const inject = ['tools']

const PREFIX = 'mcbot_autonomy_'
const TOOL_NAMES = new Set([
  'start_task', 'stop_task', 'go_home', 'deposit', 'task_status', 'observe',
  'inspect_chest', 'eat', 'equip', 'finish', 'memory_read', 'memory_write', 'memory_forget',
])
const MAX_BYTES = 64 * 1024

export function validateBinding(value) {
  if (!value || typeof value !== 'object'
    || typeof value.socketPath !== 'string' || !isAbsolute(value.socketPath)
    || typeof value.bearer !== 'string' || !/^[a-zA-Z0-9_-]{24,128}$/.test(value.bearer)
    || typeof value.sessionId !== 'string' || !/^session-[a-zA-Z0-9_-]{8,100}$/.test(value.sessionId)
    || !Array.isArray(value.tools) || value.tools.length !== TOOL_NAMES.size) {
    throw new Error('mcbot 工具绑定格式错误')
  }
  const names = new Set()
  for (const tool of value.tools) {
    if (!tool || !TOOL_NAMES.has(tool.name) || names.has(tool.name)
      || typeof tool.description !== 'string' || tool.inputSchema?.type !== 'object'
      || tool.inputSchema?.additionalProperties !== false) {
      throw new Error('mcbot 工具描述格式错误')
    }
    names.add(tool.name)
  }
  return value
}

function takeBinding(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('未配置 mcbot 工具绑定')
  const info = lstatSync(path)
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > MAX_BYTES) {
    throw new Error('mcbot 工具绑定文件权限或大小不符合要求')
  }
  const contents = readFileSync(path, 'utf8')
  unlinkSync(path)
  try {
    return validateBinding(JSON.parse(contents))
  } catch {
    throw new Error('mcbot 工具绑定无法读取')
  }
}

function invokeTool(binding, toolName, args, signal) {
  const body = JSON.stringify({ name: toolName, arguments: args })
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('mcbot 工具参数超限')
  return new Promise((resolveCall, reject) => {
    const failed = () => reject(new Error('mcbot 工具调用未完成'))
    const req = request({
      socketPath: binding.socketPath,
      method: 'POST',
      path: '/tool',
      headers: {
        authorization: `Bearer ${binding.bearer}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      signal,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        failed()
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BYTES) res.destroy()
        else chunks.push(chunk)
      })
      res.on('error', failed)
      res.on('aborted', failed)
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') failed()
          else resolveCall(JSON.stringify(result))
        } catch {
          failed()
        }
      })
    })
    req.on('error', failed)
    req.end(body)
  })
}

export function registerMcbotTools(tools, binding, invoke = invokeTool) {
  const allowed = new Set(binding.tools.map((tool) => PREFIX + tool.name))
  const owns = (agent) => agent?.session?.id === binding.sessionId
  tools.guard((execution) => owns(execution.agent) && allowed.has(execution.name)
    ? undefined
    : '仅当前 Minecraft 自主会话可调用已注册的工具')
  for (const tool of binding.tools) {
    tools.register({
      name: PREFIX + tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args, execution) => {
        if (!owns(execution.agent)) throw new Error('mcbot 工具会话不匹配')
        return invoke(binding, tool.name, args, execution.signal)
      },
    }, { when: ({ agent }) => owns(agent) })
  }
}

export function apply(ctx) {
  const path = process.env.DSH_MCBOT_BINDING
  registerMcbotTools(ctx.tools, takeBinding(path))
  writeFileSync(path + '.ready', 'ready\n', { mode: 0o600, flag: 'wx' })
}
