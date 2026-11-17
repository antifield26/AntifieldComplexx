/** 使用隔离源码树核对指令漏载、失效引用和预算诊断，不执行文档命令或连接生产。 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { test } from 'node:test'
import { checkAgentInstructions, INSTRUCTION_LIMITS } from '../check-agent-instructions.mjs'

function fixture(t, content = {}) {
  const root = mkdtempSync(join(tmpdir(), 'antifield-agents-'))
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    rmSync(root, { recursive: true, force: true })
  })
  const files = { 'package.json': JSON.stringify({ scripts: { check: 'node check.mjs' } }), 'AGENTS.md': '# 根规则\n', ...content }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

const has = (result, code) => result.errors.some((error) => error.code === code)

test('有效导航与字面命令通过，CLI 只读且可从夹具根运行', (t) => {
  const root = fixture(t, {
    'AGENTS.md': '# 根规则\n[局部](apps/AGENTS.md)\n运行 `npm run check`、`node scripts/check.mjs`。',
    'apps/AGENTS.md': '[根](../AGENTS.md)\n[接口](../docs/API.md)',
    'docs/API.md': '# 接口',
    'scripts/check.mjs': 'throw new Error("不得执行")',
    '.local/AGENTS.md': '[坏链接](missing.md)',
    'node_modules/AGENTS.md': 'npm run missing',
  })
  const before = readFileSync(join(root, 'AGENTS.md'), 'utf8')
  const result = checkAgentInstructions(root)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.files.length, 2)
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../check-agent-instructions.mjs', import.meta.url))], { cwd: root, encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /检查通过/)
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), before)
})

test('UTF-8 字节预算阻止中文文件因字符计数过小而通过', (t) => {
  const root = fixture(t, { 'AGENTS.md': '规'.repeat(Math.floor(INSTRUCTION_LIMITS.root / 3) + 1) })
  const result = checkAgentInstructions(root)
  assert.equal(result.ok, false)
  assert.ok(has(result, 'file_budget_exceeded'))
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../check-agent-instructions.mjs', import.meta.url))], { cwd: root, encoding: 'utf8' })
  assert.equal(cli.status, 1)
  assert.equal(JSON.parse(cli.stderr).errors[0].code, 'file_budget_exceeded')
})

test('局部文件单独限制 8 KiB', (t) => {
  const root = fixture(t, {
    'AGENTS.md': '[局部](apps/AGENTS.md)',
    'apps/AGENTS.md': 'x'.repeat(INSTRUCTION_LIMITS.local + 1),
  })
  assert.ok(has(checkAgentInstructions(root), 'file_budget_exceeded'))
})

test('按祖先链累计预算，兄弟目录互不叠加', (t) => {
  const root = fixture(t, {
    'AGENTS.md': '[甲](a/AGENTS.md)[乙](b/AGENTS.md)[丙](a/c/AGENTS.md)\n' + 'x'.repeat(11500),
    'a/AGENTS.md': 'x'.repeat(7000),
    'b/AGENTS.md': 'x'.repeat(7000),
    'a/c/AGENTS.md': 'x'.repeat(7000),
  })
  const result = checkAgentInstructions(root)
  assert.equal(has(result, 'file_budget_exceeded'), false)
  assert.deepEqual(result.errors.filter((error) => error.code === 'chain_budget_exceeded').map((error) => error.file), ['a/c/AGENTS.md'])
})

test('override 替代同目录基础指令，避免重复累计', (t) => {
  const root = fixture(t, {
    'AGENTS.md': '[甲](a/AGENTS.md)[覆盖](a/AGENTS.override.md)[丙](a/c/AGENTS.md)\n' + 'x'.repeat(11500),
    'a/AGENTS.md': 'x'.repeat(7000),
    'a/AGENTS.override.md': '# 覆盖规则',
    'a/c/AGENTS.md': 'x'.repeat(7000),
  })
  assert.equal(checkAgentInstructions(root).ok, true)
})

test('失效链接、越界链接和畸形编码均失败，外部链接不发请求', (t) => {
  const root = fixture(t, { 'AGENTS.md': '[缺失](gone.md)[越界](../outside.md)[编码](%ZZ.md)[外部](https://invalid.example/test)[锚点](#规则)' })
  const result = checkAgentInstructions(root)
  assert.ok(has(result, 'link_missing'))
  assert.equal(result.errors.filter((error) => error.code === 'link_invalid').length, 2)
})

test('失效 npm script 和 Node 入口返回明确诊断', (t) => {
  const root = fixture(t, { 'AGENTS.md': '`npm run removed`、`node scripts/removed.mjs`' })
  const result = checkAgentInstructions(root)
  assert.ok(has(result, 'npm_script_missing'))
  assert.ok(has(result, 'node_entry_missing'))
})

test('局部指令未进入根导航时失败', (t) => {
  const root = fixture(t, { 'apps/AGENTS.md': '# 孤立规则' })
  assert.ok(has(checkAgentInstructions(root), 'navigation_missing'))
})

test('缺失根指令、空指令和无效 manifest 不能静默通过', (t) => {
  const root = fixture(t, { 'package.json': '{', 'AGENTS.md': '  ' })
  const result = checkAgentInstructions(root)
  assert.ok(has(result, 'package_invalid'))
  assert.ok(has(result, 'instructions_empty'))
  rmSync(join(root, 'AGENTS.md'))
  assert.ok(has(checkAgentInstructions(root), 'root_missing'))
})
