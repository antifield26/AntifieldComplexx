/** 管理员对话。正文只在 mcbot 内存中轮询，急停不经过模型。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { api, isAbortError, toErrorMessage } from '../../api/client'
import type { McbotChatMessage, McbotChatTurn } from '../../api/types'
import { Button } from '../Button'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'
import { usePolling } from '../../hooks/usePolling'

const MAX_CHARS = 2000

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function turnLabel(turn: McbotChatTurn | null): string | null {
  if (!turn || turn.status === 'ok') return null
  if (turn.status === 'pending') return '正在根据这句话决定是否行动。'
  if (turn.error === 'chat_busy' || turn.error === 'admin_busy') return '上一轮还在进行，请稍后再发。'
  if (turn.error === 'admin_unavailable') return '管理员对话暂不可用。'
  return '这一轮没有完成。'
}

export function McbotChatCard({ controlReady }: { controlReady: boolean }) {
  const toast = useToast()
  const [messages, setMessages] = useState<McbotChatMessage[]>([])
  const [turn, setTurn] = useState<McbotChatTurn | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const requestIdRef = useRef(0)
  const logRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    try {
      const state = await api.mcbot.chatState(signal)
      if (signal?.aborted || requestId !== requestIdRef.current) return
      setMessages(state.messages ?? [])
      setTurn(state.turn ?? null)
    } catch (failure) {
      if (signal?.aborted || isAbortError(failure)) return
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  usePolling(() => load(), turn?.status === 'pending' ? 1000 : 5000, controlReady)

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, turn?.status])

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

  async function stop(): Promise<void> {
    if (!controlReady || stopping) return
    setStopping(true)
    try {
      const result = await api.mcbot.emergencyStop()
      if (result.ok) toast.success('已急停')
      else toast.error(`急停未全部完成：${result.failures.join('、') || '未知'}`)
      setConfirmStop(false)
      await load()
    } catch (failure) {
      toast.error(toErrorMessage(failure, '急停失败'))
    } finally {
      setStopping(false)
    }
  }

  const pending = turn?.status === 'pending'
  const hint = turnLabel(turn)

  return (
    <>
      <Card
        title="管理员对话"
        description="用一句话说明要做什么。模型按这句话决定是否使用现有任务和规划工具。"
      >
        <div className="mcbot-chat-log" ref={logRef} role="log" aria-live="polite" aria-label="管理员对话记录">
          {messages.length === 0 ? <p className="mcbot-muted">还没有对话。任务、移动和游戏内聊天都从这里发起。</p> : null}
          {messages.map((message) => (
            <p key={message.id} className={message.role === 'user' ? 'mcbot-chat-user' : 'mcbot-chat-assistant'}>
              <span>{message.role === 'user' ? '你' : 'Bot'}</span>
              {message.text}
            </p>
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
            aria-label="管理员对话"
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
        <div className="mcbot-chat-stop">
          <Button
            variant="danger"
            icon={<Square size={16} aria-hidden="true" />}
            disabled={!controlReady || stopping}
            onClick={() => setConfirmStop(true)}
          >
            急停
          </Button>
          <span className="field-hint">立即停止任务、自主会话和这次对话，不经过模型。</span>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmStop}
        title="急停"
        message="确定停止当前任务、自主会话和管理员对话？"
        details="空闲时也算成功。已经发生的世界动作不会回滚。"
        confirmText="急停"
        tone="danger"
        loading={stopping}
        onConfirm={() => { void stop() }}
        onClose={() => {
          if (!stopping) setConfirmStop(false)
        }}
      />
    </>
  )
}
