/** 客户端可重现构建入口。三个公开服务源同时注入 Vite 与 Cargo；不读取凭据，不提供默认生产地址。 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEYS = ['VITE_API_ORIGIN', 'VITE_AI_ORIGIN', 'VITE_ACCESS_ORIGIN']

export function parseClientOrigins(text, environment = {}) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (!match || !KEYS.includes(match[1])) throw new Error('客户端构建配置只允许三个公开服务源')
    if (match[1] in values) throw new Error('客户端构建配置存在重复字段')
    values[match[1]] = match[2].trim()
  }
  for (const key of KEYS) {
    const value = environment[key] ?? values[key]
    let url
    try { url = new URL(value) } catch { throw new Error(`缺少或无法解析 ${key}`) }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\r\n]/.test(value)) {
      throw new Error(`${key} 必须是无路径、凭据或查询参数的 HTTPS 源`)
    }
    values[key] = url.origin
  }
  if (new Set(Object.values(values)).size !== KEYS.length) throw new Error('API、AI 和 Access 必须使用不同的源')
  return values
}

export function clientBuildArguments(target) {
  if (target === 'windows') return ['build', '--bundles', 'nsis', '--ci']
  if (target === 'android') return ['android', 'build', '--target', 'aarch64', '--apk', '--ci']
  throw new Error('构建目标必须是 windows 或 android')
}

export function pinAndroidSdk(source) {
  // Tauri 每次初始化都会生成该文件；固定 SDK 的规则由本入口维护，拒绝无法识别的新模板。
  for (const field of ['compileSdk', 'targetSdk']) {
    const pattern = new RegExp(`^(\\s*${field}\\s*=\\s*)\\d+(\\s*)$`, 'gm')
    if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Android 模板缺少唯一的 ${field}`)
    source = source.replace(pattern, (_match, before, after) => `${before}36${after}`)
  }
  return source
}

export function prepareAndroidProject(repoRoot) {
  const gradle = resolve(repoRoot, 'apps/client/src-tauri/gen/android/app/build.gradle.kts')
  if (!existsSync(gradle)) throw new Error('请先执行 tauri android init --ci --skip-targets-install')
  const icons = resolve(repoRoot, 'apps/client/src-tauri/icons/android')
  const expected = ['values/ic_launcher_background.xml', 'mipmap-anydpi-v26/ic_launcher.xml']
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) expected.push(`mipmap-${density}/${name}.png`)
  }
  if (expected.some((name) => !existsSync(resolve(icons, name)))) throw new Error('受版本控制的 Android 图标不完整')
  writeFileSync(gradle, pinAndroidSdk(readFileSync(gradle, 'utf8')))
  // 初始化模板中的占位图标不作为发布资源；每次构建都同步产品的完整密度和自适应图标。
  cpSync(icons, resolve(repoRoot, 'apps/client/src-tauri/gen/android/app/src/main/res'), { recursive: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const configPath = resolve(root, process.env.CLIENT_BUILD_CONFIG || '.local/client-build.env')
    const origins = parseClientOrigins(existsSync(configPath) ? readFileSync(configPath, 'utf8') : '', process.env)
    const args = clientBuildArguments(process.argv[2])
    if (process.argv[2] === 'android') {
      prepareAndroidProject(root)
    }
    const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    if (!existsSync(npmCli)) throw new Error('请通过 npm run build:client:windows 或 build:client:android 执行')
    const result = spawnSync(process.execPath, [npmCli, 'exec', '--', 'tauri', ...args], {
      cwd: resolve(root, 'apps/client'), env: { ...process.env, ...origins }, stdio: 'inherit',
    })
    if (result.error) throw new Error('无法启动客户端构建工具')
    process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : '客户端构建失败')
    process.exitCode = 1
  }
}
