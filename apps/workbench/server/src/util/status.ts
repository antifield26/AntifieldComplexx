/**
 * 只读状态文件解析：世界备份/拉取/演练与异地副本脚本写入的 JSON 状态。
 *
 * 约束：
 * - 应用只读，从不写这些文件；文件缺失、不可读、不是 JSON 对象或超过大小上限时返回 null，不抛错。
 * - 返回原始对象（字段由脚本定义），前端按约定字段渲染，服务端不解释业务含义。
 * - 状态文件由 root/PC 脚本写入，大小上限用于防御异常/损坏文件导致的内存与序列化放大。
 */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'

export type StatusFileRecord = Record<string, unknown>

/** 状态文件大小上限（64 KiB）：正常状态 JSON 仅数 KiB，超过视为异常并降级为 null。 */
export const MAX_STATUS_FILE_BYTES = 64 * 1024

/** 从同一文件句柄读取有界文本；实际字节也受限，文件增长或非普通文件均拒绝。 */
export function readStatusText(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_STATUS_FILE_BYTES) throw new Error('status_file_invalid')
    const buffer = Buffer.alloc(MAX_STATUS_FILE_BYTES + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null)
      if (count === 0) break
      bytes += count
    }
    if (bytes > MAX_STATUS_FILE_BYTES) throw new Error('status_file_too_large')
    return buffer.toString('utf8', 0, bytes)
  } finally {
    closeSync(fd)
  }
}

/** 读取状态 JSON；任何异常都降级为 null，避免脚本状态缺失影响主服务。 */
export function readStatusFile(path: string): StatusFileRecord | null {
  try {
    const parsed: unknown = JSON.parse(readStatusText(path))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as StatusFileRecord
  } catch {
    return null
  }
}
