/** 核对前端登记版本、Rust 主包及 Tauri 安装版本；不打开数据库或原生密钥库。 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function clientVersionErrors(version, sources) {
  const errors = []
  const patterns = {
    'apps/client/package.json': /"version"\s*:\s*"([^"\s]+)"/,
    'apps/client/src/lib/app-version.ts': /APP_VERSION\s*=\s*'([^']+)'/,
    'apps/client/src-tauri/Cargo.toml': /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
    'apps/client/src-tauri/tauri.conf.json': /"version"\s*:\s*"([^"\s]+)"/,
    'apps/client/src-tauri/Cargo.lock': /name = "antifieldcomplexx-client"\r?\nversion = "([^"]+)"/,
  }
  for (const [file, pattern] of Object.entries(patterns)) {
    if (pattern.exec(sources[file] ?? '')?.[1] !== version) errors.push(`${file} 与产品版本不一致`)
  }
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
    const paths = ['apps/client/package.json', 'apps/client/src/lib/app-version.ts', 'apps/client/src-tauri/Cargo.toml', 'apps/client/src-tauri/tauri.conf.json', 'apps/client/src-tauri/Cargo.lock']
    const errors = clientVersionErrors(version, Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')])))
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(`客户端版本一致：${version}`)
  } catch (error) { console.error(error instanceof Error ? error.message : '客户端版本校验失败'); process.exitCode = 1 }
}
