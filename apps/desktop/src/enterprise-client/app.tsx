import './enterprise-client.css'

import { useCallback, useEffect, useRef, useState } from 'react'

import { KnowledgePage } from './knowledge-page'
import {
  connectEnterpriseClient,
  type EnterpriseClientRuntime,
  type EnterpriseHealth,
  type EnterpriseIdentity,
  type EnterpriseMetrics
} from './runtime'

type ConnectionState = 'error' | 'loading' | 'ready' | 'unavailable'
type WorkspaceId = 'assistant' | 'conversations' | 'governance' | 'knowledge' | 'reminders' | 'workbench'

interface ClientSnapshot {
  health: EnterpriseHealth
  identity: EnterpriseIdentity
  metrics: EnterpriseMetrics
}

interface WorkspaceDefinition {
  description: string
  glyph: string
  id: WorkspaceId
  label: string
}

const WORKSPACES: WorkspaceDefinition[] = [
  { description: '连接状态与运营概览', glyph: '01', id: 'workbench', label: '工作台' },
  { description: '基于 Hermes runtime 的智能协作', glyph: '02', id: 'assistant', label: '智能助手' },
  { description: '企业渠道与人工协同', glyph: '03', id: 'conversations', label: '会话中心' },
  { description: '企业知识与检索工作流', glyph: '04', id: 'knowledge', label: '知识空间' },
  { description: '提醒、任务和业务跟进', glyph: '05', id: 'reminders', label: '工作流' },
  { description: '身份、权限与审计', glyph: '06', id: 'governance', label: '治理中心' }
]

function humanConnectionState(state: ConnectionState): string {
  if (state === 'loading') {
    return '正在连接企业服务'
  }

  if (state === 'ready') {
    return '企业服务已连接'
  }

  if (state === 'error') {
    return '企业服务不可用'
  }

  return '等待连接企业服务'
}

function statusTone(state: ConnectionState): 'error' | 'success' | 'warning' {
  if (state === 'ready') {
    return 'success'
  }

  return state === 'error' ? 'error' : 'warning'
}

function capabilityCount(identity: EnterpriseIdentity | undefined): number {
  return Object.values(identity?.product_capabilities ?? {}).filter(
    capability => capability.enabled && capability.status === 'LIVE'
  ).length
}

function WorkspacePlaceholder({ workspace }: { workspace: WorkspaceDefinition }) {
  return (
    <section className="hesc-page" data-testid={`enterprise-client-${workspace.id}`}>
      <header className="hesc-page-header">
        <div>
          <h1>{workspace.label}</h1>
          <p>{workspace.description}</p>
        </div>
        <span className="hesc-status" data-tone="warning">
          分页接入中
        </span>
      </header>
      <div className="hesc-empty">
        <div>
          <h2>该业务页面尚未接入</h2>
          <p>客户端不会以样例数据替代服务端事实。该页将在对应 Hermes runtime 或 Hermes_AI 契约验证完成后接入。</p>
        </div>
      </div>
    </section>
  )
}

function Workbench({ snapshot, state }: { snapshot: ClientSnapshot | null; state: ConnectionState }) {
  const identity = snapshot?.identity
  const health = snapshot?.health
  const alerts = snapshot?.metrics.alerts
  const serviceValue = health ? (health.ok ? '正常' : '异常') : '—'

  return (
    <section className="hesc-page" data-testid="enterprise-client-workbench">
      <header className="hesc-page-header">
        <div>
          <h1>我的工作台</h1>
          <p>企业运行态、身份范围与当前能力状态均来自已连接的服务端。</p>
        </div>
        <span className="hesc-status" data-tone={statusTone(state)}>
          {humanConnectionState(state)}
        </span>
      </header>

      <div className="hesc-kpis">
        <article className="hesc-card">
          <div className="hesc-card-label">企业服务</div>
          <div className="hesc-card-value">{serviceValue}</div>
          <p className="hesc-card-note">
            {health?.auth_mode ? `认证方式：${health.auth_mode}` : '等待服务端健康度响应'}
          </p>
        </article>
        <article className="hesc-card">
          <div className="hesc-card-label">当前告警 · 24 小时</div>
          <div className="hesc-card-value">{alerts?.length ?? '—'}</div>
          <p className="hesc-card-note">仅统计服务端返回的告警列表</p>
        </article>
        <article className="hesc-card">
          <div className="hesc-card-label">已启用能力</div>
          <div className="hesc-card-value">{identity ? capabilityCount(identity) : '—'}</div>
          <p className="hesc-card-note">LIVE 且已启用的服务端能力</p>
        </article>
      </div>

      <div className="hesc-grid">
        <article className="hesc-card">
          <h2 className="hesc-section-title">当前身份范围</h2>
          <dl className="hesc-detail-list">
            <div>
              <dt>主体</dt>
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
          <h2 className="hesc-section-title">活动告警</h2>
          {alerts && alerts.length > 0 ? (
            <div className="hesc-alert-list">
              {alerts.map((alert, index) => (
                <div className="hesc-alert" key={`${alert.code ?? 'alert'}-${index}`}>
                  <strong>{alert.message ?? alert.code ?? '服务端告警'}</strong>
                  <span>{alert.code ?? '未提供告警代码'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="hesc-empty">
              <div>
                <h2>{alerts ? '当前没有活动告警' : '等待告警数据'}</h2>
                <p>此区域不会构造告警、事件或运营数据。</p>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}

export function EnterpriseClientApp() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('workbench')
  const [connectionState, setConnectionState] = useState<ConnectionState>('unavailable')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null)
  const runtimeRef = useRef<EnterpriseClientRuntime | null>(null)

  const releaseRuntime = useCallback(() => {
    const runtime = runtimeRef.current
    runtimeRef.current = null
    void runtime?.disconnect()
  }, [])

  const refresh = useCallback(async () => {
    setConnectionState('loading')
    setError(null)
    let runtime: EnterpriseClientRuntime | null = runtimeRef.current

    try {
      runtime = runtime ?? (await connectEnterpriseClient())
      runtimeRef.current = runtime

      const [health, identity, metrics] = await Promise.all([
        runtime.get<EnterpriseHealth>('/api/health'),
        runtime.get<EnterpriseIdentity>('/api/whoami'),
        runtime.get<EnterpriseMetrics>('/api/metrics?window=24h')
      ])

      setSnapshot({ health, identity, metrics })
      setConnectionState('ready')
    } catch (reason) {
      void runtime?.disconnect()

      if (runtimeRef.current === runtime) {
        runtimeRef.current = null
      }

      setSnapshot(null)
      setConnectionState('error')
      setError(reason instanceof Error ? reason.message : 'cannot connect to enterprise service')
    }
  }, [])

  useEffect(() => {
    document.title = 'Hermes Enterprise'
    void refresh()

    return releaseRuntime
  }, [refresh, releaseRuntime])

  const activeDefinition = WORKSPACES.find(workspace => workspace.id === activeWorkspace) ?? WORKSPACES[0]

  return (
    <div className="hesc-root" data-testid="enterprise-client-root">
      <header className="hesc-titlebar">
        <div aria-hidden="true" className="hesc-mark">
          HE
        </div>
        <strong className="hesc-product-name">Hermes Enterprise</strong>
        <span className="hesc-product-channel">独立企业客户端</span>
        <div className="hesc-title-spacer" />
        <span
          className="hesc-connection-dot"
          data-state={connectionState === 'ready' ? 'ready' : connectionState === 'error' ? 'error' : 'idle'}
        />
        <span className="hesc-title-status">{humanConnectionState(connectionState)}</span>
      </header>

      <aside aria-label="企业客户端主导航" className="hesc-sidebar">
        <div className="hesc-sidebar-identity">
          <strong>{snapshot?.identity.name ?? '企业工作空间'}</strong>
          <span>{snapshot?.identity.tenant_id ?? '正在解析租户范围'}</span>
        </div>
        <nav className="hesc-nav">
          {WORKSPACES.map(workspace => (
            <button
              aria-current={workspace.id === activeWorkspace ? 'page' : undefined}
              key={workspace.id}
              onClick={() => setActiveWorkspace(workspace.id)}
              type="button"
            >
              <span aria-hidden="true" className="hesc-nav-glyph">
                {workspace.glyph}
              </span>
              <span className="hesc-nav-label">{workspace.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <header className="hesc-topbar">
        <div className="hesc-breadcrumb">
          企业客户端 / <strong>{activeDefinition.label}</strong>
        </div>
        <div className="hesc-topbar-scope">{snapshot?.identity.role ?? '权限由服务端确定'}</div>
      </header>

      <main className="hesc-main">
        {activeWorkspace === 'workbench' ? <Workbench snapshot={snapshot} state={connectionState} /> : null}
        {activeWorkspace === 'knowledge' ? <KnowledgePage runtime={runtimeRef.current} /> : null}
        {activeWorkspace !== 'knowledge' && activeWorkspace !== 'workbench' ? (
          <WorkspacePlaceholder workspace={activeDefinition} />
        ) : null}
        {error ? (
          <div className="hesc-error" role="status">
            <div>
              <strong>无法读取企业服务状态</strong>
              <span>{error}</span>
            </div>
            <button className="hesc-action" onClick={() => void refresh()} type="button">
              重试连接
            </button>
          </div>
        ) : null}
      </main>

      <footer className="hesc-statusbar">
        <span>Hermes Enterprise Client · 独立界面层</span>
        <code>runtime bridge: token-free / authority: server</code>
      </footer>
    </div>
  )
}
