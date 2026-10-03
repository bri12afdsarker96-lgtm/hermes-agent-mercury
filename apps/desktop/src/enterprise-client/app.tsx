import './enterprise-design-tokens.css'
import './enterprise-client.css'

import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { I18nProvider } from '@/i18n/context'
import { AccountControls } from './account-controls'
import { useWebPresentation } from './web-presentation'
import { useWebLayoutCopy } from './web-sections'
import { ReceivablesPage, type ReceivablesOverviewProps } from './receivables-page'
import { DeliveryHistory } from './delivery-history'
import { $enterpriseReminderTasks, $personalReminders, type PersonalReminder, type ReminderCenterTask } from './reminder-state'

import { AssistantPage } from './assistant-page'
import { AiConfigurationPage } from './ai-configuration-page'
import { AssistantReminders } from './assistant-reminders'
import { OverduePage } from './overdue-page'
import { BusinessTasksPanel } from './business-tasks-panel'
import {
  type AssistantMode,
  assistantSessionFor,
  preserveAssistantSessionForPageReload,
  releaseAssistantSession
} from './assistant-session'
import { currentAuthoritySnapshot, type EnterpriseConnectionState } from './authority-snapshot'
import { ConversationsPage } from './conversations-page'
import { EnterpriseClientShell, EnterpriseStatusBadge } from './enterprise-design-system'
import { GovernancePage } from './governance-page'
import { HandoffsPage } from './handoffs-page'
import { KnowledgePage } from './knowledge-page'
import { EnterpriseLoginPage, EnterprisePasswordChangePage } from './login-page'
import { OperationsOverviewPanel } from './operations-overview-panel'
import { EnterprisePackageUpdateBoundary } from './package-update-ui'
import { PlatformPage } from './platform-page'
import { SeatRequestPanel } from './seat-request-panel'
import { ToolsPage } from './tools-page'
import {
  enterpriseRoleLabel,
  enterpriseWorkbenchPresentation,
  type EnterpriseWorkspaceDefinition,
  type EnterpriseWorkspaceId,
  enterpriseWorkspaces
} from './role-presentation'
import {
  connectEnterpriseClient,
  connectEnterpriseClientWithPassword,
  type EnterpriseClientError,
  type EnterpriseClientRuntime,
  type EnterpriseHealth,
  type EnterpriseIdentity,
  EnterpriseLoginRequired,
  type EnterpriseMetrics
} from './runtime'
import { enterpriseSessionDisposition } from './session-policy'
import { canReadMetricAggregation } from './workbench-metrics'
import { connectionRecoveryDelay, isTransientConnectionFailure } from './connection-recovery'

type ConnectionState = EnterpriseConnectionState
type WorkspaceId = EnterpriseWorkspaceId

interface ClientSnapshot {
  health: EnterpriseHealth
  identity: EnterpriseIdentity
  metrics: EnterpriseMetrics
}

type WorkspaceDefinition = EnterpriseWorkspaceDefinition

function isReminderCenterTask(row: PersonalReminder | ReminderCenterTask): row is ReminderCenterTask {
  return 'source_type' in row
}

function reminderTitle(row: PersonalReminder | ReminderCenterTask): string {
  return isReminderCenterTask(row) ? row.business_subject : row.title
}

function reminderWhen(row: PersonalReminder | ReminderCenterTask, beijing = false): string {
  if (beijing) {
    const date = new Date(isReminderCenterTask(row) ? row.next_followup_at ?? '' : row.scheduled_for * 1000)
    return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  }
  return isReminderCenterTask(row)
    ? new Date(row.next_followup_at ?? '').toLocaleString('zh-CN')
    : new Date(row.scheduled_for * 1000).toLocaleString('zh-CN')
}

// Tools is renderer-local; the AI configuration destination is still guarded by its server-owned permission.
const ALWAYS_VISIBLE_WORKSPACES = new Set<WorkspaceId>(['ai_config', 'assistant', 'platform', 'tools', 'workbench'])

/**
 * Hermes_AI owns availability. The local role only changes product wording;
 * it must never grant a server-backed Desktop surface.
 */
const SERVER_SURFACE_BY_WORKSPACE: Partial<Record<WorkspaceId, string>> = {
  conversations: 'conversations',
  governance: 'governance',
  handoffs: 'handoffs',
  knowledge: 'knowledge',
  knowledge_qa: 'knowledge_queries',
  customer_replies: 'assistant',
  reminders: 'workflows',
  overdue: 'workflows',
  receivables: 'workflows'
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

  return '等待登录企业账号'
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

function hasLiveCapability(identity: EnterpriseIdentity | undefined, capabilityId: string): boolean {
  const capability = identity?.product_capabilities?.[capabilityId]

  return capability?.enabled === true && capability.status === 'LIVE'
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

function Workbench({ snapshot, state, runtime, onStart, onTasks, onPending, onInspect, scope, showBusinessTasks, identityPanel }: {
  snapshot: ClientSnapshot | null
  state: ConnectionState
  runtime: EnterpriseClientRuntime | null
  onStart: (mode: AssistantMode) => void
  onTasks?: () => void
  onPending?: () => void
  onInspect?: (task: ReminderCenterTask) => void
  scope: string
  showBusinessTasks: boolean
  identityPanel?: ReactNode
}) {
  const web = useWebPresentation()
  const layout = useWebLayoutCopy()
  const [previewKind, setPreviewKind] = useState('overdue')
  const OverdueCard = web.enabled && onTasks ? 'button' : 'article'
  const PendingCard = web.enabled && onPending ? 'button' : 'article'
  const identity = snapshot?.identity
  const health = snapshot?.health
  const reminderState = useStore($personalReminders)
  const taskState = useStore($enterpriseReminderTasks)
  const personalReminders = reminderState?.scope === scope ? reminderState.rows.filter(row => row.state === 'active') : null
  const reminders = taskState?.scope === scope ? taskState.rows : personalReminders
  const overdue = reminders?.filter(row => isReminderCenterTask(row) ? row.overdue : row.scheduled_for <= Date.now() / 1000)
  const serviceValue = health ? (health.ok ? '正常' : '异常') : '—'
  const presentation = enterpriseWorkbenchPresentation(identity?.role)


  return (
    <section className="hesc-page" data-testid="enterprise-client-workbench">
      <header className="hesc-page-header">
        <div>
          <h1>{presentation.title}</h1>
          <p>{presentation.purpose}</p>
        </div>
        {!web.enabled || state !== 'ready' ? <EnterpriseStatusBadge tone={statusTone(state)}>{humanConnectionState(state)}</EnterpriseStatusBadge> : null}
      </header>

      <details className="hesc-workbench-shortcuts" hidden={web.enabled}>
        <summary>快捷工作</summary>
        <h2 className="hesc-section-title">快捷工作</h2>
        <p className="hesc-muted-copy">先整理内容，再确认下一步。生成结果可复制或保存为文件。</p>
        <div className="hesc-voice-actions">
          {([
            ['knowledge_question', '问知识库'],
            ['summarize', '整理资料'],
            ['rewrite', '润色文案'],
            ['extract_action_items', '提取待办']
          ] as const).map(([mode, label]) => (
            <button className="hesc-action" disabled={state !== 'ready'} key={mode} onClick={() => onStart(mode)} type="button">{label}</button>
          ))}
          {onTasks ? <button className="hesc-action" onClick={onTasks} type="button">查看任务与提醒</button> : null}
        </div>
      </details>

      <div className={web.enabled ? 'hesc-kpis web-work-kpis' : 'hesc-kpis'}>
        {!web.enabled ? <article className="hesc-card">
          <div className="hesc-card-label">企业服务</div>
          <div className="hesc-card-value">{serviceValue}</div>
          <p className="hesc-card-note">
            {health?.auth_mode ? `认证方式：${health.auth_mode}` : '等待服务端健康度响应'}
          </p>
        </article> : null}
        <OverdueCard className="hesc-card" type={OverdueCard === 'button' ? 'button' : undefined} onClick={web.enabled ? onTasks : undefined}>
          <div className="hesc-card-label">逾期未处理</div>
          <div className="hesc-card-value">{overdue?.length ?? '—'}{web.enabled ? <small> {web.words.items}</small> : null}</div>
          <p className="hesc-card-note">已到提醒时间，尚未结束或改期的事项</p>
        </OverdueCard>
        {!web.enabled ? <article className="hesc-card">
          <div className="hesc-card-label">已启用能力</div>
          <div className="hesc-card-value">{identity ? capabilityCount(identity) : '—'}</div>
          <p className="hesc-card-note">LIVE 且已启用的服务端能力</p>
        </article> : null}
        <PendingCard className="hesc-card" type={PendingCard === 'button' ? 'button' : undefined} onClick={web.enabled ? onPending : undefined}>
          <div className="hesc-card-label">待跟进事项</div>
          <div className="hesc-card-value">{reminders?.length ?? '—'}{web.enabled ? <small> {web.words.items}</small> : null}</div>
          <p className="hesc-card-note">个人提醒与应收款跟进的统一待办</p>
        </PendingCard>
      </div>

      <div className={web.enabled ? 'hesc-grid web-overview-grid' : 'hesc-grid'}>
        {identityPanel ?? <article className="hesc-card">
          <h2 className="hesc-section-title">当前身份范围</h2>
          <dl className="hesc-detail-list">
            <div>
              <dt>主体</dt>
              <dd>{identity?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>租户</dt>
              <dd>{identity?.tenant_name ?? identity?.tenant_id ?? '—'}</dd>
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
        </article>}
        <article className="hesc-card" hidden={web.enabled}>
          {web.enabled ? <>
            <h2 className="hesc-section-title">{layout.preview}</h2>
            <div className="web-section-tabs" role="group" aria-label={layout.preview}>{[['overdue',layout.overdue],['pending',layout.pending]].map(([id,label]) => <button type="button" className="hesc-action" key={id} aria-pressed={previewKind === id} onClick={() => setPreviewKind(id)}>{label}</button>)}</div>
            <div className="hesc-overdue-preview" tabIndex={0} role="region" aria-label={layout.preview}>
              {(previewKind === 'overdue' ? overdue : reminders)?.map(row => <div className="hesc-alert" key={isReminderCenterTask(row) ? `${row.source_type}:${row.source_id}` : row.reminder_id}><strong>{reminderTitle(row)}</strong><span>{reminderWhen(row, true)}</span>{onInspect && isReminderCenterTask(row) ? <button className="hesc-action" type="button" onClick={() => onInspect(row)}>{web.words.viewTasks}</button> : null}</div>)}
              {(previewKind === 'overdue' ? overdue : reminders)?.length === 0 ? <p>暂无对应任务。</p> : null}
              {!reminders ? <p role="status">正在读取提醒…</p> : null}
            </div>
            {onTasks ? <button className="hesc-action" type="button" onClick={previewKind === 'overdue' ? onTasks : onPending}>查看全部与处理提醒</button> : null}
          </> : <>
          <h2 className="hesc-section-title">逾期未处理</h2>
          <div className="hesc-overdue-preview" tabIndex={0} role="region" aria-label="逾期事项预览">{overdue?.length ? <div className="hesc-alert-list">{overdue.map(row => <div className="hesc-alert" key={isReminderCenterTask(row) ? `${row.source_type}:${row.source_id}` : row.reminder_id}><strong>{reminderTitle(row)}</strong><span>{reminderWhen(row)}</span>{web.enabled && onInspect && isReminderCenterTask(row) ? <button className="hesc-action" type="button" onClick={() => onInspect(row)}>{web.words.viewTasks}</button> : null}</div>)}</div> : <p>{reminders ? '暂无逾期事项。' : '正在读取提醒…'}</p>}
          <h2 className="hesc-section-title">待跟进事项</h2>
          {reminders?.length ? <div className="hesc-alert-list">{reminders.slice(0, 10).map(row => <div key={isReminderCenterTask(row) ? row.source_id : row.reminder_id}><strong>{reminderTitle(row)}</strong><span> · {reminderWhen(row)}</span>{web.enabled && onInspect && isReminderCenterTask(row) ? <button className="hesc-action" type="button" onClick={() => onInspect(row)}>{web.words.viewTasks}</button> : null}</div>)}</div> : <p>{reminders ? '暂无待跟进事项。' : '正在读取提醒…'}</p>}
          </div>{onTasks ? <button className="hesc-action" type="button" onClick={onTasks}>查看全部与处理提醒</button> : null}</>}        </article>
      </div>
      {web.enabled ? <details className="web-diagnostics" hidden><summary>{layout.diagnostics}</summary><p>企业服务：{serviceValue} · 已启用能力：{identity ? capabilityCount(identity) : '—'} · 认证方式：{health?.auth_mode ?? '—'}</p></details> : null}
      <OperationsOverviewPanel runtime={runtime} role={identity?.role} />
      {showBusinessTasks ? <BusinessTasksPanel principalId={identity?.principal_id} runtime={runtime} /> : null}
      {identity?.role === 'supervisor' ? <SeatRequestPanel runtime={runtime} /> : null}
    </section>
  )
}

interface PendingSeatRequest {
  request_id: string
  status: 'pending' | 'approving' | 'approved' | 'rejected'
}

/** A small tenant-admin inbox alert; it never exposes employee details outside governance. */
function PendingSeatRequestAlert({ runtime, onReview }: {
  onReview: () => void
  runtime: EnterpriseClientRuntime | null
}) {
  const [pendingCount, setPendingCount] = useState(0)
  const dismissedIds = useRef(new Set<string>())

  const refreshPending = useCallback(async () => {
    if (!runtime) {
      setPendingCount(0)
      return
    }

    try {
      const response = await runtime.get<{ requests?: PendingSeatRequest[] }>('/api/seat-requests')
      const ids = (response.requests ?? [])
        .filter(request => request.status === 'pending')
        .map(request => request.request_id)
      setPendingCount(ids.filter(id => !dismissedIds.current.has(id)).length)
    } catch {
      // A transient polling failure must not cover the active work surface.
    }
  }, [runtime])

  useEffect(() => {
    void refreshPending()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshPending()
      }
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [refreshPending])

  if (pendingCount === 0) {
    return null
  }

  return (
    <aside aria-live="assertive" className="hesc-seat-request-alert" role="status">
      <div>
        <strong>主管坐席申请待审批</strong>
        <span>当前有 {pendingCount} 条申请等待企业管理员处理。</span>
      </div>
      <div className="hesc-inline-actions">
        <button className="hesc-action" onClick={onReview} type="button">去审批</button>
        <button className="hesc-action hesc-action-secondary" onClick={() => {
          // “稍后” only silences records already seen in this browser session;
          // a newly submitted application is still surfaced by the next poll.
          void runtime?.get<{ requests?: PendingSeatRequest[] }>('/api/seat-requests').then(response => {
            for (const request of response.requests ?? []) {
              if (request.status === 'pending') {dismissedIds.current.add(request.request_id)}
            }
            setPendingCount(0)
          }).catch(() => setPendingCount(0))
        }} type="button">稍后提醒</button>
      </div>
    </aside>
  )
}

interface EnterpriseClientAppProps {
  additionalAccountActions?: ReactNode
  onBeforeLogout?: () => Promise<void>
  receivablesOverview?: ComponentType<ReceivablesOverviewProps>
  cashOverview?: ComponentType<{ runtime: EnterpriseClientRuntime; scope: string; onOpen(): void }>
  taskDetails?: ComponentType<{
    runtime: EnterpriseClientRuntime
    scope: string
    task: ReminderCenterTask
    onClose(): void
  }>
}

export function EnterpriseClientApp(props: EnterpriseClientAppProps = {}) {
  return <I18nProvider initialLocale="zh" configClient={null}><EnterprisePackageUpdateBoundary><EnterpriseClientContent {...props} /></EnterprisePackageUpdateBoundary></I18nProvider>
}

function EnterpriseClientContent({ additionalAccountActions, onBeforeLogout, receivablesOverview, taskDetails: TaskDetails, cashOverview: CashOverview }: EnterpriseClientAppProps) {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('workbench')
  const [reviewRequest, setReviewRequest] = useState(0)
  const [connectionState, setConnectionState] = useState<ConnectionState>('unavailable')
  const [error, setError] = useState<string | null>(null)
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false)
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [reminderRequest, setReminderRequest] = useState('')
  const [inboxRequest, setInboxRequest] = useState(0)
  const [selectedFollowup, setSelectedFollowup] = useState<ReminderCenterTask | null>(null)
  const generationRef = useRef(0)
  const runtimeRef = useRef<EnterpriseClientRuntime | null>(null)
  const refreshInFlight = useRef(false)
  const hasAuthority = useRef(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)

  const releaseRuntime = useCallback(() => {
    hasAuthority.current = false
    refreshInFlight.current = false
    generationRef.current += 1
    const runtime = runtimeRef.current
    runtimeRef.current = null
    releaseAssistantSession(runtime)
    return runtime?.disconnect()
  }, [])

  const releaseAuthentication = useCallback((reason: EnterpriseClientError) => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    refreshInFlight.current = false
    generationRef.current += 1
    runtimeRef.current = null
    hasAuthority.current = false
    releaseAssistantSession(runtime)
    void runtime?.disconnect()
    setSnapshot(null)
    setConnectionState('error')
    setError(reason.message)
    setReconnecting(false)
    setRecoveryAttempt(0)
  }, [])

  const refresh = useCallback(async (renewSession = false) => {
    // Focus/visibility can arrive together. A background authority check must
    // not tear down a working page, its draft store, or an in-flight answer.
    if (renewSession && refreshInFlight.current) {return}
    refreshInFlight.current = true
    const generation = generationRef.current + 1
    generationRef.current = generation
    if (!renewSession || !runtimeRef.current) {setConnectionState('loading')}
    setError(null)

    const existingRuntime = runtimeRef.current
    let runtime: EnterpriseClientRuntime | null = existingRuntime

    try {
      // Keep the already fenced main-process session alive across focus and
      // workspace switches. Password accounts have no OAuth bearer to renew;
      // replacing their session on every foreground event was the source of a
      // visible disconnect. A confirmed 401/403 still clears the session via
      // `onAuthenticationRequired`, and a cold start builds a new one here.
      runtime = !runtime
        ? await connectEnterpriseClient({ onAuthenticationRequired: releaseAuthentication })
        : runtime

      if (generation !== generationRef.current) {
        // A renewed runtime can intentionally share the same opaque session as
        // the current one. Disconnecting it here would let a superseded refresh
        // tear down the live foreground session.
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

      assistantSessionFor(runtime, identity.tenant_id, identity.principal_id, true)
      setSnapshot({ health, identity, metrics })
      hasAuthority.current = true
      setReconnecting(false)
      setRecoveryAttempt(0)
      setConnectionState('ready')
    } catch (reason) {
      if (generation !== generationRef.current) {
        return
      }

      if (reason instanceof EnterpriseLoginRequired) {
        setConnectionState('unavailable')
        setError(null)

        return
      }

      const failure = reason as EnterpriseClientError
      if (renewSession && hasAuthority.current && runtimeRef.current === runtime && isTransientConnectionFailure(failure)) {
        // Retain already-read content and the authenticated transport during a
        // transient outage. Every new operation still passes server auth/RLS.
        setReconnecting(true)
        setRecoveryAttempt(current => current + 1)
        setError('网络暂时波动，正在后台恢复连接。当前草稿与任务已保留。')
        return
      }

      if (enterpriseSessionDisposition(reason) === 'release-and-clear') {
        releaseAssistantSession(runtime)
        void runtime?.disconnect()

        if (runtimeRef.current === runtime) {
          runtimeRef.current = null
        }

        setSnapshot(null)
      }

      setConnectionState('error')
      setError(reason instanceof Error ? reason.message : 'cannot connect to enterprise service')
    } finally {
      if (generation === generationRef.current) {refreshInFlight.current = false}
    }
  }, [releaseAuthentication])

  const beginPasswordLogin = useCallback(async (loginName: string, password: string, rememberPassword = false) => {
    if (!loginName || !password) {
      return
    }

    setConnectionState('loading')
    setError(null)
    setReconnecting(false)
    setRecoveryAttempt(0)

    try {
      releaseRuntime()

      const connected = await connectEnterpriseClientWithPassword(loginName, password, {
        rememberPassword,
        onAuthenticationRequired: releaseAuthentication
      })

      runtimeRef.current = connected.runtime
      setPasswordChangeRequired(connected.mustChangePassword)
      await refresh(false)
    } catch (reason) {
      setConnectionState((reason as EnterpriseClientError)?.kind === 'invalid_credentials' ? 'unavailable' : 'error')
      setError(reason instanceof Error ? reason.message : '账号登录未完成，请检查企业网络后重试。')
    }
  }, [refresh, releaseAuthentication, releaseRuntime])

  const openRuntimeLogs = useCallback(() => {
    void window.hermesDesktop?.revealLogs()
  }, [])

  const recordEnterpriseActivity = useCallback((event: 'connection_failed' | 'connection_ready' | 'workspace_opened', workspace?: WorkspaceId) => {
    // The existing desktop diagnostic bridge deliberately accepts a fixed
    // legacy enum.  Do not expand telemetry merely because a new local page
    // exists; the configuration page is still a normal visible workspace.
    window.hermesDesktop?.reportEnterpriseActivity?.({ event, workspace: workspace === 'ai_config' || workspace === 'receivables' || workspace === 'overdue' ? undefined : workspace })
  }, [])

  useEffect(() => {
    document.title = 'Hermes-企业助手'
    window.hermesDesktop?.setTitleBarTheme?.({ background: '#0c1825', foreground: '#ffffff' })
    void refresh()

    return () => {
      const runtime = runtimeRef.current
      runtimeRef.current = null
      preserveAssistantSessionForPageReload(runtime)
      void runtime?.disconnect()
    }
  }, [refresh, releaseRuntime])

  useEffect(() => {
    if (!reconnecting || document.visibilityState !== 'visible' || !runtimeRef.current) {
      return
    }

    const timer = window.setTimeout(() => void refresh(true), connectionRecoveryDelay(recoveryAttempt))

    return () => window.clearTimeout(timer)
  }, [reconnecting, recoveryAttempt, refresh])

  useEffect(() => {
    const reconnectWhenForegrounded = () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      void refresh(true)
    }

    window.addEventListener('focus', reconnectWhenForegrounded)
    window.addEventListener('online', reconnectWhenForegrounded)
    const timer = window.setInterval(() => {
      if (runtimeRef.current && document.visibilityState === 'visible') {
        void refresh(true)
      }
    }, 30_000)
    document.addEventListener('visibilitychange', reconnectWhenForegrounded)

    return () => {
      window.removeEventListener('focus', reconnectWhenForegrounded)
      window.removeEventListener('online', reconnectWhenForegrounded)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reconnectWhenForegrounded)
    }
  }, [refresh])

  useEffect(() => {
    if (connectionState === 'ready') {
      recordEnterpriseActivity('connection_ready')
    }

    if (connectionState === 'error') {
      recordEnterpriseActivity('connection_failed')
    }
  }, [connectionState, recordEnterpriseActivity])

  const authoritySnapshot = currentAuthoritySnapshot(snapshot, connectionState)
  const authorityRuntime = connectionState === 'ready' ? runtimeRef.current : null

  const visibleWorkspaces = useMemo(
    () => workspacesFor(authoritySnapshot?.identity),
    [authoritySnapshot?.identity]
  )

  useEffect(() => {
    if (!visibleWorkspaces.some(workspace => workspace.id === activeWorkspace)) {
      setActiveWorkspace('workbench')
    }
  }, [activeWorkspace, visibleWorkspaces])

  useEffect(() => {
    if (connectionState === 'ready' && visibleWorkspaces.some(workspace => workspace.id === activeWorkspace)) {
      recordEnterpriseActivity('workspace_opened', activeWorkspace)
    }
  }, [activeWorkspace, connectionState, recordEnterpriseActivity, visibleWorkspaces])

  if (!snapshot && connectionState !== 'ready') {
    return (
      <EnterpriseLoginPage
        busy={connectionState === 'loading'}
        error={error}
        onLogin={(loginName, password, rememberPassword) => void beginPasswordLogin(loginName, password, rememberPassword)}
        onOpenLogs={openRuntimeLogs}
        status={humanConnectionState(connectionState)}
      />
    )
  }

  const activeDefinition = visibleWorkspaces.find(workspace => workspace.id === activeWorkspace) ?? visibleWorkspaces[0]!

  if (passwordChangeRequired && authorityRuntime) {
    return (
      <EnterprisePasswordChangePage
        error={error}
        onComplete={async (currentPassword, newPassword) => {
          try {
            setError(null)

            if (!authorityRuntime.post) {
              throw new Error('当前企业服务不支持密码修改')
            }

            await authorityRuntime.post('/api/password-change', {
              current_password: currentPassword,
              new_password: newPassword
            })
            setPasswordChangeRequired(false)
            await refresh(false)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '密码修改未完成')
          }
        }}
      />
    )
  }

  return (
    <EnterpriseClientShell
      accountActions={authorityRuntime ? <>{additionalAccountActions}<AccountControls
        key={authoritySnapshot?.identity.principal_id}
        runtime={authorityRuntime}
        onLogout={async () => {
          // Browser cookie logout is explicit, not runtime teardown (which also
          // occurs during StrictMode cleanup and reconnection). Keep the UI
          // authenticated and recoverable if the server cannot confirm logout.
          await onBeforeLogout?.()
          await window.hermesDesktop?.enterprise?.rememberedLogin?.(true)
          const disconnected = releaseRuntime()
          setSnapshot(null); setPasswordChangeRequired(false); setError(null)
          setReconnecting(false); setRecoveryAttempt(0); setConnectionState('unavailable')
          setRemindersOpen(false); setReminderRequest(''); setSelectedFollowup(null); setActiveWorkspace('workbench')
          $enterpriseReminderTasks.set(null); $personalReminders.set(null)
          await disconnected
        }}
      /></> : null}
      activeWorkspace={activeDefinition}
      connectionState={reconnecting ? 'loading' : connectionState}
      connectionStatus={reconnecting ? '正在恢复连接 · 工作已保留' : humanConnectionState(connectionState)}
      identityName={authoritySnapshot?.identity.name ?? '企业工作空间'}
      navigationLabel="企业客户端主导航"
      onSelectWorkspace={workspaceId => {
        const workspace = workspaceId as WorkspaceId

        if (visibleWorkspaces.some(candidate => candidate.id === workspace)) {
          setReviewRequest(0)
          if (workspace === 'assistant' || workspace === 'knowledge_qa' || workspace === 'customer_replies') {
            assistantSessionFor(authorityRuntime, authoritySnapshot?.identity.tenant_id, authoritySnapshot?.identity.principal_id).mode.set(
              workspace === 'knowledge_qa' ? 'knowledge_question' : workspace === 'customer_replies' ? 'customer_reply' : 'chat')
          }
          setActiveWorkspace(workspace)
        }
      }}
      productChannel="企业工作台"
      productName="Hermes-企业助手"
      scopeLabel={enterpriseRoleLabel(authoritySnapshot?.identity.role)}
      statusbarDetail="安全连接 · 服务端权限"
      statusbarLabel="Hermes-企业助手"
      tenantLabel={authoritySnapshot?.identity.tenant_name ?? authoritySnapshot?.identity.tenant_id ?? (
        authoritySnapshot?.identity.role === 'super_admin' ? '平台级全局范围' : '正在解析租户范围'
      )}
      workspaces={visibleWorkspaces}
    >
        {error ? (
          <section
            aria-live={reconnecting ? 'polite' : 'assertive'}
            className="hesc-connection-error"
            data-recovering={reconnecting ? 'true' : 'false'}
            role={reconnecting ? 'status' : 'alert'}
          >
            <div className="hesc-connection-error-copy">
              <EnterpriseStatusBadge tone={reconnecting ? 'warning' : 'error'}>
                {reconnecting ? '正在恢复' : '连接需要处理'}
              </EnterpriseStatusBadge>
              <div>
                <strong>{reconnecting ? '企业服务暂时不可达，工作内容已保留' : '无法读取企业服务状态'}</strong>
                <span>{error}</span>
              </div>
            </div>
            <div className="hesc-connection-error-actions">
              <button className="hesc-action" onClick={() => void refresh(true)} type="button">
                {reconnecting ? '立即重试' : '重试连接'}
              </button>
              <button className="hesc-log-action" onClick={openRuntimeLogs} type="button">
                打开运行日志
              </button>
            </div>
          </section>
        ) : null}
        {activeDefinition.id === 'platform' ? <PlatformPage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'workbench' ? (
          <Workbench
            identityPanel={CashOverview && authorityRuntime && visibleWorkspaces.some(item => item.id === 'receivables') ? <CashOverview
              runtime={authorityRuntime}
              scope={JSON.stringify([authorityRuntime.serverOrigin, authoritySnapshot?.identity.tenant_id, authoritySnapshot?.identity.principal_id])}
              onOpen={() => setActiveWorkspace('receivables')}
            /> : undefined}
            scope={JSON.stringify([authorityRuntime?.serverOrigin, authoritySnapshot?.identity.tenant_id, authoritySnapshot?.identity.principal_id])}
            onStart={mode => {
              assistantSessionFor(authorityRuntime, authoritySnapshot?.identity.tenant_id, authoritySnapshot?.identity.principal_id).mode.set(mode)
              setActiveWorkspace(mode === 'customer_reply' ? 'customer_replies' : 'assistant')
            }}
            onTasks={visibleWorkspaces.some(item => item.id === 'overdue') ? () => setActiveWorkspace('overdue') : undefined}
            onPending={visibleWorkspaces.some(item => item.id === 'reminders') ? () => {setInboxRequest(value => value + 1);setActiveWorkspace('reminders')} : undefined}
            onInspect={TaskDetails ? task => setSelectedFollowup(task) : undefined}
            snapshot={authoritySnapshot}
            state={connectionState}
            runtime={authorityRuntime}
            showBusinessTasks={hasLiveCapability(authoritySnapshot?.identity, 'team_tasks')}
          />
        ) : null}
        {authoritySnapshot?.identity.tenant_id ? (
          <div hidden={!['assistant', 'knowledge_qa', 'customer_replies'].includes(activeDefinition.id)}>
          <AssistantPage
            separatedNavigation
            onRemind={request => {setReminderRequest(request); setRemindersOpen(true)}}
            principalId={authoritySnapshot?.identity.principal_id}
            runtime={authorityRuntime}
            tenantId={authoritySnapshot?.identity.tenant_id}
          />
          </div>
        ) : null}
        {activeDefinition.id === 'conversations' ? <ConversationsPage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'handoffs' ? (
          <HandoffsPage principalId={authoritySnapshot?.identity.principal_id} runtime={authorityRuntime} />
        ) : null}
        {activeDefinition.id === 'governance' ? <GovernancePage runtime={authorityRuntime} reviewRequest={reviewRequest} /> : null}
        {activeDefinition.id === 'knowledge' ? <KnowledgePage runtime={authorityRuntime} /> : null}
        {activeDefinition.id === 'tools' ? <ToolsPage runtime={authorityRuntime} role={authoritySnapshot?.identity.role} /> : null}
        {activeDefinition.id === 'overdue' && authorityRuntime && authoritySnapshot ? <OverduePage
          key={`${authorityRuntime.serverOrigin}:${authoritySnapshot.identity.tenant_id}:${authoritySnapshot.identity.principal_id}`}
          scope={JSON.stringify([authorityRuntime.serverOrigin,authoritySnapshot.identity.tenant_id,authoritySnapshot.identity.principal_id])}
          principalId={authoritySnapshot.identity.principal_id ?? ''}
          onInspect={task => {if (TaskDetails || task.source_type === 'receivable_followup') {setSelectedFollowup(task);setRemindersOpen(true)} else {setSelectedFollowup(null);setActiveWorkspace('reminders')}}}/>:null}
        {activeDefinition.id === 'ai_config' ? <AiConfigurationPage runtime={authorityRuntime} /> : null}
        {authorityRuntime && authoritySnapshot?.identity.principal_id && visibleWorkspaces.some(item => item.id === 'receivables') ? <div hidden={activeDefinition.id !== 'receivables'}>
          <ReceivablesPage key={authoritySnapshot.identity.principal_id} runtime={authorityRuntime}
            Overview={receivablesOverview}
            principalId={authoritySnapshot.identity.principal_id}
            scope={JSON.stringify([authorityRuntime.serverOrigin, authoritySnapshot.identity.tenant_id, authoritySnapshot.identity.principal_id])}
            onInspect={task => {setSelectedFollowup(task); setRemindersOpen(true)}} />
        </div> : null}
        {authoritySnapshot?.identity.role === 'tenant_admin' ? <PendingSeatRequestAlert
          runtime={authorityRuntime}
          onReview={() => { setReviewRequest(value => value + 1); setActiveWorkspace('governance') }}
        /> : null}
        {authorityRuntime && authoritySnapshot?.identity.tenant_id ? <AssistantReminders
          key={`${authoritySnapshot.identity.tenant_id}:${authoritySnapshot.identity.principal_id}`}
          runtime={authorityRuntime}
          scope={JSON.stringify([authorityRuntime.serverOrigin, authoritySnapshot.identity.tenant_id, authoritySnapshot.identity.principal_id])}
          inline={activeDefinition.id === 'reminders'}
          open={(remindersOpen && !(TaskDetails && selectedFollowup)) || activeDefinition.id === 'reminders'}
          request={reminderRequest}
          inboxRequest={inboxRequest}
          selectedFollowup={TaskDetails ? null : selectedFollowup}
          onInspect={TaskDetails ? task => {setSelectedFollowup(task);setRemindersOpen(false)} : undefined}
          history={<>
            {authoritySnapshot.identity.effective_permissions?.some(p => ['*', 'tenant.*', 'tenant.ai.*', 'tenant.ai.assist'].includes(p)) ? <DeliveryHistory runtime={authorityRuntime} kind="reminders" /> : null}
            {authoritySnapshot.identity.effective_permissions?.some(p => ['*', 'delivery.*', 'delivery.read'].includes(p)) ? <DeliveryHistory runtime={authorityRuntime} kind="outbox" /> : null}
          </>}
          onClose={() => {setRemindersOpen(false);setReminderRequest('');setSelectedFollowup(null)}}
        /> : null}
        {TaskDetails && selectedFollowup && authorityRuntime && authoritySnapshot?.identity.tenant_id ? <TaskDetails
          key={`${selectedFollowup.source_type}:${selectedFollowup.source_id}`}
          runtime={authorityRuntime}
          scope={JSON.stringify([authorityRuntime.serverOrigin, authoritySnapshot.identity.tenant_id, authoritySnapshot.identity.principal_id])}
          task={selectedFollowup}
          onClose={() => {setRemindersOpen(false);setSelectedFollowup(null)}}
        /> : null}
        {activeDefinition.id !== 'assistant' &&
        activeDefinition.id !== 'knowledge_qa' &&
        activeDefinition.id !== 'customer_replies' &&
        activeDefinition.id !== 'conversations' &&
        activeDefinition.id !== 'governance' &&
        activeDefinition.id !== 'handoffs' &&
        activeDefinition.id !== 'knowledge' &&
        activeDefinition.id !== 'ai_config' &&
        activeDefinition.id !== 'tools' &&
        activeDefinition.id !== 'platform' &&
        activeDefinition.id !== 'reminders' &&
        activeDefinition.id !== 'receivables' &&
        activeDefinition.id !== 'overdue' &&
        activeDefinition.id !== 'workbench' ? (
          <WorkspacePlaceholder workspace={activeDefinition} />
        ) : null}
    </EnterpriseClientShell>
  )
}
