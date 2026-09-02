import { useEffect, useState } from 'react'

import { RemindersPanel } from './reminders-panel'
import type { EnterpriseClientRuntime } from './runtime'

interface Followup {
  amount?: string
  business_subject?: string
  business_team?: string
  currency?: string
  expected_receive_date?: string
  followup_id?: string
  next_followup_at?: string
  owner_principal_id?: string
  status?: string
  updated_ts?: string
}

interface FollowupHistory {
  actor_principal_id?: string
  created_ts?: string
  event_type?: string
  from_status?: string
  to_status?: string
}

interface FollowupListResponse {
  followups?: Followup[]
}
interface FollowupHistoryResponse {
  history?: FollowupHistory[]
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

export function WorkflowsPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [error, setError] = useState<string | null>(null)
  const [followups, setFollowups] = useState<Followup[]>([])
  const [history, setHistory] = useState<FollowupHistory[]>([])
  const [historyState, setHistoryState] = useState<LoadState>('unavailable')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  useEffect(() => {
    let active = true

    if (!runtime) {
      setFollowups([])
      setSelectedId(null)
      setState('unavailable')

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void runtime
      .get<FollowupListResponse>('/api/followup-list')
      .then(response => {
        if (!active) {
          return
        }

        const next = response.followups ?? []
        setFollowups(next)
        setSelectedId(current =>
          current && next.some(row => row.followup_id === current) ? current : (next[0]?.followup_id ?? null)
        )
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setFollowups([])
        setSelectedId(null)
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load business follow-ups')
      })

    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => {
    let active = true

    if (!runtime || !selectedId) {
      setHistory([])
      setHistoryState('unavailable')

      return () => {
        active = false
      }
    }

    setHistory([])
    setHistoryState('loading')
    void runtime
      .get<FollowupHistoryResponse>(`/api/followup-history?followup_id=${encodeURIComponent(selectedId)}`)
      .then(response => {
        if (!active) {
          return
        }

        setHistory(response.history ?? [])
        setHistoryState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setHistory([])
        setHistoryState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load follow-up history')
      })

    return () => {
      active = false
    }
  }, [runtime, selectedId])

  return (
    <section className="hesc-page" data-testid="enterprise-client-workflows">
      <header className="hesc-page-header">
        <div>
          <h1>工作流</h1>
          <p>展示 Hermes_AI 的业务跟进事实和状态历史。创建、确认、转交及提醒调度仍由已授权的服务端工作流负责。</p>
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
            <strong>工作流服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="hesc-workflows-grid">
        <article className="hesc-card">
          <h2 className="hesc-section-title">业务跟进</h2>
          {state === 'loading' ? <p className="hesc-muted-copy">正在读取服务端跟进事项…</p> : null}
          {state === 'ready' && followups.length === 0 ? (
            <p className="hesc-muted-copy">当前权限范围内没有业务跟进事项。</p>
          ) : null}
          <div className="hesc-outbound-list">
            {followups.map((followup, index) => {
              const id = followup.followup_id

              return (
                <button
                  aria-current={id === selectedId ? 'true' : undefined}
                  disabled={!id}
                  key={id ?? `followup-${index}`}
                  onClick={() => setSelectedId(id ?? null)}
                  type="button"
                >
                  <strong>{followup.business_subject ?? id ?? '服务端未提供业务主题'}</strong>
                  <span>
                    {followup.status ?? '—'} · {followup.business_team ?? '未提供团队'} · 更新于{' '}
                    {timestamp(followup.updated_ts)}
                  </span>
                </button>
              )
            })}
          </div>
        </article>

        <article className="hesc-card">
          <h2 className="hesc-section-title">选中事项</h2>
          {selectedId ? (
            <dl className="hesc-detail-list">
              {(() => {
                const followup = followups.find(row => row.followup_id === selectedId)

                return (
                  <>
                    <div>
                      <dt>跟进标识</dt>
                      <dd>{selectedId}</dd>
                    </div>
                    <div>
                      <dt>负责人</dt>
                      <dd>{followup?.owner_principal_id ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>应收金额</dt>
                      <dd>{followup?.amount ? `${followup.amount} ${followup.currency ?? ''}`.trim() : '—'}</dd>
                    </div>
                    <div>
                      <dt>预计收款</dt>
                      <dd>{followup?.expected_receive_date ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>下次跟进</dt>
                      <dd>{timestamp(followup?.next_followup_at)}</dd>
                    </div>
                  </>
                )
              })()}
            </dl>
          ) : (
            <p className="hesc-muted-copy">选择一个服务端跟进事项以查看其只读状态。</p>
          )}
        </article>
      </div>

      <article className="hesc-card hesc-attempts-card">
        <div className="hesc-section-heading">
          <div>
            <h2 className="hesc-section-title">状态历史</h2>
            <p className="hesc-muted-copy">历史由服务端状态机产生；客户端不改变其生命周期。</p>
          </div>
          <span
            className="hesc-status"
            data-tone={historyState === 'ready' ? 'success' : historyState === 'error' ? 'error' : 'warning'}
          >
            {stateLabel(historyState)}
          </span>
        </div>
        {historyState === 'loading' ? <p className="hesc-muted-copy">正在读取状态历史…</p> : null}
        {historyState === 'ready' && history.length === 0 ? (
          <p className="hesc-muted-copy">该事项没有返回状态历史。</p>
        ) : null}
        {history.length > 0 ? (
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  <th scope="col">事件</th>
                  <th scope="col">状态变化</th>
                  <th scope="col">执行主体</th>
                  <th scope="col">时间</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, index) => (
                  <tr key={`${row.event_type ?? 'event'}-${index}`}>
                    <td>{row.event_type ?? '—'}</td>
                    <td>{[row.from_status, row.to_status].filter(Boolean).join(' → ') || '—'}</td>
                    <td>{row.actor_principal_id ?? '—'}</td>
                    <td>{timestamp(row.created_ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <RemindersPanel runtime={runtime} />
    </section>
  )
}
