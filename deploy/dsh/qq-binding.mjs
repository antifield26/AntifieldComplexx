/** 独立 QQ 服务的绑定状态机。凭据只在本账号内存和受限绑定文件中流转。 */
import { randomUUID } from 'node:crypto'
import { constants, closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

const identifier = /^[A-Za-z0-9_-]{1,128}$/
const maximumBody = 64 * 1024
const lifetime = 5 * 60_000

function validCredentials(value) {
  return typeof value?.appId === 'string' && identifier.test(value.appId)
    && typeof value.appSecret === 'string' && value.appSecret.length <= 512 && /^[\x21-\x7e]+$/.test(value.appSecret)
}

function validList(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 200
    && value.every(entry => typeof entry === 'string' && identifier.test(entry))
    && new Set(value).size === value.length
}

export function parseBinding(state) {
  if (state?.version !== 1 || (state.binding !== null && (!validCredentials(state.binding)
    || !validList(state.binding.direct) || !validList(state.binding.groups)))) {
    throw new Error('绑定文件格式无效')
  }
  return state.binding
}

export function readBinding(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > maximumBody) {
    throw new Error('绑定文件权限或格式无效')
  }
  return parseBinding(JSON.parse(readFileSync(path, { encoding: 'utf8', flag: constants.O_RDONLY | constants.O_NOFOLLOW })))
}

export function writeBinding(path, binding) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, binding }) + '\n', { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  // rename 已提交。目录同步失败时保留此次提交，避免运行态与文件回退成不同绑定。
  try {
    const fd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY)
    try { fsyncSync(fd) } finally { closeSync(fd) }
  } catch {
    console.warn('QQ 绑定目录同步失败')
  }
}

export class QqBindingManager {
  #active
  #operation
  #timer
  #busy = false
  #closing = false

  constructor({ binding, switchGateway, persist, scan, readiness, onChange, now = Date.now }) {
    this.#active = binding
    this.switchGateway = switchGateway
    this.persist = persist
    this.scan = scan
    this.readiness = readiness
    this.onChange = onChange
    this.now = now
  }

  view(owner) {
    const current = this.#operation
    return {
      bound: this.#active !== null,
      ready: this.readiness(),
      appIdHint: this.#active ? this.#active.appId.slice(-4) : null,
      phase: this.#busy ? 'switching' : this.#active === null ? 'unbound' : this.readiness() ? 'ready' : 'connecting',
      operation: current?.owner === owner ? {
        id: current.id, phase: current.phase, expiresAt: new Date(current.expiresAt).toISOString(),
        ...(current.qr ? { qr: current.qr } : {}),
        ...(current.candidate ? {
          appIdHint: current.candidate.appId.slice(-4),
          needsAllowlist: this.#active?.appId !== current.candidate.appId,
        } : {}),
        ...(current.error ? { error: current.error } : {}),
      } : null,
    }
  }

  #clear() {
    clearTimeout(this.#timer)
    const previous = this.#operation
    this.#operation = undefined
    previous?.cancelScan?.()
  }

  async execute(input) {
    const { owner, action } = input
    if (typeof owner !== 'string' || !identifier.test(owner)) return { error: 'invalid_request' }
    if (action === 'status') return this.view(owner)
    if (this.#closing || this.#busy) return { error: 'binding_busy' }
    if (action === 'start') {
      if (this.#operation && !['failed', 'complete'].includes(this.#operation.phase)) return { error: 'binding_busy' }
      if (!['qr', 'manual', 'unbind'].includes(input.kind) || (input.kind === 'manual' && !validCredentials(input))) {
        return { error: 'invalid_request' }
      }
      this.#clear()
      const operation = { owner, id: randomUUID(), expiresAt: this.now() + lifetime,
        kind: input.kind, phase: input.kind === 'qr' ? 'waiting' : 'confirm' }
      this.#operation = operation
      this.#timer = setTimeout(() => { if (!this.#busy && this.#operation === operation) this.#clear() }, lifetime)
      this.#timer.unref()
      if (input.kind === 'manual') operation.candidate = { appId: input.appId, appSecret: input.appSecret }
      if (input.kind === 'qr') this.#beginScan(operation)
      return this.view(owner)
    }
    const operation = this.#operation
    if (!operation || operation.owner !== owner || operation.id !== input.id || operation.expiresAt <= this.now()) {
      return { error: 'binding_expired' }
    }
    if (action === 'cancel') {
      this.#clear()
      return this.view(owner)
    }
    if (action === 'refresh' && operation.kind === 'qr' && operation.phase === 'waiting') {
      this.#beginScan(operation)
      return this.view(owner)
    }
    if (action !== 'confirm' || operation.phase !== 'confirm') return { error: 'invalid_request' }
    let next = null
    if (operation.kind !== 'unbind') {
      const credentials = operation.candidate
      const access = credentials.appId === this.#active?.appId ? this.#active : input
      if (!validList(access.direct) || !validList(access.groups)) return { error: 'invalid_allowlist' }
      next = { ...credentials, direct: access.direct, groups: access.groups }
    }
    this.#busy = true
    this.onChange()
    void this.#commit(operation, next)
    return this.view(owner)
  }

  #beginScan(operation) {
    const generation = Symbol()
    operation.generation = generation
    operation.cancelScan?.()
    delete operation.qr
    operation.cancelScan = this.scan(event => {
      if (this.#operation !== operation || operation.generation !== generation
        || operation.phase !== 'waiting' || operation.expiresAt <= this.now()) return
      if (event.qr) {
        operation.qr = event.qr
        return
      }
      delete operation.qr
      if (validCredentials(event)) {
        operation.candidate = { appId: event.appId, appSecret: event.appSecret }
        operation.phase = 'confirm'
      } else {
        operation.phase = 'failed'
        operation.error = 'qr_failed'
      }
      operation.cancelScan?.()
    })
  }

  async #commit(operation, next) {
    try {
      await this.switchGateway(next)
      if (this.#closing) return
      this.persist(next)
      this.#active = next
      operation.phase = 'complete'
    } catch {
      operation.phase = 'failed'
      operation.error = 'binding_switch_failed'
      if (!this.#closing) {
        try { await this.switchGateway(this.#active) } catch { operation.error = 'binding_rollback_failed' }
      }
    } finally {
      delete operation.candidate
      this.#busy = false
      if (!this.#closing) console.info(operation.phase === 'complete' ? 'QQ 绑定操作已提交' : 'QQ 绑定操作失败')
      this.onChange()
      if (operation.expiresAt <= this.now()) this.#clear()
    }
  }

  async reconnect() {
    if (this.#closing || this.#busy || this.#active === null || this.readiness()) return
    try { await this.switchGateway(this.#active) }
    catch { this.onChange() }
  }

  close() {
    this.#closing = true
    this.#clear()
  }
}

/** 只接受 Unix socket 上的固定 JSON 操作。任何异常都只返回稳定错误码。 */
export function bindingServer(manager) {
  return createServer({ headersTimeout: 4000, requestTimeout: 5000 }, async (request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    if (request.method !== 'POST' || request.url !== '/binding' || request.headers['content-type'] !== 'application/json') {
      response.writeHead(404).end('{"error":"not_found"}')
      return
    }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > maximumBody) throw new Error()
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error()
      response.end(JSON.stringify(await manager.execute(input)))
    } catch {
      response.writeHead(400).end('{"error":"invalid_request"}')
    }
  })
}
