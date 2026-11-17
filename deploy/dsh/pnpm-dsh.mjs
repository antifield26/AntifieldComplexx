#!/usr/local/bin/node
/**
 * DSH 插件查询使用的 pnpm。npm 12 不接受 view 上的 fetch-retries 参数，该参数会让安装框得不到包信息。
 * 只在 view 子命令去掉这一参数，其它命令原样交给系统 pnpm。
 */
import { spawn } from 'node:child_process'

const PNPM = '/usr/local/bin/pnpm'

/** 保留 view 以外的全部参数，并去掉 view 上的 fetch-retries。 */
export function pnpmArguments(argv) {
  const subcommand = argv.find(argument => !argument.startsWith('-'))
  if (subcommand !== 'view') return [...argv]
  return argv.filter(argument => !argument.startsWith('--config.fetch-retries='))
}

if (import.meta.main) {
  const child = spawn(PNPM, pnpmArguments(process.argv.slice(2)), { stdio: 'inherit' })
  child.once('error', () => {
    process.exitCode = 127
  })
  child.once('exit', (code, signal) => {
    if (signal) process.exitCode = 1
    else process.exitCode = code ?? 1
  })
}
