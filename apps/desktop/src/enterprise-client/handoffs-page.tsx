import { type FormEvent, useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface Handoff {
  agent_id?: string
  claim_age_s?: number | null
  device?: string
  expires_in_s?: number | null
  msg_id?: string
  state?: string
  text?: string
  thread_id?: string
  ts_updated?: string
}

interface HandoffsResponse {
  handoffs?: Handoff[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function stateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在读取'
  }

  if (state === 'ready') {
    return '已连接'
  }

  if (state === 'error') {
    return '读取失败'
  }

  return '等待企业服务连接'
}

function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '—'
  }

  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(wholeSeconds / 60)

  return minutes > 0 ? `${minutes} 分 ${wholeSeconds % 60} 秒` : `${wholeSeconds} 秒`
}

export function HandoffsPage({
  principalId,
  runtime
}: {
  principalId?: string
  runtime: EnterpriseClientRuntime | null
}) {
  const [actionState, setActionState] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  const [reply, setReply] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  const load = useCallback(async () => {
    if (!runtime) {
      setHandoffs([])
      setSelectedId(null)
      setState('unavailable')

      return
    }

    setError(null)
    setState('loading')

    try {
      const response = await runtime.get<HandoffsResponse>('/api/handoffs')
      const next = response.handoffs ?? []

      setHandoffs(next)
      setSelectedId(current =>
        current && next.some(row => row.msg_id === current) ? current : (next[0]?.msg_id ?? null)
      )
      setState('ready')
    } catch (reason) {
      setHandoffs([])
      setSelectedId(null)
      setState('error')
      setError(reason instanceof Error ? reason.message : 'cannot load human handoffs')
    }
  }, [runtime])

  useEffect(() => {
    void load()
  }, [load])

  const selected = handoffs.find(row => row.msg_id === selectedId)
  const canReply = Boolean(selected?.msg_id && principalId && selected.agent_id === principalId)

  const runAction = useCallback(
    async (path: string, body: Record<string, string>) => {
      if (!runtime?.post) {
        setError('当前桌面运行时不支持人工协同写操作')

        return
      }

      setActionState(path)
      setError(null)

      try {
        await runtime.post(path, body)
        setReply('')
        await load()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'cannot complete handoff action')
      } finally {
        setActionState(null)
      }
    },
    [load, runtime]
  )

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selected?.msg_id || !reply.trim()) {
      return
    }

    void runAction('/api/handoff-reply', { msg_id: selected.msg_id, text: reply.trim() })
  }

  return (
    <section className="hesc-page" data-testid="enterprise-client-handoffs">
      <header className="hesc-page-header">
        <div>
          <h1>人工协同</h1>
          <p>仅呈现当前租户授权范围内的人工交接队列。认领、回复和退回操作由 Hermes_AI 在服务端复核身份、租户与权限。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(state)}
        </span>
      </header>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>人工协同服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="hesc-conversations-grid">
        <article className="hesc-card">
          <div className="hesc-section-heading">
            <h2 className="hesc-section-title">待人工处理</h2>
            <button className="hesc-action" onClick={() => void load()} type="button">
              刷新队列
            </button>
          </div>
          {state === 'loading' ? <p className="hesc-muted-copy">正在读取交接队列…</p> : null}
          {state === 'ready' && handoffs.length === 0 ? (
            <p className="hesc-muted-copy">当前没有待人工处理的消息。</p>
          ) : null}
          <div className="hesc-outbound-list">
            {handoffs.map((handoff, index) => {
              const id = handoff.msg_id

              return (
                <button
                  aria-current={id === selectedId ? 'true' : undefined}
                  disabled={!id}
                  key={id ?? `handoff-${index}`}
                  onClick={() => setSelectedId(id ?? null)}
                  type="button"
                >
                  <strong>{handoff.state ?? '服务端未提供状态'}</strong>
                  <span>{handoff.thread_id ?? handoff.device ?? id ?? '服务端未提供交接标识'}</span>
                </button>
              )
            })}
          </div>
        </article>

        <article className="hesc-card">
          <h2 className="hesc-section-title">交接详情</h2>
          {selected?.msg_id ? (
            <>
              <dl className="hesc-detail-list">
                <div>
                  <dt>交接标识</dt>
                  <dd>{selected.msg_id}</dd>
                </div>
                <div>
                  <dt>当前状态</dt>
                  <dd>{selected.state ?? '—'}</dd>
                </div>
                <div>
                  <dt>当前坐席</dt>
                  <dd>{selected.agent_id ?? '尚未认领'}</dd>
                </div>
                <div>
                  <dt>认领时长</dt>
                  <dd>{duration(selected.claim_age_s)}</dd>
                </div>
                <div>
                  <dt>剩余有效期</dt>
                  <dd>{duration(selected.expires_in_s)}</dd>
                </div>
              </dl>
              <p className="hesc-muted-copy">{selected.text ?? '服务端未提供可显示的交接摘要。'}</p>
              {!selected.agent_id ? (
                <button
                  className="hesc-action"
                  disabled={actionState !== null}
                  onClick={() => void runAction('/api/handoff-claim', { msg_id: selected.msg_id! })}
                  type="button"
                >
                  {actionState === '/api/handoff-claim' ? '正在认领…' : '认领交接'}
                </button>
              ) : null}
              {canReply ? (
                <>
                  <form className="hesc-composer" onSubmit={submitReply}>
                    <label htmlFor="enterprise-handoff-reply">人工回复</label>
                    <textarea
                      id="enterprise-handoff-reply"
                      onChange={event => setReply(event.target.value)}
                      placeholder="输入将由服务端投递的回复"
                      value={reply}
                    />
                    <button className="hesc-action" disabled={!reply.trim() || actionState !== null} type="submit">
                      {actionState === '/api/handoff-reply' ? '正在发送…' : '发送回复'}
                    </button>
                  </form>
                  <button
                    className="hesc-action"
                    disabled={actionState !== null}
                    onClick={() => void runAction('/api/handoff-requeue', { msg_id: selected.msg_id! })}
                    type="button"
                  >
                    {actionState === '/api/handoff-requeue' ? '正在退回…' : '退回智能分诊'}
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <p className="hesc-muted-copy">从左侧选择一条服务端交接事项以查看授权操作。</p>
          )}
        </article>
      </div>
    </section>
  )
}
