/**
 * 腾讯 QQ 插件的本地策略。仅允许可信入站身份操作其记忆候选。
 * 图片只能来自当前消息已经校验和下载的文件。
 */
import { resolve4 } from 'node:dns/promises'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { get } from 'node:https'
import { QqMemory, qqScope } from './qq-memory.mjs'

const turns = new WeakMap()
const clearing = new Set()
const MEDIA_HOSTS = ['qpic.cn', 'qq.com', 'qq.com.cn', 'gtimg.com', 'gtimg.cn']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const PRIVATE_COMMANDS = new Set(['new', 'reset', 'clear', 'stop', 'bot-help', 'bot-ping', 'bot-status', 'bot-version', 'forget'])
let memory

function memoryStore() {
  if (!process.env.DSH_QQ_MEMORY_DB) throw new Error('QQ 记忆仓未配置')
  memory ??= new QqMemory(process.env.DSH_QQ_MEMORY_DB)
  return memory
}

export function allowQqCommand(kind, text) {
  const command = text.trim().normalize('NFKC').match(/^\/([^\s]*)/u)
  return !command || (kind === 'c2c' && PRIVATE_COMMANDS.has(command[1].toLowerCase()))
}

export function bindQqTurn(agent, scope, downloads) {
  if (!scope || turns.has(agent)) throw new Error('QQ 会话作用域无效')
  const images = new Set(downloads.filter((item) => item.contentType === 'image').map((item) => item.localPath))
  turns.set(agent, { scope, images, generation: memoryStore().generation(scope.app, scope.member) })
  return () => turns.delete(agent)
}

export function inputScope(app, message) {
  if (message.kind === 'c2c') return qqScope(app, 'c2c', message.senderId, message.senderId)
  if (message.kind === 'group') return qqScope(app, 'group', message.groupOpenid, message.senderId)
  return null
}

export function scopedQqContext(scope) {
  const context = memoryStore().context(scope)
  if (!context.role && context.memory.length === 0) return ''
  return `当前会话的角色和记忆资料（仅用于本轮）\n${JSON.stringify(context)}\n\n`
}

export function sessionPeer(scope) {
  // 群内成员各自保有 Agent 历史。回复路由仍使用经过平台确认的群 ID。
  return scope.kind === 'group' ? `${scope.peer}.${scope.member}` : scope.peer
}

export function qqSessionKey(app, kind, peer) {
  const [groupOrUser, member] = peer.split('.')
  const identity = kind === 'group' ? qqScope(app, kind, groupOrUser, member) : qqScope(app, kind, peer, peer)
  const base = `qqbot:${app}:${kind}:${peer}`
  if (!identity) return base
  const generation = memoryStore().generation(app, identity.member)
  return generation ? `${base}:${generation}` : base
}

export function isQqMemberClearing(scope) {
  return clearing.has(`${scope.app}:${scope.member}`)
}

export async function clearQqMemory(scope, manager) {
  const identity = `${scope.app}:${scope.member}`
  if (clearing.has(identity)) return
  clearing.add(identity)
  try {
    // 先封住新回合和候选写入，再收口正在创建或运行的同身份会话。
    const owned = (key) => {
      const [, app, kind, peer] = key.split(':')
      const member = kind === 'group' ? peer?.split('.')[1] : peer
      return app === scope.app && member === scope.member && (kind === 'c2c' || kind === 'group')
    }
    await Promise.allSettled([...manager.inflight].filter(([key]) => owned(key)).map(([, pending]) => pending))
    await Promise.all([...manager.sessions.keys()].filter(owned).map((key) => {
      const [, , kind, peer] = key.split(':')
      return manager.remove(kind, peer)
    }))
    // 代次与结构化删除同事务，重启后也不会恢复同成员的旧会话。
    return memoryStore().forget(scope)
  } finally {
    clearing.delete(identity)
  }
}

function currentTurn(agent) {
  const turn = turns.get(agent)
  if (!turn || isQqMemberClearing(turn.scope)) return null
  const { app, member } = turn.scope
  return memoryStore().generation(app, member) === turn.generation ? turn : null
}

export function canUseQqImage(agent) {
  return Boolean(currentTurn(agent)?.images.size)
}

export function registerQqPolicy(tools) {
  memoryStore()
  const eligible = (agent) => agent && currentTurn(agent)
  tools.guard((execution) => eligible(execution.agent) &&
    (execution.name === 'qqbot_describe_image' || execution.name === 'qq_memory_propose')
    ? undefined
    : 'QQ 会话无权执行该工具')
  tools.register({
    name: 'qq_memory_propose',
    description: '向管理员提交当前成员的一条结构化记忆候选。待审核后才生效。',
    parameters: {
      type: 'object',
      properties: {
        op: { enum: ['upsert', 'delete'] },
        category: { enum: ['profile', 'preference', 'fact', 'project', 'task', 'relationship', 'episode'] },
        key: { type: 'string', maxLength: 80 },
        value: { type: 'string', maxLength: 500 },
      },
      required: ['op', 'category', 'key'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const turn = currentTurn(exec.agent)
      if (!turn || exec.signal.aborted) throw new Error('当前没有授权的 QQ 回合')
      memoryStore().propose(turn.scope, args)
      return '已提交记忆候选，等待管理员审核。'
    },
  }, { when: ({ agent }) => Boolean(eligible(agent)) })
}

export async function openQqImage(agent, path, maxBytes) {
  if (!currentTurn(agent)?.images.has(path)) throw new Error('图片不属于当前 QQ 回合')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    const cap = Math.min(maxBytes, MAX_IMAGE_BYTES)
    if (!info.isFile() || info.size > cap) throw new Error('QQ 图片大小超限')
    const output = Buffer.alloc(info.size)
    const { bytesRead } = await file.read(output, 0, output.length, 0)
    if (bytesRead !== info.size) throw new Error('QQ 图片已变化')
    return output
  } finally {
    await file.close()
  }
}

export function qqImageUrl(input) {
  const url = new URL(input.startsWith('//') ? `https:${input}` : input)
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('QQ 图片来源不在白名单')
  }
  return url
}

function isPublicIpv4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19))
}

export async function downloadQqImage(input, maxBytes) {
  const url = qqImageUrl(input)
  const ips = await resolve4(url.hostname)
  if (ips.length === 0 || ips.some((ip) => !isPublicIpv4(ip))) throw new Error('QQ 图片解析不符合要求')
  const cap = Math.min(maxBytes, MAX_IMAGE_BYTES)
  return await new Promise((resolve, reject) => {
    const fail = () => reject(new Error('QQ 图片下载失败'))
    const req = get(url, {
      signal: AbortSignal.timeout(15_000),
      family: 4,
      lookup: (_host, _options, callback) => callback(null, ips[0], 4),
    }, (res) => {
      if (res.statusCode !== 200 || Number(res.headers['content-length'] ?? 0) > cap) {
        res.destroy()
        fail()
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > cap) {
          res.destroy()
          fail()
        } else chunks.push(chunk)
      })
      res.on('error', fail)
      res.on('aborted', fail)
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', fail)
  })
}

export async function describeQqImage(data, mediaType, prompt, vision, signal) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-flash',
      max_tokens: Math.min(1024, vision.maxTokens),
      messages: [{ role: 'user', content: [
        { type: 'text', text: String(prompt).slice(0, 2000) },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${Buffer.from(data).toString('base64')}` } },
      ] }],
    }),
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('QQ 图片理解请求失败')
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 256 * 1024) throw new Error('QQ 图片理解响应超限')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const text = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim() === '') throw new Error('QQ 图片理解无有效结果')
  return text.slice(0, 4000)
}
