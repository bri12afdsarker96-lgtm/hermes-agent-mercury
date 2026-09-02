import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

interface AuditEvent {
  action?: string
  actor?: string
  event_id?: string
  resource_ref?: string
  ts?: string
}

interface AuditResponse {
  events?: AuditEvent[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function timestamp(value: string | undefined): string {
  if (!value) return '—'

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function stateLabel(state: LoadState): string {
  if (state === 'loading') return '正在读取'
  if (state === 'ready') return '已连接'
  if (state === 'error') return '读取失败'

  return '等待企业服务连接'
}

export function GovernancePage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [identity, setIdentity] = useState<EnterpriseIdentity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  useEffect(() => {
    let active = true

    if (!runtime) {
      setEvents([])
      setIdentity(null)
      setState('unavailable')

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void Promise.all([runtime.get<EnterpriseIdentity>('/api/whoami'), runtime.get<AuditResponse>('/api/audit-list')])
      .then(([nextIdentity, audit]) => {
        if (!active) return

        setIdentity(nextIdentity)
        setEvents(audit.events ?? [])
        setState('ready')
      })
      .catch(reason => {
        if (!active) return

        setEvents([])
        setIdentity(null)
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load governance evidence')
      })

    return () => {
      active = false
    }
  }, [runtime])

  return (
    <section className="hesc-page" data-testid="enterprise-client-governance">
      <header className="hesc-page-header">
        <div>
          <h1>治理中心</h1>
          <p>身份范围和审计证据均由 Hermes_AI 授权与投射；客户端不自行判定权限，也不提供审计重放。</p>
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
            <strong>治理服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="hesc-governance-grid">
        <article className="hesc-card">
          <h2 className="hesc-section-title">当前授权主体</h2>
          <dl className="hesc-detail-list">
            <div>
              <dt>名称</dt>
              <dd>{identity?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>租户</dt>
              <dd>{identity?.tenant_id ?? '—'}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{identity?.role ?? '—'}</dd>
            </div>
            <div>
              <dt>主体标识</dt>
              <dd>{identity?.principal_id ?? '—'}</dd>
            </div>
          </dl>
        </article>
        <article className="hesc-card">
          <h2 className="hesc-section-title">能力状态</h2>
          {identity ? (
            <div className="hesc-capability-list">
              {Object.entries(identity.product_capabilities ?? {}).map(([name, capability]) => (
                <div key={name}>
                  <strong>{name}</strong>
                  <span data-live={capability.enabled && capability.status === 'LIVE' ? 'true' : 'false'}>
                    {capability.enabled && capability.status === 'LIVE' ? '已启用' : (capability.status ?? '未启用')}
                  </span>
                </div>
              ))}
              {Object.keys(identity.product_capabilities ?? {}).length === 0 ? (
                <p className="hesc-muted-copy">服务端未返回产品能力状态。</p>
              ) : null}
            </div>
          ) : (
            <p className="hesc-muted-copy">正在等待服务端身份范围。</p>
          )}
        </article>
      </div>

      <article className="hesc-card hesc-audit-card">
        <div className="hesc-section-heading">
          <div>
            <h2 className="hesc-section-title">审计证据</h2>
            <p className="hesc-muted-copy">只读事件索引；不包含事件载荷，不提供命令重新执行。</p>
          </div>
        </div>
        {state === 'loading' ? <p className="hesc-muted-copy">正在读取审计事件索引…</p> : null}
        {state === 'ready' && events.length === 0 ? (
          <p className="hesc-muted-copy">当前授权范围内没有可展示的审计事件。</p>
        ) : null}
        {events.length > 0 ? (
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  <th scope="col">操作</th>
                  <th scope="col">资源引用</th>
                  <th scope="col">执行主体</th>
                  <th scope="col">时间</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={event.event_id ?? `audit-${index}`}>
                    <td>{event.action ?? '—'}</td>
                    <td>{event.resource_ref ?? '—'}</td>
                    <td>{event.actor ?? '—'}</td>
                    <td>{timestamp(event.ts)}</td>
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
