/** 核对 DSH Web 插件查询使用固定的系统 pnpm，且模型侧插件管理保持关闭。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

test('DSH Web 插件查询指向固定 pnpm，模型工具保持关闭', () => {
  const installer = readFileSync(join(root, 'deploy/dsh/install-pnpm.sh'), 'utf8')
  const stage = readFileSync(join(root, 'deploy/dsh/stage.sh'), 'utf8')
  const policy = readFileSync(join(root, 'deploy/dsh/web-policy.yml'), 'utf8')
  assert.match(installer, /^npm_version=12\.2\.2$/m)
  assert.match(installer, /^pnpm_version=10\.34\.9$/m)
  assert.match(installer, /^prefix=\/usr\/local$/m)
  assert.match(installer, /\/home\/\*/)
  assert.match(installer, /id -u/)
  assert.match(stage, /bash "\$source_dir\/install-pnpm\.sh"/)
  assert.match(stage, /install-pnpm\.sh/)
  assert.match(policy, /id: tool-plugin-manager\r?\n {2}disabled: true/)
  assert.match(policy, /id: plugin-manager\r?\n {2}config:\r?\n {4}pnpmCommand: \/usr\/local\/bin\/pnpm/)
})
