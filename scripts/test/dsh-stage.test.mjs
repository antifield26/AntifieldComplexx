/** 校验独立 DSH 安装清单覆盖运行时入口及其本地模块依赖。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'

test('DSH 安装清单包含各运行时入口及本地依赖', () => {
  const directory = new URL('../../deploy/dsh/', import.meta.url)
  const stage = readFileSync(new URL('assemble.sh', directory), 'utf8')
  const assetBlock = stage.match(/^assets=\(\s*([\s\S]*?)^\)/m)
  assert.ok(assetBlock, '缺少 DSH 安装清单')
  const assets = new Set(assetBlock[1].trim().split(/\s+/))
  for (const entry of ['web-broker.mjs', 'qq-agent.mjs', 'mcbot-agent.mjs']) {
    assert.ok(assets.has(entry), `安装清单缺少入口 ${entry}`)
  }
  for (const name of assets) {
    if (!name.endsWith('.mjs')) continue
    const source = readFileSync(new URL(name, directory), 'utf8')
    const imports = source.matchAll(/(?:\bfrom\s+|\bimport(?:\s+|\(\s*))["']\.\/([^"']+\.mjs)["']/g)
    for (const [, dependency] of imports) {
      assert.ok(assets.has(dependency), `${name} 的依赖 ${dependency} 缺少安装项`)
    }
  }
})
