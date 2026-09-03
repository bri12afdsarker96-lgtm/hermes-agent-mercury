import './enterprise-client.css'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AssistantPage } from './assistant-page'
import { currentAuthoritySnapshot, type EnterpriseConnectionState } from './authority-snapshot'
import { ConversationsPage } from './conversations-page'
import { EnterpriseClientShell, EnterpriseStatusBadge } from './enterprise-design-system'
import { GovernancePage } from './governance-page'
import { HandoffsPage } from './handoffs-page'
import { KnowledgePage } from './knowledge-page'
import {
  connectEnterpriseClient,
  type EnterpriseClientError,
  type EnterpriseClientRuntime,
  type EnterpriseHealth,
  type EnterpriseIdentity,
  type EnterpriseMetrics
} from './runtime'
import { enterpriseSessionDisposition } from './session-policy'
import { WorkflowsPage } from './workflows-page'

type ConnectionState = EnterpriseConnectionState
type WorkspaceId = 'assistant' | 'conversations' | 'governance' | 'handoffs' | 'knowledge' | 'reminders' | 'workbench'

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
  { description: '经授权的人工坐席交接', glyph: '04', id: 'handoffs', label: '人工协同' },
  { description: '企业知识与检索工作流', glyph: '05', id: 'knowledge', label: '知识空间' },
  { description: '提醒、任务和业务跟进', glyph: '06', id: 'reminders', label: '工作流' },
  { description: '身份、权限与审计', glyph: '07', id: 'governance', label: '治理中心' }
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
        <EnterpriseStatusBadge tone="warning">分页接入中</EnterpriseStatusBadge>
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
        <EnterpriseStatusBadge tone={statusTone(state)}>{humanConnectionState(state)}</EnterpriseStatusBadge>
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
  const generationRef = useRef(0)
  const runtimeRef = useRef<EnterpriseClientRuntime | null>(null)

  const releaseRuntime = useCallback(() => {
    generationRef.current += 1
    const runtime = runtimeRef.current
    runtimeRef.current = null
    void runtime?.disconnect()
  }, [])

  const releaseAuthentication = useCallback((reason: EnterpriseClientError) => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    generationRef.current += 1
    runtimeRef.current = null
    void runtime?.disconnect()
    setSnapshot(null)
    setConnectionState('error')
    setError(reason.message)
  }, [])

  const refresh = useCallback(async () => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setConnectionState('loading')
    setError(null)

    const existingRuntime = runtimeRef.current
    let runtime: EnterpriseClientRuntime | null = existingRuntime

    try {
      runtime = runtime ?? (await connectEnterpriseClient({ onAuthenticationRequired: releaseAuthentication }))

      if (generation !== generationRef.current) {
        if (runtime !== existingRuntime) {
          await runtime.disconnect()
        }

        return
      }

      runtimeRef.current = runtime

      const [health, identity, metrics] = await Promise.all([
        runtime.get<EnterpriseHealth>('/api/health'),
        runtime.get<EnterpriseIdentity>('/api/whoami'),
        runtime.get<EnterpriseMetrics>('/api/metrics?window=24h')
      ])

      if (generation !== generationRef.current) {
        return
      }

      setSnapshot({ health, identity, metrics })
      setConnectionState('ready')
    } catch (reason) {
      if (generation !== generationRef.current) {
        return
      }

      if (enterpriseSessionDisposition(reason) === 'release-and-clear') {
        void runtime?.disconnect()

        if (runtimeRef.current === runtime) {
          runtimeRef.current = null
        }

        setSnapshot(null)
      }

      setConnectionState('error')
      setError(reason instanceof Error ? reason.message : 'cannot connect to enterprise service')
    }
  }, [releaseAuthentication])

  useEffect(() => {
    document.title = 'Hermes Enterprise'
    void refresh()

    return releaseRuntime
  }, [refresh, releaseRuntime])

  const activeDefinition = WORKSPACES.find(workspace => workspace.id === activeWorkspace) ?? WORKSPACES[0]
  const authoritySnapshot = currentAuthoritySnapshot(snapshot, connectionState)
  const authorityRuntime = connectionState === 'ready' ? runtimeRef.current : null

  return (
    <EnterpriseClientShell
      activeWorkspace={activeDefinition}
      connectionState={connectionState}
      connectionStatus={humanConnectionState(connectionState)}
      identityName={authoritySnapshot?.identity.name ?? '企业工作空间'}
      navigationLabel="企业客户端主导航"
      onSelectWorkspace={workspaceId => setActiveWorkspace(workspaceId as WorkspaceId)}
      productChannel="企业工作台"
      productName="Hermes Enterprise"
      scopeLabel={authoritySnapshot?.identity.role ?? '权限由服务端确定'}
      statusbarDetail="runtime bridge: token-free / authority: server"
      statusbarLabel="Hermes Enterprise Desktop"
      tenantLabel={authoritySnapshot?.identity.tenant_id ?? '正在解析租户范围'}
      workspaces={WORKSPACES}
    >
        {activeWorkspace === 'workbench' ? <Workbench snapshot={authoritySnapshot} state={connectionState} /> : null}
        {activeWorkspace === 'assistant' ? <AssistantPage /> : null}
        {activeWorkspace === 'conversations' ? <ConversationsPage runtime={authorityRuntime} /> : null}
        {activeWorkspace === 'handoffs' ? (
          <HandoffsPage principalId={authoritySnapshot?.identity.principal_id} runtime={authorityRuntime} />
        ) : null}
        {activeWorkspace === 'governance' ? <GovernancePage runtime={authorityRuntime} /> : null}
        {activeWorkspace === 'knowledge' ? <KnowledgePage runtime={authorityRuntime} /> : null}
        {activeWorkspace === 'reminders' ? (
          <WorkflowsPage principalId={authoritySnapshot?.identity.principal_id} runtime={authorityRuntime} />
        ) : null}
        {activeWorkspace !== 'assistant' &&
        activeWorkspace !== 'conversations' &&
        activeWorkspace !== 'governance' &&
        activeWorkspace !== 'handoffs' &&
        activeWorkspace !== 'knowledge' &&
        activeWorkspace !== 'reminders' &&
        activeWorkspace !== 'workbench' ? (
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
    </EnterpriseClientShell>
  )
}
