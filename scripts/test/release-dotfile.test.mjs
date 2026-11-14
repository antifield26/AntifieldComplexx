/** 发布包只放行说明页的固定 Pages 标记，其余点开头路径仍然拒绝。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { stageRelease } from '../release-files.mjs'

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'antifield-release-dot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fixture(root, extra = {}) {
  const version = '1.2.3'
  const files = {
    '.gitignore': 'node_modules/\napps/workbench/web/dist/\n',
    'package.json': JSON.stringify({ version }),
    'package-lock.json': JSON.stringify({ version, packages: { '': { version }, 'apps/workbench': { version } } }),
    'apps/workbench/package.json': JSON.stringify({ version }),
    'apps/workbench/server/src/main.ts': 'app',
    'apps/workbench/web/dist/index.html': '<html>',
    'apps/workbench/web/dist/.nojekyll': '',
    'apps/mcbot/src/tasks/store.ts': '',
    'apps/mcbot/src/goals/store.ts': '',
    'apps/mcbot/src/autonomy/world-memory.ts': '',
    'README.md': '', 'AGENTS.md': '', 'CHANGELOG.md': '', LICENSE: '',
    'scripts/release-files.mjs': '', 'scripts/deploy-state.mjs': '', 'scripts/backup-mcbot-state.mjs': '',
    'deploy/tool-versions.json': '{}', 'deploy/dsh/package-lock.json': '{}',
    'deploy/backup-info/.nojekyll': '',
    ...extra
  }
  for (const [name, value] of Object.entries(files)) {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
  }
}

test('发布包收录说明页 .nojekyll，并拒绝其他点开头路径', (t) => {
  const dir = temporary(t)
  const root = join(dir, 'repo')
  mkdirSync(root)
  execFileSync('git', ['init', '--quiet', root])
  fixture(root)
  const staged = join(dir, 'staged')
  stageRelease('workbench', root, staged, '1.2.3')
  assert.equal(existsSync(join(staged, 'deploy/backup-info/.nojekyll')), true)
  assert.equal(existsSync(join(staged, 'apps/workbench/web/dist/.nojekyll')), true)
  const manifest = JSON.parse(readFileSync(join(staged, 'release-files.json'), 'utf8'))
  assert.equal(typeof manifest.files['deploy/backup-info/.nojekyll'], 'string')

  const rejected = join(dir, 'rejected')
  mkdirSync(rejected)
  execFileSync('git', ['init', '--quiet', rejected])
  fixture(rejected, { 'deploy/backup-info/.env': 'secret' })
  assert.throws(() => stageRelease('workbench', rejected, join(dir, 'rejected-stage'), '1.2.3'), /invalid_release_path/)
})
