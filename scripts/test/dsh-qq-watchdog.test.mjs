/** QQ 监督器用可控时钟验证真实退出边界，不启动平台、模型或生产服务。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createQqWatchdog } from '../../deploy/dsh/qq-watchdog.mjs'

function fixture() {
  let now = 0
  let serial = 0
  const pending = new Map()
  const signals = []
  const states = []
  const diagnostics = []
  const timers = {
    setTimeout(fn, ms) { const id = serial++; pending.set(id, { at: now + ms, fn }); return id },
    clearTimeout(id) { pending.delete(id) },
  }
  const watch = createQqWatchdog({ kill: (signal) => signals.push(signal) }, (ready) => states.push(ready), {
    timers, report: message => diagnostics.push(message),
  })
  function advance(ms) {
    const until = now + ms
    for (;;) {
      const next = [...pending].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > until) break
      now = next[1].at
      pending.delete(next[0])
      next[1].fn()
    }
    now = until
  }
  return { watch, advance, signals, states, diagnostics, pending }
}

test('启动无 ready 有明确期限，退出宽限后强制结束，不接受迟到 ready', () => {
  const f = fixture()
  f.advance(89_999)
  assert.deepEqual(f.signals, [])
  f.advance(1)
  assert.deepEqual(f.signals, ['SIGTERM'])
  assert.deepEqual(f.states, [false])
  assert.equal(f.diagnostics.length, 1)
  f.watch.status(true)
  assert.equal(f.watch.ready, false)
  f.advance(5000)
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL'])
})

test('断连后及时就绪取消重启，重复未就绪事件不能无限延后期限', () => {
  const f = fixture()
  f.watch.status(true)
  f.advance(180_000)
  assert.deepEqual(f.signals, [])
  f.watch.status(false)
  f.advance(80_000)
  f.watch.status(true)
  f.advance(20_000)
  assert.deepEqual(f.signals, [])
  f.watch.status(false)
  f.advance(80_000)
  f.watch.status(false)
  f.advance(10_000)
  assert.deepEqual(f.signals, ['SIGTERM'])
})

test('正常关闭释放所有计时器，停止幂等且子进程收口后不再发信号', () => {
  const f = fixture()
  f.watch.status(true)
  f.watch.stop()
  f.watch.stop()
  assert.deepEqual(f.signals, ['SIGTERM'])
  f.watch.close()
  f.advance(180_000)
  assert.equal(f.pending.size, 0)
  assert.deepEqual(f.signals, ['SIGTERM'])
  const beforeReady = fixture()
  beforeReady.watch.close()
  beforeReady.advance(180_000)
  assert.deepEqual(beforeReady.signals, [])
})

test('不响应 SIGTERM 的实际子进程在宽限后退出', { skip: process.platform === 'win32' && 'Unix 信号语义仅在 Linux 验证' }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); process.stdout.write("started"); setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'ignore'] })
  let watch
  try {
    await once(child.stdout, 'data', { signal: globalThis.AbortSignal.timeout(5000) })
    const closed = once(child, 'close', { signal: globalThis.AbortSignal.timeout(5000) })
    watch = createQqWatchdog(child, () => {}, { timeoutMs: 150, graceMs: 150 })
    const [code, signal] = await closed
    assert.equal(code, null)
    assert.equal(signal, 'SIGKILL')
  } finally {
    watch?.close()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
