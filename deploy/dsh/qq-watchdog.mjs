/** QQ 连接监督：启动或断连持续 90 秒未就绪即结束子进程，交给 systemd 重启；只报告固定诊断。 */
export function createQqWatchdog(child, publish, {
  timeoutMs = 90_000,
  graceMs = 5_000,
  report = () => {},
  timers = { setTimeout, clearTimeout },
} = {}) {
  let ready = false
  let closing = false
  let terminated = false
  let deadline
  let forced

  function clearDeadline() {
    if (deadline !== undefined) timers.clearTimeout(deadline)
    deadline = undefined
  }
  function terminate() {
    if (closing || terminated) return
    terminated = true
    ready = false
    clearDeadline()
    publish(false)
    child.kill('SIGTERM')
    if (!closing) {
      forced = timers.setTimeout(() => { if (!closing) child.kill('SIGKILL') }, graceMs)
      forced?.unref?.()
    }
  }
  function arm() {
    if (closing || terminated || deadline !== undefined) return
    deadline = timers.setTimeout(() => {
      deadline = undefined
      if (closing || ready) return
      report('DSH QQ 网关连接超时，等待服务重启')
      terminate()
    }, timeoutMs)
    deadline?.unref?.()
  }
  arm()
  return {
    get ready() { return ready },
    status(value) {
      if (closing || terminated) return
      ready = value === true
      publish(ready)
      if (ready) clearDeadline()
      else arm()
    },
    stop: terminate,
    close() {
      closing = true
      ready = false
      clearDeadline()
      if (forced !== undefined) timers.clearTimeout(forced)
      forced = undefined
    },
  }
}
