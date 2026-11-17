#!/usr/bin/env node
/**
 * 只读检查工程指令的 UTF-8 预算、根导航、相对链接与字面命令引用。
 * 不执行文档命令，不访问外网或受限目录；不验证规则语义、链接锚点及生产事实。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const INSTRUCTION_LIMITS = Object.freeze({ root: 12 * 1024, local: 8 * 1024, chain: 24 * 1024 })
const NAMES = new Set(['AGENTS.md', 'AGENTS.override.md'])
const IGNORE = new Set(['.git', '.local', '.agents', '.codex', 'node_modules', 'target', 'dist', 'coverage', 'gen', 'build', '.gradle', '.vite'])

/** 只收集源码树中的普通文件，不跟随符号链接或进入凭据、依赖与产物目录。 */
function collect(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !IGNORE.has(entry.name)) files.push(...collect(path))
    else if (entry.isFile() && NAMES.has(entry.name)) files.push(path)
  }
  return files.sort()
}

/** 提取本地 Markdown 链接；不抓取远端链接，不把代码片段当成指令执行。 */
function localLinks(text) {
  return [...text.matchAll(/(?<!!)\[[^\]\r\n]+\]\(([^)\r\n]+)\)/g)]
    .map((match) => match[1].replace(/^<|>$/g, ''))
    .filter((target) => !/^(?:https?:\/\/|mailto:|#)/i.test(target))
}

function inside(root, path) {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

/** 返回结构化诊断，支持临时夹具根；所有路径检查都限制在指定源码树。 */
export function checkAgentInstructions(root = process.cwd()) {
  root = resolve(root)
  const errors = []
  const files = []
  const fail = (code, file, message) => errors.push({ code, file, message })
  const label = (path) => relative(root, path).replaceAll('\\', '/')
  let scripts
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) throw new Error()
  } catch {
    fail('package_invalid', 'package.json', '无法读取根 npm scripts')
    scripts = {}
  }
  let paths
  try {
    paths = collect(root)
  } catch {
    fail('instructions_unreadable', '.', '无法枚举工程指令')
    return { ok: false, limits: INSTRUCTION_LIMITS, files, errors }
  }
  const rootPath = join(root, 'AGENTS.md')
  if (!paths.includes(rootPath)) fail('root_missing', 'AGENTS.md', '根指令必须是普通文件')
  for (const path of paths) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      fail('instructions_unreadable', label(path), '无法读取工程指令')
      continue
    }
    const file = label(path)
    const bytes = Buffer.byteLength(text, 'utf8')
    const limit = dirname(path) === root ? INSTRUCTION_LIMITS.root : INSTRUCTION_LIMITS.local
    if (!text.trim()) fail('instructions_empty', file, '指令文件不能为空')
    if (bytes > limit) fail('file_budget_exceeded', file, `${bytes} 字节超过 ${limit} 字节预算`)
    const links = []
    for (const target of localLinks(text)) {
      let destination
      try {
        const decoded = decodeURIComponent(target.split(/[?#]/)[0])
        destination = resolve(dirname(path), decoded)
        if (!decoded || isAbsolute(decoded) || !inside(root, destination)) throw new Error()
      } catch {
        fail('link_invalid', file, `本地链接必须位于仓库内：${target}`)
        continue
      }
      if (!existsSync(destination)) fail('link_missing', file, `链接目标不存在：${target}`)
      links.push(destination)
    }
    for (const [, name] of text.matchAll(/\bnpm run ([\w:-]+)/g)) {
      if (!Object.hasOwn(scripts, name)) fail('npm_script_missing', file, `根 npm script 不存在：${name}`)
    }
    for (const [, entry] of text.matchAll(/\bnode (scripts\/[\w./-]+\.mjs)\b/g)) {
      const destination = resolve(root, entry)
      if (!inside(root, destination) || !existsSync(destination)) fail('node_entry_missing', file, `Node 入口不存在：${entry}`)
    }
    files.push({ file, path, bytes, links })
  }
  const rootLinks = new Set(files.find((file) => file.path === rootPath)?.links)
  // 同目录 override 优先；只累计祖先链，不把兄弟目录的指令计入加载预算。
  const selected = new Map()
  for (const file of files) {
    const directory = dirname(file.path)
    if (!selected.has(directory) || file.file.endsWith('AGENTS.override.md')) selected.set(directory, file)
    if (directory !== root && !rootLinks.has(file.path)) fail('navigation_missing', file.file, '局部指令必须在根导航直接引用')
  }
  const summaries = files.map((file) => {
    let chainBytes = 0
    for (let directory = dirname(file.path); inside(root, directory); directory = dirname(directory)) {
      chainBytes += selected.get(directory)?.bytes ?? 0
      if (directory === root) break
    }
    if (chainBytes > INSTRUCTION_LIMITS.chain) fail('chain_budget_exceeded', file.file, `${chainBytes} 字节超过 ${INSTRUCTION_LIMITS.chain} 字节链预算`)
    return { file: file.file, bytes: file.bytes, chainBytes }
  })
  return { ok: errors.length === 0, limits: INSTRUCTION_LIMITS, files: summaries, errors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkAgentInstructions()
  if (result.ok) {
    console.log(`工程指令检查通过：${result.files.length} 份，根 ${result.files.find((file) => file.file === 'AGENTS.md').bytes} 字节，最大指令链 ${Math.max(...result.files.map((file) => file.chainBytes))} 字节`)
  } else {
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
  }
}
