import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface InboundConversation {
  channel?: string
  external_chat_id?: string
  inbound_id?: string
  message_type?: string
  received_ts?: string
  state?: string
}

interface OutboundConversation {
  channel?: string
  created_ts?: string
  internal_message_id?: string
  state?: string
}

interface DeliveryAttempt {
  attempt_number?: number
  created_ts?: string
  finished_ts?: string
  outcome_class?: string
  state?: string
}

interface InboundResponse {
  inbound?: InboundConversation[]
}

interface OutboundResponse {
  outbound?: OutboundConversation[]
}

interface AttemptsResponse {
  attempts?: DeliveryAttempt[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function timestamp(value: string | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function requestStateLabel(state: LoadState): string {
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

function stateRequestPath(basePath: string, state: string): string {
  return state ? `${basePath}?state=${encodeURIComponent(state)}` : basePath
}

export function ConversationsPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([])
  const [attemptsState, setAttemptsState] = useState<LoadState>('unavailable')
  const [error, setError] = useState<string | null>(null)
  const [inbound, setInbound] = useState<InboundConversation[]>([])
  const [inboundStateFilter, setInboundStateFilter] = useState('')
  const [outbound, setOutbound] = useState<OutboundConversation[]>([])
  const [outboundStateFilter, setOutboundStateFilter] = useState('')
  const [selectedOutboundId, setSelectedOutboundId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  useEffect(() => {
    let active = true

    if (!runtime) {
      setInbound([])
      setOutbound([])
      setSelectedOutboundId(null)
      setState('unavailable')

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void Promise.all([
      runtime.get<InboundResponse>(stateRequestPath('/api/conversations-inbound', inboundStateFilter)),
      runtime.get<OutboundResponse>(stateRequestPath('/api/conversations-outbound', outboundStateFilter))
    ])
      .then(([inboundResponse, outboundResponse]) => {
        if (!active) {
          return
        }

        setInbound(inboundResponse.inbound ?? [])
        setOutbound(outboundResponse.outbound ?? [])
        setSelectedOutboundId(current =>
          current && (outboundResponse.outbound ?? []).some(row => row.internal_message_id === current)
            ? current
            : (outboundResponse.outbound?.[0]?.internal_message_id ?? null)
        )
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setInbound([])
        setOutbound([])
        setSelectedOutboundId(null)
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load conversation observability')
      })

    return () => {
      active = false
    }
  }, [inboundStateFilter, outboundStateFilter, runtime])

  useEffect(() => {
    let active = true

    if (!runtime || !selectedOutboundId) {
      setAttempts([])
      setAttemptsState('unavailable')

      return () => {
        active = false
      }
    }

    setAttempts([])
    setAttemptsState('loading')
    void runtime
      .get<AttemptsResponse>(
        `/api/conversations-attempts?internal_message_id=${encodeURIComponent(selectedOutboundId)}`
      )
      .then(response => {
        if (!active) {
          return
        }

        setAttempts(response.attempts ?? [])
        setAttemptsState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setAttempts([])
        setAttemptsState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load delivery attempts')
      })

    return () => {
      active = false
    }
  }, [runtime, selectedOutboundId])

  const inboundStates = Array.from(
    new Set([...inbound.map(row => row.state), inboundStateFilter].filter((value): value is string => Boolean(value)))
  )

  const outboundStates = Array.from(
    new Set([...outbound.map(row => row.state), outboundStateFilter].filter((value): value is string => Boolean(value)))
  )

  return (
    <section className="hesc-page" data-testid="enterprise-client-conversations">
      <header className="hesc-page-header">
        <div>
          <h1>会话中心</h1>
          <p>已接入 Hermes_AI 的企业消息事实与投递尝试只读视图；消息正文和外部联系人标识始终不投射到客户端。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {requestStateLabel(state)}
        </span>
      </header>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>会话中心服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="hesc-conversations-grid">
        <article className="hesc-card">
          <div className="hesc-section-heading">
            <h2 className="hesc-section-title">入站消息事实</h2>
            <label className="hesc-filter-control">
              状态
              <select
                aria-label="筛选入站消息状态"
                onChange={event => setInboundStateFilter(event.target.value)}
                value={inboundStateFilter}
              >
                <option value="">全部状态</option>
                {inboundStates.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {state === 'loading' ? <p className="hesc-muted-copy">正在读取服务端入站账本…</p> : null}
          {state === 'ready' && inbound.length === 0 ? (
            <p className="hesc-muted-copy">当前权限范围内没有入站消息事实。</p>
          ) : null}
          {inbound.length > 0 ? (
            <div className="hesc-table-wrap">
              <table className="hesc-table">
                <thead>
                  <tr>
                    <th scope="col">渠道</th>
                    <th scope="col">线程</th>
                    <th scope="col">类型</th>
                    <th scope="col">状态</th>
                    <th scope="col">接收时间</th>
                  </tr>
                </thead>
                <tbody>
                  {inbound.map((row, index) => (
                    <tr key={row.inbound_id ?? `inbound-${index}`}>
                      <td>{row.channel ?? '—'}</td>
                      <td>{row.external_chat_id ?? '—'}</td>
                      <td>{row.message_type ?? '—'}</td>
                      <td>{row.state ?? '—'}</td>
                      <td>{timestamp(row.received_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="hesc-card">
          <div className="hesc-section-heading">
            <h2 className="hesc-section-title">出站投递事实</h2>
            <label className="hesc-filter-control">
              状态
              <select
                aria-label="筛选出站消息状态"
                onChange={event => setOutboundStateFilter(event.target.value)}
                value={outboundStateFilter}
              >
                <option value="">全部状态</option>
                {outboundStates.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {state === 'loading' ? <p className="hesc-muted-copy">正在读取服务端出站账本…</p> : null}
          {state === 'ready' && outbound.length === 0 ? (
            <p className="hesc-muted-copy">当前权限范围内没有出站投递事实。</p>
          ) : null}
          <div className="hesc-outbound-list">
            {outbound.map((row, index) => {
              const id = row.internal_message_id

              return (
                <button
                  aria-current={id && id === selectedOutboundId ? 'true' : undefined}
                  disabled={!id}
                  key={id ?? `outbound-${index}`}
                  onClick={() => setSelectedOutboundId(id ?? null)}
                  type="button"
                >
                  <strong>{id ?? '服务端未提供投递标识'}</strong>
                  <span>
                    {row.channel ?? '—'} · {row.state ?? '—'} · {timestamp(row.created_ts)}
                  </span>
                </button>
              )
            })}
          </div>
        </article>
      </div>

      <article className="hesc-card hesc-attempts-card">
        <div className="hesc-section-heading">
          <div>
            <h2 className="hesc-section-title">投递尝试链</h2>
            <p className="hesc-muted-copy">仅展示选中出站消息的投递状态链，不允许在此页重放或重新执行消息。</p>
          </div>
          <span
            className="hesc-status"
            data-tone={attemptsState === 'ready' ? 'success' : attemptsState === 'error' ? 'error' : 'warning'}
          >
            {requestStateLabel(attemptsState)}
          </span>
        </div>
        {attemptsState === 'loading' ? <p className="hesc-muted-copy">正在读取投递尝试…</p> : null}
        {attemptsState === 'ready' && attempts.length === 0 ? (
          <p className="hesc-muted-copy">该出站消息没有返回投递尝试。</p>
        ) : null}
        {attempts.length > 0 ? (
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  <th scope="col">尝试</th>
                  <th scope="col">状态</th>
                  <th scope="col">结果分类</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">完成时间</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((row, index) => (
                  <tr key={`${row.attempt_number ?? 'attempt'}-${index}`}>
                    <td>{row.attempt_number ?? '—'}</td>
                    <td>{row.state ?? '—'}</td>
                    <td>{row.outcome_class ?? '—'}</td>
                    <td>{timestamp(row.created_ts)}</td>
                    <td>{timestamp(row.finished_ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </section>
  )
}
