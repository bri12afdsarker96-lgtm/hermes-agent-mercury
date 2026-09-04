import './enterprise-design-tokens.css'
import './enterprise-client.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AssistantPage } from './assistant-page'
import { currentAuthoritySnapshot, type EnterpriseConnectionState } from './authority-snapshot'
import { ConversationsPage } from './conversations-page'
import { EnterpriseClientShell, EnterpriseStatusBadge } from './enterprise-design-system'
import { GovernancePage } from './governance-page'
import { HandoffsPage } from './handoffs-page'
import { KnowledgePage } from './knowledge-page'
import { EnterpriseLoginPage } from './login-page'
import {
  enterpriseRoleLabel,
  enterpriseWorkspaces,
  enterpriseWorkbenchPresentation,
  type EnterpriseWorkspaceDefinition,
  type EnterpriseWorkspaceId
} from './role-presentation'
import {
  beginEnterpriseLogin,
  connectEnterpriseClient,
  type EnterpriseClientError,
  type EnterpriseClientRuntime,
  type EnterpriseHealth,
  type EnterpriseIdentity,
  type EnterpriseMetrics
} from './runtime'
import { enterpriseSessionDisposition } from './session-policy'
import { canReadMetricAggregation, workbenchAggregate } from './workbench-metrics'
import { WorkflowsPage } from './workflows-page'

type ConnectionState = EnterpriseConnectionState
type WorkspaceId = EnterpriseWorkspaceId

interface ClientSnapshot {
  health: EnterpriseHealth
  identity: EnterpriseIdentity
  metrics: EnterpriseMetrics
}

type WorkspaceDefinition = EnterpriseWorkspaceDefinition

const ALWAYS_VISIBLE_WORKSPACES = new Set<WorkspaceId>(['assistant', 'workbench'])

/**
 * Hermes_AI owns availability. The local role only changes product wording;
 * it must never grant a server-backed Desktop surface.
 */
const SERVER_SURFACE_BY_WORKSPACE: Partial<Record<WorkspaceId, string>> = {
  conversations: 'conversations',
  governance: 'governance',
  handoffs: 'handoffs',
  knowledge: 'knowledge',
  reminders: 'workflows'
}

function workspacesFor(identity: EnterpriseIdentity | undefined): WorkspaceDefinition[] {
  const surfaces = identity?.desktop_surfaces?.surfaces

  return enterpriseWorkspaces(identity).filter(workspace => {
    if (ALWAYS_VISIBLE_WORKSPACES.has(workspace.id)) {
      return true
    }

    const surface = SERVER_SURFACE_BY_WORKSPACE[workspace.id]

    return surface !== undefined && surfaces?.[surface]?.available === true
  })
}
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
  const presentation = enterpriseWorkbenchPresentation(identity?.role)
  const aggregate = workbenchAggregate(identity, snapshot?.metrics)

  return (
    <section className="hesc-page" data-testid="enterprise-client-workbench">
      <header className="hesc-page-header">
        <div>
          <h1>{presentation.title}</h1>
          <p>{presentation.purpose}</p>
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
        <article className="hesc-card">
          <div className="hesc-card-label">{aggregate.label}</div>
          <div className="hesc-card-value">{aggregate.value}</div>
          <p className="hesc-card-note">{aggregate.note}</p>
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
              <dd>{identity ? enterpriseRoleLabel(identity.role) : '—'}</dd>
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

      const [health, identity] = await Promise.all([
        runtime.get<EnterpriseHealth>('/api/health'),
        runtime.get<EnterpriseIdentity>('/api/whoami')
      ])

      const metrics = canReadMetricAggregation(identity)
        ? await runtime.get<EnterpriseMetrics>('/api/metrics?window=24h').catch(() => ({}))
        : {}

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

  const beginLogin = useCallback(async () => {
    setConnectionState('loading')
    setError(null)

    const result = await beginEnterpriseLogin()

    if (!result.ok) {
      setConnectionState('error')
      setError(
        result.code === 'no_enterprise_origin' || result.code === 'no_oauth_gateway'
          ? '企业登录服务尚未完成配置，请联系平台管理员。'
          : result.code === 'login_not_completed'
            ? '企业身份登录未完成，请在打开的浏览器窗口中完成登录后返回客户端。'
            : '无法启动企业身份登录，请检查企业网络连接后重试。'
      )
      return
    }

    await refresh()
  }, [refresh])

  useEffect(() => {
    document.title = 'Hermes Enterprise'
    void refresh()

    return releaseRuntime
  }, [refresh, releaseRuntime])

  const authoritySnapshot = currentAuthoritySnapshot(snapshot, connectionState)
  const authorityRuntime = connectionState === 'ready' ? runtimeRef.current : null
  const visibleWorkspaces = useMemo(
    () => workspacesFor(authoritySnapshot?.identity),
    [authoritySnapshot?.identity?.desktop_surfaces]
  )

  useEffect(() => {
    if (!visibleWorkspaces.some(workspace => workspace.id === activeWorkspace)) {
      setActiveWorkspace('workbench')
    }
  }, [activeWorkspace, visibleWorkspaces])

  if (!snapshot && connectionState !== 'ready') {
    return (
      <EnterpriseLoginPage
        busy={connectionState === 'loading'}
        error={error}
        onLogin={() => void beginLogin()}
        status={humanConnectionState(connectionState)}
      />
    )
  }

  const activeDefinition = visibleWorkspaces.find(workspace => workspace.id === activeWorkspace) ?? WORKSPACES[0]

  return (
    <EnterpriseClientShell
      activeWorkspace={activeDefinition}
      connectionState={connectionState}
      connectionStatus={humanConnectionState(connectionState)}
      identityName={authoritySnapshot?.identity.name ?? '企业工作空间'}
      navigationLabel="企业客户端主导航"
      onSelectWorkspace={workspaceId => {
        const workspace = workspaceId as WorkspaceId

        if (visibleWorkspaces.some(candidate => candidate.id === workspace)) {
          setActiveWorkspace(workspace)
        }
      }}
      productChannel="企业工作台"
      productName="Hermes Enterprise Desktop"
      scopeLabel={enterpriseRoleLabel(authoritySnapshot?.identity.role)}
      statusbarDetail="安全连接 · 服务端权限"
      statusbarLabel="Hermes Enterprise Desktop"
      tenantLabel={authoritySnapshot?.identity.tenant_id ?? '正在解析租户范围'}
      workspaces={visibleWorkspaces}
    >
        {activeDefinition.id === 'workbench' ? <Workbench snapshot={authoritySnapshot} state={connectionState} /> : null}
        {activeDefinition.id === 'assistant' ? <AssistantPage /> : null}
        {activeDefinition.id === 'conversations' ? <ConversationsPage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'handoffs' ? (
          <HandoffsPage principalId={authoritySnapshot?.identity.principal_id} runtime={authorityRuntime} />
        ) : null}
        {activeDefinition.id === 'governance' ? <GovernancePage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'knowledge' ? <KnowledgePage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'reminders' ? (
          <WorkflowsPage
            principalId={authoritySnapshot?.identity.principal_id}
            role={authoritySnapshot?.identity.role}
            runtime={authorityRuntime}
          />
        ) : null}
        {activeDefinition.id !== 'assistant' &&
        activeDefinition.id !== 'conversations' &&
        activeDefinition.id !== 'governance' &&
        activeDefinition.id !== 'handoffs' &&
        activeDefinition.id !== 'knowledge' &&
        activeDefinition.id !== 'reminders' &&
        activeDefinition.id !== 'workbench' ? (
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
