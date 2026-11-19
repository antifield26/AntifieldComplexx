/** 主站专用的 QQ 绑定窗口。凭据只从当前表单单次提交，不持久化。 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { readQqBinding, updateQqBinding, type QqBindingStatus } from '../api/client'
import { usePageTitle } from '../hooks/usePageTitle'
import { isNativeRuntime } from '../lib/native'

const labels = { unbound: '未绑定', connecting: '正在连接', ready: '已绑定，网关在线', switching: '正在切换网关…' }
const errors: Record<string, string> = {
  qr_failed: '未能生成或完成扫码，请重新发起绑定。',
  binding_switch_failed: '新绑定未生效，已尝试恢复上一次配置。',
  binding_rollback_failed: '新绑定未生效，旧网关也未能连接，请检查 QQ 服务。',
}

function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  form.querySelectorAll<HTMLInputElement>('input[type="password"], input[name="totpCode"]').forEach(input => { input.value = '' })
  return (name: string) => String(data.get(name) ?? '')
}

export function QqBinding() {
  usePageTitle('QQ 机器人')
  const native = isNativeRuntime()
  const [state, setState] = useState<QqBindingStatus | null>(null)
  const [kind, setKind] = useState<'qr' | 'manual' | 'unbind'>('qr')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const acting = useRef(false)
  const operation = state?.operation
  const pending = operation?.phase === 'waiting' || operation?.phase === 'confirm'

  useEffect(() => {
    if (native || busy) return
    const stop = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const result = await readQqBinding(stop.signal)
        if (!stop.signal.aborted) setState(result)
      } catch (failure) {
        if (!stop.signal.aborted) setError(failure instanceof Error ? failure.message : '无法取得 QQ 服务状态')
      }
      if (!stop.signal.aborted) timer = setTimeout(read, 2000)
    }
    void read()
    return () => { stop.abort(); clearTimeout(timer) }
  }, [native, busy])

  async function send(input: Record<string, unknown>) {
    if (acting.current) return
    acting.current = true
    setBusy(true)
    setError('')
    try { setState(await updateQqBinding(input)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '绑定操作失败') }
    finally { acting.current = false; setBusy(false) }
  }

  return (
    <section className="settings-page">
      <Link to="/settings">返回设置</Link>
      <h1>QQ 机器人</h1>
      {native ? <p>请在系统浏览器打开主站中的「QQ 机器人」页面。</p> : <>
        <p role="status">{state ? labels[state.phase] : '正在读取 QQ 服务状态…'}{state?.appIdHint ? `（AppID 尾号 ${state.appIdHint}）` : ''}</p>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        {operation?.error ? <p className="field-error" role="alert">{errors[operation.error]}</p> : null}
        {operation?.phase === 'complete' ? <p role="status">绑定操作已完成。</p> : null}
        {state && !pending && state.phase !== 'switching' ? (
          <form className="card card-body" onSubmit={(event) => {
            const read = values(event)
            void send({ action: 'start', kind, password: read('password'), totpCode: read('totpCode'),
              ...(kind === 'manual' ? { appId: read('appId').trim(), appSecret: read('appSecret') } : {}) })
          }}>
            <fieldset className="settings-form" disabled={busy}>
              <legend>选择操作</legend>
              <label>绑定方式 <select value={kind} onChange={event => {
                const value = event.target.value
                if (value === 'qr' || value === 'manual' || value === 'unbind') setKind(value)
              }}>
                <option value="qr">扫码绑定或更换</option>
                <option value="manual">手动绑定或更换</option>
                {state.bound ? <option value="unbind">解绑</option> : null}
              </select></label>
              {kind === 'manual' ? <>
                <label>AppID <input name="appId" required maxLength={128} /></label>
                <label>AppSecret <input name="appSecret" type="password" autoComplete="off" required maxLength={512} /></label>
              </> : null}
              <label>主站密码 <input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
              <label>TOTP 验证码 <input name="totpCode" inputMode="numeric" autoComplete="one-time-code" required maxLength={16} /></label>
              <button type="submit" className="btn btn-primary btn-md">继续</button>
            </fieldset>
          </form>
        ) : null}
        {operation?.phase === 'waiting' ? (
          <div className="card card-body">
            {operation.qr ? <img src={operation.qr} alt="QQ 机器人绑定二维码" width={256} height={256} /> : <p>正在生成二维码…</p>}
            <p>请用手机 QQ 扫码，完成后在这里确认绑定。</p>
            <button className="btn btn-secondary btn-md" disabled={busy} onClick={() => void send({ action: 'refresh', id: operation.id })}>刷新二维码</button>
          </div>
        ) : null}
        {operation?.phase === 'confirm' && state?.phase !== 'switching' ? (
          <form className="card card-body" onSubmit={event => {
            const read = values(event)
            const list = (name: string) => read(name).split(/[\s,，]+/).filter(Boolean)
            void send({ action: 'confirm', id: operation.id, direct: list('direct'), groups: list('groups') })
          }}>
            <fieldset className="settings-form" disabled={busy}>
              <legend>{operation.appIdHint ? `确认绑定 AppID 尾号 ${operation.appIdHint}` : '确认解绑并停止 QQ 网关'}</legend>
              {operation.needsAllowlist ? <>
                <p>新 AppID 需要分别填写其私聊和群 OpenID，每行一个。</p>
                <label>私聊白名单 <textarea name="direct" required /></label>
                <label>群白名单 <textarea name="groups" required /></label>
              </> : null}
              <button type="submit" className="btn btn-primary btn-md">确认</button>
            </fieldset>
          </form>
        ) : null}
        {pending && state?.phase !== 'switching' ? <button className="btn btn-secondary btn-md" disabled={busy} onClick={() => {
          void send({ action: 'cancel', id: operation?.id })
        }}>取消绑定操作</button> : null}
      </>}
    </section>
  )
}
