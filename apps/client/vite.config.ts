import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// Cloudflare Rocket Loader 会改写 type="module" 并延迟执行；SPA 不需要它。
// data-cfasync="false" 让 Rocket Loader 跳过入口脚本，避免边缘改写导致白屏。
const rocketLoaderOptOut: Plugin = {
  name: 'antifieldcloud-rocket-loader-opt-out',
  enforce: 'post',
  transformIndexHtml(html) {
    return html.replace(/<script type="module"/g, '<script data-cfasync="false" type="module"')
  },
}

// 登录首屏会执行入口及全部静态依赖；动态路由不计入首屏预算，同一 chunk 只计算一次。
const loginEntryBudget: Plugin = {
  name: 'antifield-login-entry-budget',
  apply: 'build',
  generateBundle(_options, bundle) {
    const pending = Object.values(bundle).filter((item) => item.type === 'chunk' && item.isEntry).map((item) => item.fileName)
    const visited = new Set<string>()
    let bytes = 0
    for (const name of pending) {
      if (visited.has(name)) continue
      visited.add(name)
      const item = bundle[name]
      if (!item || item.type !== 'chunk') continue
      bytes += Buffer.byteLength(item.code, 'utf8')
      pending.push(...item.imports)
    }
    if (bytes > 500_000) this.error(`登录入口与静态依赖为 ${bytes} 字节，超过 500000 字节上限`)
    this.info(`登录入口与静态依赖：${bytes} / 500000 字节`)
  },
}

export default defineConfig({
  root,
  plugins: [react(), rocketLoaderOptOut, loginEntryBudget],
  build: {
    // 服务端仍从 apps/workbench/web/dist 托管恢复用界面。
    outDir: '../workbench/web/dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/healthz': 'http://127.0.0.1:3000',
    },
  },
})
