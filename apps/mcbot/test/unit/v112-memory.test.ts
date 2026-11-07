import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { AuditEntry, AuditLogger } from '../../src/audit.ts'
import type { AutonomySessionClient } from '../../src/ai/session.ts'
import { AutonomyService } from '../../src/autonomy/service.ts'
import {
  formatWorldMemoryIndex,
  WORLD_MEMORY_MAX_ITEMS,
  WorldMemoryError,
  WorldMemoryStore
} from '../../src/autonomy/world-memory.ts'
import { EventBus } from '../../src/events/bus.ts'
import type { ChatSender } from '../../src/minecraft/chat.ts'
import type { MovementManager } from '../../src/minecraft/movement.ts'
import type { TaskController } from '../../src/tasks/types.ts'
import { createLogger } from '../../src/logger.ts'
import { baseEnv, makeConfig, makeState, removeDir, tempDir } from '../helpers.ts'

const SECRET = '秘密麦田在南边第二块'

async function memoryFile (): Promise<{ dir: string, file: string }> {
  const dir = await tempDir('mcbot-world-memory-')
  return { dir, file: path.join(dir, 'world-memory.json') }
}

async function rejection (run: () => unknown, code: string): Promise<void> {
  await assert.rejects(async () => { await run() }, (error: unknown) => {
    assert.ok(error instanceof WorldMemoryError)
    assert.equal(error.code, code)
    return true
  })
}

test('world memory rejects closed-set violations and does not create a file', async () => {
  const { dir, file } = await memoryFile()
  try {
    const store = new WorldMemoryStore(file, createLogger('error'))
    await rejection(() => store.write('biome', 'plains', '平坦'), 'memory_category_invalid')
    await rejection(() => store.write('note', '   ', '空白'), 'memory_key_invalid')
    await rejection(() => store.write('note', 'k'.repeat(65), '太长'), 'memory_key_invalid')
    await rejection(() => store.write('note', 'bad', ''), 'memory_text_invalid')
    await rejection(() => store.write('note', 'bad', 'x'.repeat(241)), 'memory_text_invalid')
    await rejection(() => store.write('note', 'bad', '第一行\n第二行'), 'memory_text_invalid')
    await rejection(() => store.read(undefined, 'orphan'), 'memory_key_needs_category')
    assert.equal(store.index().counts.note, 0)
    await assert.rejects(() => stat(file))
  } finally {
    await removeDir(dir)
  }
})

test('world memory upserts, caps, restarts, and quarantines corrupt files', async () => {
  const { dir, file } = await memoryFile()
  try {
    const store = new WorldMemoryStore(file, createLogger('error'))
    const created = await store.write('food', 'wheat', SECRET)
    assert.equal(created.updated, false)
    const again = await store.write('food', 'wheat', '仍是麦田')
    assert.equal(again.updated, true)
    await store.write('place', 'wheat', '同名不同类')
    assert.equal(store.index().counts.food, 1)
    assert.equal(store.index().counts.place, 1)
    assert.equal(store.read('food', 'wheat')[0]?.text, '仍是麦田')
    const indexed = formatWorldMemoryIndex(store.index())
    assert.match(indexed, /food 1/)
    assert.match(indexed, /food:wheat/)
    assert.equal(indexed.includes(SECRET), false)
    assert.equal(indexed.includes('仍是麦田'), false)

    for (let i = 0; i < WORLD_MEMORY_MAX_ITEMS - 2; i += 1) {
      await store.write('note', `n${i}`, '记')
    }
    assert.equal(WORLD_MEMORY_CATEGORIES_TOTAL(store), WORLD_MEMORY_MAX_ITEMS)
    await rejection(() => store.write('note', 'overflow', '放不下'), 'memory_full')
    const moved = await store.write('note', 'n0', '挪到最新')
    assert.equal(moved.updated, true)
    assert.equal(store.index().recentKeys[0]?.key, 'n0')
    assert.equal(store.index().recentKeys.length, 8)
    assert.equal(store.index().recentKeys.some(item => item.key === 'n190'), false)
    assert.equal(store.index().recentKeys.some(item => item.key === 'n191'), true)

    const reloaded = new WorldMemoryStore(file, createLogger('error'))
    assert.equal(reloaded.read('food', 'wheat')[0]?.text, '仍是麦田')
    assert.equal(reloaded.read('place', 'wheat')[0]?.text, '同名不同类')
    if (process.platform !== 'win32') {
      assert.equal((await stat(file)).mode & 0o777, 0o600)
    }
    await reloaded.forget('food', 'wheat')
    await rejection(() => reloaded.forget('food', 'wheat'), 'memory_not_found')
    const afterForget = new WorldMemoryStore(file, createLogger('error'))
    await rejection(() => Promise.resolve().then(() => afterForget.read('food', 'wheat')), 'memory_not_found')

    writeFileSync(file, '{')
    const quarantined = new WorldMemoryStore(file, createLogger('error'))
    assert.equal(WORLD_MEMORY_CATEGORIES_TOTAL(quarantined), 0)
    const names = await readdir(dir)
    assert.equal(names.some(name => name.includes('.corrupt-')), true)
    const saved = await quarantined.write('danger', 'edge', '家南边有怪')
    assert.equal(saved.updated, false)
    assert.equal(new WorldMemoryStore(file, createLogger('error')).read('danger', 'edge')[0]?.text, '家南边有怪')
  } finally {
    await removeDir(dir)
  }
})

test('oversized world memory is quarantined instead of parsed', async () => {
  const { dir, file } = await memoryFile()
  try {
    writeFileSync(file, 'x'.repeat(128 * 1024 + 1))
    const store = new WorldMemoryStore(file, createLogger('error'))
    assert.equal(WORLD_MEMORY_CATEGORIES_TOTAL(store), 0)
    const names = await readdir(dir)
    assert.equal(names.some(name => name.includes('.corrupt-')), true)
  } finally {
    await removeDir(dir)
  }
})

interface ToolJson {
  ok?: boolean
  error?: string
  items?: Array<{ category: string, key: string, text: string }>
  environment?: { blocks?: Array<{ name: string }> }
  category?: string
  key?: string
  updated?: boolean
}

function serviceFor (
  store: WorldMemoryStore,
  env: Record<string, string | undefined> = {}
): {
  service: AutonomyService
  prompts: string[]
  started: string[]
  audit: AuditEntry[]
} {
  const config = makeConfig({}, {
    ...baseEnv(),
    AI_ENABLED: 'true',
    OPENCODE_PASSWORD: 'test-password',
    AUTONOMY_ENABLED: 'true',
    AUTONOMY_MAX_TOOL_CALLS: '8',
    AUTONOMY_MAX_FAILURES: '5',
    AUTONOMY_MCP_WARMUP_MS: '0',
    AUTONOMY_SCAN_RADIUS: '32',
    AUTONOMY_SCAN_MAX_BLOCKS: '48',
    AUTONOMY_SCAN_BLOCKS: 'chest',
    TASK_ENABLED: 'true',
    HTTP_CONTROL_ENABLED: 'true',
    ...env
  })
  const state = makeState(config)
  const prompts: string[] = []
  const started: string[] = []
  const audit: AuditEntry[] = []
  const session: AutonomySessionClient = {
    registerMcp: async (_name, _url, _bearer) => {},
    removeMcp: async () => {},
    createSession: async () => 'sess-v112',
    prompt: async (_sessionId, text) => { prompts.push(text) },
    wait: async () => await new Promise<void>(() => {}),
    interrupt: async () => {},
    deleteSession: async () => {},
    assistantText: async () => ''
  }
  const bot = {
    entity: { position: new Vec3(180, 64, 440) },
    username: 'lofii',
    health: 17,
    food: 20,
    game: { dimension: 'minecraft:overworld' },
    time: { timeOfDay: 6000 },
    players: { lofii: {} },
    entities: {},
    heldItem: null,
    currentWindow: null,
    inventory: {
      items: () => [{ name: 'bread', count: 1, type: 1 }],
      emptySlotCount: () => 20,
      slots: []
    },
    registry: { blocksByName: { chest: {} }, foodsByName: { bread: {} } },
    findBlocks: () => [new Vec3(190, 64, 440)],
    blockAt: (position: Vec3) => position.x === 190 ? { name: 'chest', position } : null
  } as unknown as Bot
  const service = new AutonomyService({
    config,
    logger: createLogger('error'),
    state,
    audit: { append: (entry: AuditEntry) => { audit.push(entry) } } as unknown as AuditLogger,
    events: new EventBus(20),
    chatSender: { say: async () => ['ok'], isConnected: () => true } as unknown as ChatSender,
    movement: { stop: () => {}, home: async () => {}, goNearPoint: async () => {} } as unknown as MovementManager,
    tasks: {
      start: async (name: string) => {
        started.push(name)
        return { status: 'started' }
      },
      requestStop: () => {},
      stopAndWait: async () => {},
      depositNow: async () => {},
      confirmResume: async () => {},
      discardPending: async () => {},
      snapshot: () => state.task,
      keepOnline: () => false,
      isActive: () => false
    } as unknown as TaskController,
    opencode: session,
    getBot: () => bot,
    worldMemory: store
  })
  return { service, prompts, started, audit }
}

async function startAndCall (
  fixture: ReturnType<typeof serviceFor>,
  name: string,
  args: Record<string, unknown>
): Promise<ToolJson> {
  const started = await fixture.service.start(null, 'Antifield')
  assert.equal(started.ok, true)
  const prompt = fixture.prompts[0] ?? ''
  const runId = /当前 run_id：([0-9a-f-]+)/.exec(prompt)?.[1] ?? ''
  const response = await fixture.service.handleMcpHttp(fixtureToken(fixture), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: { run_id: runId, ...args } }
  })
  assert.equal(response.status, 200)
  const body = response.body as { result?: { content?: Array<{ text: string }> } }
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as ToolJson
}

function fixtureToken (fixture: ReturnType<typeof serviceFor>): string {
  const run = fixture.service as unknown as { run?: { token?: string } }
  return run.run?.token ?? ''
}

test('prompt carries a fresh snapshot and memory index, while observe still scans', async () => {
  const { dir, file } = await memoryFile()
  const store = new WorldMemoryStore(file, createLogger('error'))
  await store.write('food', 'wheat', SECRET)
  const fixture = serviceFor(store)
  try {
    const started = await fixture.service.start(null, 'Antifield')
    assert.equal(started.ok, true)
    const prompt = fixture.prompts[0] ?? ''
    assert.match(prompt, /血量 17/)
    assert.match(prompt, /food 1/)
    assert.match(prompt, /food:wheat/)
    assert.equal(prompt.includes(SECRET), false)
    assert.equal(prompt.includes('附近方块'), false)
    const runId = /当前 run_id：([0-9a-f-]+)/.exec(prompt)?.[1] ?? ''
    const token = fixtureToken(fixture)
    const observed = await call(fixture.service, token, 'observe', { run_id: runId })
    assert.equal(observed.ok, true)
    assert.equal(observed.environment?.blocks?.some(block => block.name === 'chest'), true)
    const saved = await call(fixture.service, token, 'memory_write', {
      run_id: runId,
      category: 'route',
      key: 'home-south',
      text: SECRET,
      reason: '记下路'
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.updated, false)
    const read = await call(fixture.service, token, 'memory_read', { run_id: runId, category: 'route', key: 'home-south' })
    assert.equal(read.items?.[0]?.text, SECRET)
    const removed = await call(fixture.service, token, 'memory_forget', {
      run_id: runId,
      category: 'route',
      key: 'home-south',
      reason: '这条过期了'
    })
    assert.equal(removed.ok, true)
    assert.equal(fixture.started.length, 0)
    assert.equal(fixture.service.snapshot().toolCalls, 4)
    const packed = JSON.stringify(fixture.audit)
    assert.equal(packed.includes(SECRET), false)
    assert.equal(fixture.audit.some(entry => entry.action === 'memory_write' && entry.details?.target === 'route:home-south'), true)
  } finally {
    await fixture.service.stop('test')
    await removeDir(dir)
  }
})

test('memory tools consume the shared budget and reject a missing reason before writing', async () => {
  const { dir, file } = await memoryFile()
  const store = new WorldMemoryStore(file, createLogger('error'))
  const fixture = serviceFor(store, { AUTONOMY_MAX_TOOL_CALLS: '1' })
  try {
    const missing = await startAndCall(fixture, 'memory_write', { category: 'note', key: 'a', text: SECRET })
    assert.equal(missing.ok, false)
    assert.equal(missing.error, 'reason_required')
    assert.equal(fixture.service.snapshot().toolCalls, 0)
    assert.equal(store.read().length, 0)
    const listed = await call(fixture.service, fixtureToken(fixture), 'memory_read', {
      run_id: runIdOf(fixture)
    })
    assert.equal(listed.ok, true)
    assert.equal(listed.items?.length, 0)
    const blocked = await call(fixture.service, fixtureToken(fixture), 'memory_write', {
      run_id: runIdOf(fixture),
      category: 'note',
      key: 'a',
      text: SECRET,
      reason: '再写一次'
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error, 'tool_budget_exhausted')
    assert.equal(store.read().length, 0)
    assert.equal(fixture.started.length, 0)
    assert.equal(JSON.stringify(fixture.audit).includes(SECRET), false)
  } finally {
    await fixture.service.stop('test')
    await removeDir(dir)
  }
})

test('unknown memory category is rejected and does not start a task', async () => {
  const { dir, file } = await memoryFile()
  const fixture = serviceFor(new WorldMemoryStore(file, createLogger('error')))
  try {
    const denied = await startAndCall(fixture, 'memory_write', {
      category: 'biome',
      key: 'plains',
      text: '平坦',
      reason: '试试新分类'
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.error, 'memory_category_invalid')
    assert.equal(fixture.started.length, 0)
    assert.equal(fixture.service.snapshot().toolCalls, 1)
  } finally {
    await fixture.service.stop('test')
    await removeDir(dir)
  }
})

function WORLD_MEMORY_CATEGORIES_TOTAL (store: WorldMemoryStore): number {
  const counts = store.index().counts
  return counts.place + counts.resource + counts.food + counts.danger + counts.route + counts.note
}

function runIdOf (fixture: ReturnType<typeof serviceFor>): string {
  return /当前 run_id：([0-9a-f-]+)/.exec(fixture.prompts[0] ?? '')?.[1] ?? ''
}

async function call (service: AutonomyService, token: string, name: string, args: Record<string, unknown>): Promise<ToolJson> {
  const response = await service.handleMcpHttp(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args }
  })
  assert.equal(response.status, 200)
  const body = response.body as { result?: { content?: Array<{ text: string }> } }
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as ToolJson
}
