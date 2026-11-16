/** 会话：一句输入，以及 GET /api/mcbot/chat 的 steps 时间线。
 * 只展示用户话、助手正文、工具名与成败、goal/todo 的动作和标题。
 * 不展示工具参数、结果正文、token 或提示词。进行中 1 秒轮询，空闲 5 秒。
 * 急停后的时间线以后续 chat 响应为准，不在本地另造一份。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { api, isAbortError, toErrorMessage } from '../../api/client'
import type { McbotChatStep, McbotChatTurn } from '../../api/types'
import { Button } from '../Button'
import { Card } from '../Card'
import { usePolling } from '../../hooks/usePolling'

const MAX_CHARS = 2000

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 只保留五类步骤的展示字段。 */
function readChatSteps(value: unknown): McbotChatStep[] {
  if (!Array.isArray(value)) return []
  const steps: McbotChatStep[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const kind = record.kind
    if (kind === 'user' || kind === 'assistant') {
      const text = asText(record.text)
      if (text === null) continue
      steps.push({ kind, text })
    } else if (kind === 'tool') {
      const name = asText(record.name)
      if (name === null || (record.status !== 'ok' && record.status !== 'error')) continue
      steps.push({ kind: 'tool', name, status: record.status })
    } else if (kind === 'goal' || kind === 'todo') {
      const action = asText(record.action)
      const title = asText(record.title)
      if (action === null || title === null) continue
      steps.push({ kind, action, title })
    }
  }
  return steps
}

function turnLabel(turn: McbotChatTurn | null): string | null {
  if (!turn || turn.status === 'ok') return null
  if (turn.status === 'pending') return '正在根据这句话决定是否行动。'
  if (turn.error === 'chat_busy' || turn.error === 'admin_busy') return '上一轮还在进行，请稍后再发。'
  if (turn.error === 'admin_unavailable') return '管理员对话暂不可用。'
  return '这一轮没有完成。'
}

function StepLine({ step }: { step: McbotChatStep }) {
  if (step.kind === 'user') {
    return (
      <p className="mcbot-chat-user">
        <span>你</span>
        {step.text}
      </p>
    )
  }
  if (step.kind === 'assistant') {
    return (
      <p className="mcbot-chat-assistant">
        <span>助手</span>
        {step.text}
      </p>
    )
  }
  if (step.kind === 'tool') {
    return (
      <p className="mcbot-chat-assistant">
        <span>工具</span>
        {`${step.name} · ${step.status === 'ok' ? '成功' : '失败'}`}
      </p>
    )
  }
  return (
    <p className="mcbot-chat-assistant">
      <span>{step.kind === 'goal' ? '目标' : '待办'}</span>
      {`${step.action} · ${step.title}`}
    </p>
  )
}

export function McbotChatCard({
  controlReady,
  reloadToken,
}: {
  controlReady: boolean
  reloadToken: number
}) {
  const [steps, setSteps] = useState<McbotChatStep[]>([])
  const [turn, setTurn] = useState<McbotChatTurn | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const requestIdRef = useRef(0)
  const logRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    try {
      const state = await api.mcbot.chatState(signal)
      if (signal?.aborted || requestId !== requestIdRef.current) return
      setSteps(readChatSteps(state.steps))
      setTurn(state.turn ?? null)
    } catch (failure) {
      if (signal?.aborted || isAbortError(failure)) return
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadToken])

  usePolling(() => load(), turn?.status === 'pending' ? 1000 : 5000, controlReady)

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [steps, turn?.status])

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault()
    const message = text.trim()
    if (!controlReady || sending || turn?.status === 'pending') return
    if (!message) {
      setError('请输入要说的话')
      return
    }
    if (hasControlChars(message)) {
      setError('内容不能包含控制字符')
      return
    }
    if (message.length > MAX_CHARS) {
      setError(`最多 ${MAX_CHARS} 个字符`)
      return
    }
    setError(null)
    setSending(true)
    try {
      await api.mcbot.chat(message)
      setText('')
      await load()
    } catch (failure) {
      setError(toErrorMessage(failure, '发送失败'))
    } finally {
      setSending(false)
    }
  }

  const pending = turn?.status === 'pending'
  const hint = turnLabel(turn)

  return (
    <Card
      title="会话"
      description="用一句话说明要做什么。时间线只显示这句话、助手回复、工具成败，以及目标或待办的动作和标题。"
    >
      <div className="mcbot-chat-log" ref={logRef} role="log" aria-live="polite" aria-label="会话时间线">
        {steps.length === 0 ? <p className="mcbot-muted">还没有会话。</p> : null}
        {steps.map((step, index) => (
          <StepLine key={`${step.kind}-${index}`} step={step} />
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <form className="mcbot-say-form" onSubmit={(event) => { void send(event) }}>
        <textarea
          className="mcbot-say-input"
          value={text}
          maxLength={MAX_CHARS}
          rows={3}
          placeholder="例如：去附近砍点木头，然后存箱回家"
          aria-label="会话内容"
          disabled={!controlReady || sending || pending}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
        />
        <div className="mcbot-say-footer">
          <span className="field-hint">{text.trim().length}/{MAX_CHARS}</span>
          <Button
            type="submit"
            variant="primary"
            icon={<Send size={16} aria-hidden="true" />}
            disabled={!controlReady || sending || pending || text.trim().length === 0}
            loading={sending}
          >
            发送
          </Button>
        </div>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </form>
    </Card>
  )
}
