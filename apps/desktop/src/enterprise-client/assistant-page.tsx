import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import {
  connectEnterpriseAgent,
  type EnterpriseAgentMessage,
  type EnterpriseAgentRuntime,
  type EnterpriseAgentSession
} from './agent-runtime'

interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type LoadState = 'error' | 'loading' | 'ready'

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(textFromUnknown).join('')
  }

  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>

    return textFromUnknown(row.text ?? row.content ?? row.output_text ?? row.message)
  }

  return ''
}

function toConversationMessages(messages: EnterpriseAgentMessage[]): ConversationMessage[] {
  return messages.flatMap((message, index) => {
    if (message.role !== 'assistant' && message.role !== 'user') {
      return []
    }

    const text = textFromUnknown(message.text ?? message.content).trim()

    return text ? [{ id: `history-${index}`, role: message.role, text }] : []
  })
}

function sessionLabel(session: EnterpriseAgentSession): string {
  return session.title.trim() || session.preview.trim() || '未命名会话'
}

function sessionTime(seconds: number): string {
  if (!seconds) {
    return '未提供时间'
  }

  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(seconds * 1000))
}

function stateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在连接 Hermes runtime'
  }

  if (state === 'ready') {
    return 'Hermes runtime 已连接'
  }

  return 'Hermes runtime 不可用'
}

export function AssistantPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [runtimeState, setRuntimeState] = useState<LoadState>('loading')
  const [sessions, setSessions] = useState<EnterpriseAgentSession[]>([])
  const [submitting, setSubmitting] = useState(false)
  const activeSessionIdRef = useRef<string | null>(null)
  const runtimeRef = useRef<EnterpriseAgentRuntime | null>(null)

  const refreshSessions = useCallback(async (runtime: EnterpriseAgentRuntime) => {
    const nextSessions = await runtime.listSessions()
    setSessions(nextSessions)
  }, [])

  useEffect(() => {
    let active = true
    let disposeEvents: (() => void) | undefined

    void connectEnterpriseAgent()
      .then(async runtime => {
        if (!active) {
          runtime.close()

          return
        }

        runtimeRef.current = runtime
        disposeEvents = runtime.onEvent(event => {
          if (!active || !event.session_id || event.session_id !== activeSessionIdRef.current) {
            return
          }

          const payload = event.payload as { status?: string; text?: unknown } | undefined

          if (event.type === 'message.delta') {
            const text = textFromUnknown(payload?.text)

            if (!text) {
              return
            }

            setMessages(current => {
              const last = current.at(-1)

              if (last?.role === 'assistant' && last.id === `stream-${event.session_id}`) {
                return [...current.slice(0, -1), { ...last, text: `${last.text}${text}` }]
              }

              return [...current, { id: `stream-${event.session_id}`, role: 'assistant', text }]
            })
          }

          if (event.type === 'message.complete') {
            const text = textFromUnknown(payload?.text)
            setSubmitting(false)
            setMessages(current => {
              const last = current.at(-1)

              if (last?.role === 'assistant' && last.id === `stream-${event.session_id}`) {
                return text ? [...current.slice(0, -1), { ...last, text }] : current.slice(0, -1)
              }

              return text
                ? [...current, { id: `complete-${event.session_id}-${Date.now()}`, role: 'assistant', text }]
                : current
            })
            void refreshSessions(runtime).catch(() => undefined)
          }

          if (event.type === 'error') {
            setSubmitting(false)
            setError(textFromUnknown(payload?.text) || 'Hermes runtime returned an error')
          }
        })
        await refreshSessions(runtime)

        if (active) {
          setRuntimeState('ready')
        }
      })
      .catch(reason => {
        if (active) {
          setRuntimeState('error')
          setError(reason instanceof Error ? reason.message : 'cannot connect to Hermes runtime')
        }
      })

    return () => {
      active = false
      disposeEvents?.()
      runtimeRef.current?.close()
      runtimeRef.current = null
    }
  }, [refreshSessions])

  const selectSession = useCallback(async (storedSessionId: string) => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    setError(null)
    setMessages([])
    activeSessionIdRef.current = null
    setActiveSessionId(null)

    try {
      const resumed = await runtime.resumeSession(storedSessionId)
      setMessages(toConversationMessages(resumed.messages))
      activeSessionIdRef.current = resumed.session_id
      setActiveSessionId(resumed.session_id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot resume Hermes session')
    }
  }, [])

  const createSession = useCallback(async () => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    setError(null)

    try {
      const sessionId = await runtime.createSession()
      setMessages([])
      activeSessionIdRef.current = sessionId
      setActiveSessionId(sessionId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot create Hermes session')
    }
  }, [])

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const runtime = runtimeRef.current
      const text = composer.trim()

      if (!runtime || !activeSessionId || !text || submitting) {
        return
      }

      setComposer('')
      setError(null)
      setSubmitting(true)
      setMessages(current => [...current, { id: `user-${Date.now()}`, role: 'user', text }])

      try {
        await runtime.submit(activeSessionId, text)
      } catch (reason) {
        setSubmitting(false)
        setError(reason instanceof Error ? reason.message : 'cannot submit prompt to Hermes runtime')
      }
    },
    [activeSessionId, composer, submitting]
  )

  return (
    <section className="hesc-page hesc-assistant-page" data-testid="enterprise-client-assistant">
      <header className="hesc-page-header">
        <div>
          <h1>智能助手</h1>
          <p>使用 Hermes 的会话、工具和推理运行时；对话、导航和企业操作界面由本客户端独立呈现。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={runtimeState === 'ready' ? 'success' : runtimeState === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(runtimeState)}
        </span>
      </header>

      <div className="hesc-assistant-layout">
        <aside aria-label="Hermes 会话目录" className="hesc-card hesc-assistant-sessions">
          <div className="hesc-section-heading">
            <h2 className="hesc-section-title">会话目录</h2>
            <button
              className="hesc-action"
              disabled={runtimeState !== 'ready'}
              onClick={() => void createSession()}
              type="button"
            >
              新建会话
            </button>
          </div>
          {sessions.length === 0 && runtimeState === 'ready' ? (
            <p className="hesc-muted-copy">尚无可恢复的 Hermes 会话。</p>
          ) : null}
          <div className="hesc-agent-session-list">
            {sessions.map(session => (
              <button
                aria-current={session.id === activeSessionId ? 'true' : undefined}
                key={session.id}
                onClick={() => void selectSession(session.id)}
                type="button"
              >
                <strong>{sessionLabel(session)}</strong>
                <span>
                  {session.message_count} 条消息 · {sessionTime(session.started_at)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <article className="hesc-card hesc-agent-transcript">
          {activeSessionId ? (
            <>
              <div className="hesc-section-heading">
                <div>
                  <h2 className="hesc-section-title">协作上下文</h2>
                  <p className="hesc-muted-copy">会话 ID 由 Hermes runtime 管理；企业客户端不保留令牌或服务端地址。</p>
                </div>
                {submitting ? (
                  <span className="hesc-status" data-tone="warning">
                    正在推理
                  </span>
                ) : null}
              </div>
              <div aria-live="polite" className="hesc-agent-messages">
                {messages.length === 0 ? <p className="hesc-muted-copy">新的会话已就绪。输入任务以开始协作。</p> : null}
                {messages.map(message => (
                  <div className="hesc-agent-message" data-role={message.role} key={message.id}>
                    <span>{message.role === 'user' ? '你' : 'Hermes'}</span>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              <form className="hesc-agent-composer" onSubmit={event => void submit(event)}>
                <label htmlFor="enterprise-agent-composer">输入给智能助手的任务</label>
                <textarea
                  disabled={submitting}
                  id="enterprise-agent-composer"
                  onChange={event => setComposer(event.target.value)}
                  placeholder="描述需要分析、执行或协作的工作…"
                  value={composer}
                />
                <div>
                  <span>发送后由 Hermes runtime 执行；企业权限仍由服务端边界控制。</span>
                  <button className="hesc-action" disabled={submitting || !composer.trim()} type="submit">
                    发送任务
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="hesc-empty">
              <div>
                <h2>选择或创建一个会话</h2>
                <p>会话历史和运行时状态均从 Hermes 读取；本页不会构造演示对话。</p>
              </div>
            </div>
          )}
        </article>
      </div>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>智能助手运行时响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
