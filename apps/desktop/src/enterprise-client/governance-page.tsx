import { useEffect, useState } from 'react'

import { CapabilityPolicyPanel } from './capability-policy-panel'
import { PrincipalProvisioningPanel } from './principal-provisioning-panel'
import { enterpriseRoleLabel } from './role-presentation'
import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'
import { TenantAiConfigPanel } from './tenant-ai-config-panel'

interface AuditEvent {
  action?: string
  actor?: string
  event_id?: string
  payload_ref?: unknown
  resource_ref?: string
  ts?: string
}

interface AuditResponse {
  events?: AuditEvent[]
}

interface AuditDetailResponse {
  event?: AuditEvent
}

interface AuditCorrelationResponse {
  events?: AuditEvent[]
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

function referenceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}

export function GovernancePage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [correlation, setCorrelation] = useState<AuditEvent[]>([])
  const [correlationState, setCorrelationState] = useState<LoadState>('unavailable')
  const [detail, setDetail] = useState<AuditEvent | null>(null)
  const [detailState, setDetailState] = useState<LoadState>('unavailable')
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [identity, setIdentity] = useState<EnterpriseIdentity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  useEffect(() => {
    let active = true

    if (!runtime) {
      setCorrelation([])
      setCorrelationState('unavailable')
      setDetail(null)
      setDetailState('unavailable')
      setEvents([])
      setIdentity(null)
      setSelectedEventId(null)
      setState('unavailable')

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void Promise.all([runtime.get<EnterpriseIdentity>('/api/whoami'), runtime.get<AuditResponse>('/api/audit-list')])
      .then(([nextIdentity, audit]) => {
        if (!active) {
          return
        }

        setIdentity(nextIdentity)
        const nextEvents = audit.events ?? []
        setEvents(nextEvents)
        setSelectedEventId(current =>
          current && nextEvents.some(event => event.event_id === current) ? current : (nextEvents[0]?.event_id ?? null)
        )
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setEvents([])
        setIdentity(null)
        setSelectedEventId(null)
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load governance evidence')
      })

    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => {
    let active = true

    if (!runtime || !selectedEventId) {
      setDetail(null)
      setDetailState('unavailable')

      return () => {
        active = false
      }
    }

    setDetail(null)
    setDetailState('loading')
    void runtime
      .get<AuditDetailResponse>(`/api/audit-detail?event_id=${encodeURIComponent(selectedEventId)}`)
      .then(response => {
        if (!active) {
          return
        }

        setDetail(response.event ?? null)
        setDetailState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setDetail(null)
        setDetailState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load audit evidence detail')
      })

    return () => {
      active = false
    }
  }, [runtime, selectedEventId])

  const selectedResourceRef =
    detail?.resource_ref ?? events.find(event => event.event_id === selectedEventId)?.resource_ref

  useEffect(() => {
    let active = true

    if (!runtime || !selectedResourceRef) {
      setCorrelation([])
      setCorrelationState('unavailable')

      return () => {
        active = false
      }
    }

    setCorrelation([])
    setCorrelationState('loading')
    void runtime
      .get<AuditCorrelationResponse>(`/api/audit-correlate?resource_ref=${encodeURIComponent(selectedResourceRef)}`)
      .then(response => {
        if (!active) {
          return
        }

        setCorrelation(response.events ?? [])
        setCorrelationState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setCorrelation([])
        setCorrelationState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load audit evidence correlation')
      })

    return () => {
      active = false
    }
  }, [runtime, selectedResourceRef])

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
              <dd>{identity ? enterpriseRoleLabel(identity.role) : '—'}</dd>
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

      <CapabilityPolicyPanel runtime={runtime} />

      <PrincipalProvisioningPanel identity={identity} runtime={runtime} />

      {identity?.role === 'tenant_admin' ? <TenantAiConfigPanel runtime={runtime} /> : null}

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
                  <th scope="col">证据</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={event.event_id ?? `audit-${index}`}>
                    <td>{event.action ?? '—'}</td>
                    <td>{event.resource_ref ?? '—'}</td>
                    <td>{event.actor ?? '—'}</td>
                    <td>{timestamp(event.ts)}</td>
                    <td>
                      <button
                        className="hesc-action"
                        disabled={!event.event_id}
                        onClick={() => setSelectedEventId(event.event_id ?? null)}
                        type="button"
                      >
                        {event.event_id === selectedEventId ? '已选中' : '查看证据'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <div className="hesc-governance-grid">
        <article className="hesc-card">
          <div className="hesc-section-heading">
            <div>
              <h2 className="hesc-section-title">证据详情</h2>
              <p className="hesc-muted-copy">仅展示服务端安全投影，不会重新执行历史命令。</p>
            </div>
            <span
              className="hesc-status"
              data-tone={detailState === 'ready' ? 'success' : detailState === 'error' ? 'error' : 'warning'}
            >
              {stateLabel(detailState)}
            </span>
          </div>
          {detailState === 'loading' ? <p className="hesc-muted-copy">正在读取审计证据详情…</p> : null}
          {detailState === 'ready' && !detail ? <p className="hesc-muted-copy">该事件已不在当前授权范围内。</p> : null}
          {detail ? (
            <dl className="hesc-detail-list">
              <div>
                <dt>事件标识</dt>
                <dd>{detail.event_id ?? selectedEventId ?? '—'}</dd>
              </div>
              <div>
                <dt>资源引用</dt>
                <dd>{detail.resource_ref ?? '—'}</dd>
              </div>
              <div>
                <dt>安全载荷引用</dt>
                <dd>{referenceValue(detail.payload_ref)}</dd>
              </div>
            </dl>
          ) : null}
        </article>

        <article className="hesc-card">
          <div className="hesc-section-heading">
            <div>
              <h2 className="hesc-section-title">同资源证据链</h2>
              <p className="hesc-muted-copy">按服务端时间顺序关联同一资源的事实；它是证据浏览，不是重放。</p>
            </div>
            <span
              className="hesc-status"
              data-tone={correlationState === 'ready' ? 'success' : correlationState === 'error' ? 'error' : 'warning'}
            >
              {stateLabel(correlationState)}
            </span>
          </div>
          {correlationState === 'loading' ? <p className="hesc-muted-copy">正在关联同资源审计证据…</p> : null}
          {correlationState === 'ready' && correlation.length === 0 ? (
            <p className="hesc-muted-copy">该资源没有返回更多审计证据。</p>
          ) : null}
          {correlation.length > 0 ? (
            <div className="hesc-outbound-list">
              {correlation.map((event, index) => (
                <button
                  aria-current={event.event_id === selectedEventId ? 'true' : undefined}
                  disabled={!event.event_id}
                  key={event.event_id ?? `correlation-${index}`}
                  onClick={() => setSelectedEventId(event.event_id ?? null)}
                  type="button"
                >
                  <strong>{event.action ?? '服务端未提供操作'}</strong>
                  <span>
                    {event.actor ?? '—'} · {timestamp(event.ts)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  )
}
