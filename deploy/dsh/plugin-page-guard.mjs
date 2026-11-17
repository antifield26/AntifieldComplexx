/**
 * 在 DSH Web 加载插件管理器之前登记停用保护。
 * 保护只覆盖插件页上的两个显示条目。
 */
import { register } from 'node:module'
import { EXTERNAL_PLUGINS } from './external-plugins.mjs'

await register('./plugin-page-hook.mjs', {
  parentURL: import.meta.url,
  data: EXTERNAL_PLUGINS.map(plugin => plugin.name),
})
