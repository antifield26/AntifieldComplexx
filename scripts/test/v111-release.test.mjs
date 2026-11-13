/** 发布与密钥包夹具使用临时数据库和假工作树，不访问 Pi。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import test from 'node:test'
import { GoalStore } from '../../apps/mcbot/src/goals/store.ts'
import { captureMcbotState, verifyMcbotState } from '../backup-mcbot-state.mjs'
import { detectRuntime, requireSameSchema, validateSnapshot } from '../deploy-state.mjs'
import { stageRelease, verifyRelease } from '../release-files.mjs'

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'antifield-release-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('校验快照拒绝坏源，同 schema 检查保留 WAL 中的部署后写入', async (t) => {
  const dir = temporary(t)
  const file = join(dir, 'db.sqlite')
  const db = new DatabaseSync(file)
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES ('schema_version','20'); CREATE TABLE changes(message TEXT);")
    const snapshot = join(dir, 'snapshot.sqlite')
    await backup(db, snapshot)
    const sha = createHash('sha256').update(readFileSync(snapshot)).digest('hex')
    assert.equal(await validateSnapshot(snapshot, sha), 20)
    db.exec("INSERT INTO changes VALUES ('部署后写入')")
    assert.equal(requireSameSchema(file, 20), 20)
    assert.throws(() => requireSameSchema(file, 19), /cross_schema_requires_maintenance/)
    assert.equal(db.prepare('SELECT message FROM changes').get().message, '部署后写入')
    assert.equal(existsSync(file + '-wal'), true)
    writeFileSync(snapshot, '损坏的快照')
    await assert.rejects(validateSnapshot(snapshot, sha), /snapshot_hash_mismatch/)
  } finally {
    db.close()
  }
})

test('生产配置决定运行时，拒绝不一致的 DSH 配置', () => {
  const dsh = { DSH_WEB_URL: 'http://127.0.0.1:4700', DSH_WEB_SSO_SOCKET: '/run/dsh/broker.sock', DSH_QQ_MANAGED: 'true' }
  assert.equal(detectRuntime({}), 'opencode')
  assert.equal(detectRuntime(dsh), 'dsh')
  assert.throws(() => detectRuntime({ ...dsh, DSH_WEB_SSO_SOCKET: '' }), /conflicting_agent_config/)
  assert.throws(() => detectRuntime({ ...dsh, DSH_QQ_MANAGED: 'false' }), /conflicting_agent_config/)
  assert.equal(detectRuntime({ ...dsh, CHATBOT_ENABLED: 'true' }), 'dsh')
})

test('密钥包快照含 WAL 目标，隔离恢复暂停运行中目标并验证 JSON 副本', async (t) => {
  const dir = temporary(t)
  const source = join(dir, 'goals.db')
  const task = join(dir, 'task-state.json')
  const memory = join(dir, 'world-memory.json')
  const store = new GoalStore(source)
  store.init()
  try {
    const goal = store.create('owner', '回家', [{ kind: 'home' }])
    store.atomic(() => {
      store.update(goal.id, { status: 'running' })
      store.updateStep(goal.id, 0, { status: 'running' })
    })
    const now = Date.now()
    writeFileSync(task, JSON.stringify({ version: 2, active: {
      taskId: 'queued-to-resume', name: 'fishing', startedAt: now, deadline: now + 1000,
      progress: { fishCaught: 0, wheatHarvested: 0, planted: 0, deposited: 0 }, failures: 0, savedAt: now
    }, queue: [], savedAt: now }))
    writeFileSync(memory, JSON.stringify({ version: 1, items: [
      { category: 'resource', key: 'forest-01', text: '1,64,1', updatedAt: new Date(now).toISOString() }
    ] }))
    const directory = join(dir, 'capture')
    const files = await captureMcbotState(directory, { 'goals.db': source, 'task-state.json': task, 'world-memory.json': memory })
    assert.deepEqual(Object.values(files).map(file => file.status), ['included', 'included', 'included', 'not_created', 'not_created'])
    assert.equal(existsSync(join(directory, 'goals.db-wal')), false)
    assert.equal(existsSync(join(directory, 'goals.db-shm')), false)
    const repo = resolve(import.meta.dirname, '../..')
    const current = process.platform === 'win32' ? repo : join(dir, 'current')
    if (current !== repo) symlinkSync(repo, current, 'dir')
    const result = execFileSync(process.execPath, [join(current, 'scripts/backup-mcbot-state.mjs'), 'verify', directory], { encoding: 'utf8' })
    assert.equal(JSON.parse(result).pendingTask, true)
    assert.deepEqual(await verifyMcbotState(directory, { restore: true }),
      { goals: 1, running: 1, pendingTask: true, queuedTasks: 0, worldMemoryItems: 1 })
    assert.equal(store.get(goal.id).status, 'running')
    const restored = new GoalStore(join(directory, 'goals.db'))
    try {
      restored.init()
      assert.equal(restored.get(goal.id).status, 'paused')
      assert.equal(restored.get(goal.id).steps[0].status, 'pending')
    } finally {
      restored.close()
    }
    writeFileSync(task, '{')
    const broken = await captureMcbotState(join(dir, 'broken'), {
      'goals.db': join(dir, 'absent.db'), 'task-state.json': task, 'world-memory.json': join(dir, 'absent.json')
    })
    assert.deepEqual(Object.values(broken).map(file => file.status), ['read_failed', 'read_failed', 'not_created', 'not_created', 'not_created'])
  } finally {
    store.close()
  }
})

test('发布包隔离 DSH 已安装依赖，校验拒绝额外文件和同长度损坏', (t) => {
  const dir = temporary(t)
  const root = join(dir, 'repo')
  mkdirSync(root)
  execFileSync('git', ['init', '--quiet', root])
  const version = '1.1.1'
  const files = {
    '.gitignore': 'node_modules/\napps/workbench/web/dist/\n',
    'package.json': JSON.stringify({ version }),
    'package-lock.json': JSON.stringify({ version, packages: { '': { version }, 'apps/workbench': { version } } }),
    'apps/workbench/package.json': JSON.stringify({ version }),
    'apps/workbench/server/src/main.ts': 'app',
    'apps/workbench/web/dist/index.html': '<html>',
    'apps/mcbot/src/tasks/store.ts': '',
    'apps/mcbot/src/goals/store.ts': '',
    'apps/mcbot/src/autonomy/world-memory.ts': '',
    'README.md': '', 'AGENTS.md': '', 'CHANGELOG.md': '', LICENSE: '',
    'scripts/release-files.mjs': '', 'scripts/deploy-state.mjs': '', 'scripts/backup-mcbot-state.mjs': '',
    'deploy/tool-versions.json': '{}', 'deploy/dsh/package-lock.json': '{}',
    'deploy/dsh/node_modules/installed/index.js': 'ignored'
  }
  for (const [name, value] of Object.entries(files)) {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
  }
  const staged = join(dir, 'staged')
  stageRelease('workbench', root, staged, version)
  assert.equal(existsSync(join(staged, 'deploy/dsh/node_modules')), false)
  verifyRelease('workbench', staged, version)
  writeFileSync(join(staged, 'apps/workbench/server/src/main.ts'), 'bad')
  assert.throws(() => verifyRelease('workbench', staged, version), /invalid_release_file/)
  writeFileSync(join(staged, 'extra'), '')
  assert.throws(() => verifyRelease('workbench', staged, version), /invalid_release_manifest/)
})

test('密钥包收录维度侧文件，历史清单缺字段仅在文件未产生时兼容', async t => {
  const dir = temporary(t)
  const source = join(dir, 'goals.db')
  const store = new GoalStore(source)
  store.init()
  store.close()
  const nether = join(dir, 'world-memory.nether.json')
  const raw = JSON.stringify({ version: 1, items: [{ category: 'resource', key: 'coal', text: 'coal 1,64,1', updatedAt: new Date().toISOString() }] })
  writeFileSync(nether, raw)
  const directory = join(dir, 'capture')
  const files = await captureMcbotState(directory, { 'goals.db': source, 'task-state.json': join(dir, 'absent-task'), 'world-memory.json': join(dir, 'world-memory.json') })
  assert.equal(files['world-memory.nether.json'].status, 'included')
  assert.equal(files['world-memory.end.json'].status, 'not_created')
  assert.deepEqual((await verifyMcbotState(directory)).dimensionMemoryItems, { 'world-memory.nether.json': 1 })
  const manifestFile = join(directory, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  delete manifest.files['world-memory.end.json']
  writeFileSync(manifestFile, JSON.stringify(manifest))
  await verifyMcbotState(directory)
  writeFileSync(join(directory, 'world-memory.end.json'), raw)
  await assert.rejects(verifyMcbotState(directory), /invalid_mcbot_archive_entry/)
  rmSync(join(directory, 'world-memory.end.json'))
  writeFileSync(join(directory, 'world-memory.nether.json'), raw.replace('coal', 'iron'))
  await assert.rejects(verifyMcbotState(directory), /invalid_mcbot_archive_entry/)
})
