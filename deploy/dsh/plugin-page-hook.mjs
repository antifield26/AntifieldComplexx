/**
 * 阻止从插件页停用或卸载 QQ 与 Minecraft Bot 的显示条目。
 * 这两个条目不承载插件管理器，停用它们也不会停止对应的 Agent。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let packageNames = []

/** 接收 Web 进程传入的包名。只接受本部署的显示插件。 */
export function initialize(data) {
  if (!Array.isArray(data) || data.length === 0 || data.some(name => typeof name !== 'string' || !/^@antifield\/dsh-[a-z-]+$/.test(name))) {
    throw new Error('插件页保护名单无效')
  }
  packageNames = data
}

/** 给插件管理器补上外部插件的停用保护。已套用的源码保持不变。 */
export function pluginManagerGuard(source, names = packageNames) {
  if (source.includes('__antifieldExternalPlugins')) return source
  if (!source.includes('PluginManager.prototype.protectsManager = function')
    && !source.includes('protectsManager(name)')) {
    throw new Error('插件页保护无法套用')
  }
  const list = JSON.stringify(names)
  return `${source}\nconst __antifieldExternalPlugins = new Set(${list});\nconst __antifieldProtectsManager = PluginManager.prototype.protectsManager;\nPluginManager.prototype.protectsManager = function (name) {\n  return __antifieldExternalPlugins.has(name) || __antifieldProtectsManager.call(this, name);\n};\n`
}

function sourceText(source, url) {
  if (typeof source === 'string') return source
  if (source != null) return new TextDecoder().decode(source)
  return readFileSync(fileURLToPath(url), 'utf8')
}

/** 只改写插件管理器模块。 */
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context)
  if (!url.endsWith('/@deepseek-ai/dsh-plugin-manager/lib/index.js') || loaded?.format !== 'module') {
    return loaded
  }
  return { ...loaded, shortCircuit: true, source: pluginManagerGuard(sourceText(loaded.source, url)) }
}
