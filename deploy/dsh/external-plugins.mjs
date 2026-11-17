/**
 * 把 QQ 与 Minecraft Bot 登记进 DSH Web 的插件页。
 * 条目只负责显示。真正的 QQ 机器人与 Minecraft Bot 工具仍在各自的 Agent 进程。
 */
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const EXTERNAL_PLUGINS = Object.freeze([
  Object.freeze({ name: '@antifield/dsh-qq-plugin', spec: 'file:antifield-qq-plugin' }),
  Object.freeze({ name: '@antifield/dsh-mcbot-plugin', spec: 'file:antifield-mcbot-plugin' }),
])

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 配置是否已经包含两个外部插件条目。 */
export function externalPluginsReady(manifest) {
  if (!plainObject(manifest) || !plainObject(manifest.dependencies) || !Array.isArray(manifest.dsh?.profile?.bundles)) {
    return false
  }
  return EXTERNAL_PLUGINS.every(plugin => typeof manifest.dependencies[plugin.name] === 'string'
    && manifest.dsh.profile.bundles.includes(plugin.name))
}

/** 追加两个插件依赖和启用项，保留原有字段与顺序。 */
export function addExternalPlugins(manifest) {
  if (!plainObject(manifest)) throw new Error('DSH Web 配置无效')
  if (manifest.dependencies !== undefined && !plainObject(manifest.dependencies)) throw new Error('DSH Web 配置无效')
  const profile = manifest.dsh?.profile
  const bundles = profile?.bundles
  if (bundles !== undefined && (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string'))) {
    throw new Error('DSH Web 配置无效')
  }
  const dependencies = { ...manifest.dependencies }
  const selected = [...(bundles ?? [])]
  for (const plugin of EXTERNAL_PLUGINS) {
    if (dependencies[plugin.name] === undefined) dependencies[plugin.name] = plugin.spec
    if (!selected.includes(plugin.name)) selected.push(plugin.name)
  }
  return {
    ...manifest,
    dependencies,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...profile,
        bundles: selected,
      },
    },
  }
}

/** 在 DSH 启动前写入插件条目。配置尚不存在时留给 DSH 初始化，不创建新 profile。 */
export function ensureExternalPlugins(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  let raw
  try {
    if (!lstatSync(manifestPath).isFile()) throw Object.assign(new Error('DSH Web 配置无效'), { code: 'EINVAL' })
    raw = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  const manifest = JSON.parse(raw)
  if (externalPluginsReady(manifest)) return false
  const text = `${JSON.stringify(addExternalPlugins(manifest), null, 2)}\n`
  const temporary = `${manifestPath}.${process.pid}.tmp`
  const handle = openSync(temporary, 'wx', 0o600)
  try {
    writeSync(handle, text)
  } finally {
    closeSync(handle)
  }
  try {
    renameSync(temporary, manifestPath)
  } catch (error) {
    unlinkSync(temporary)
    throw error
  }
  return true
}

function sameDirectory(left, right) {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return false
  }
}

/** 把安装目录里的显示插件接到 Web 配置的 node_modules，供本进程解析包名。 */
export function linkExternalPlugins(profileDir, installNodeModules) {
  if (typeof profileDir !== 'string' || profileDir === '' || typeof installNodeModules !== 'string' || installNodeModules === '') {
    throw new Error('DSH Web 显示插件位置无效')
  }
  const sources = EXTERNAL_PLUGINS.map(plugin => ({ source: join(installNodeModules, plugin.name), name: plugin.name }))
  for (const { source } of sources) {
    let stat
    try {
      stat = statSync(source)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('DSH Web 显示插件未安装')
      throw error
    }
    if (!stat.isDirectory()) throw new Error('DSH Web 显示插件未安装')
  }
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  for (const { source, name } of sources) {
    const dest = join(profileDir, 'node_modules', name)
    mkdirSync(dirname(dest), { recursive: true })
    let existing
    try {
      existing = lstatSync(dest)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (existing?.isSymbolicLink()) {
      if (sameDirectory(dest, source)) continue
      unlinkSync(dest)
    } else if (existing !== undefined) {
      throw new Error('DSH Web 显示插件位置已被占用')
    }
    symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir')
  }
  return true
}
