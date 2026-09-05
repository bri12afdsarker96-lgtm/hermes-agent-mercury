import { useEffect, useMemo, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface Tenant {
  active_operator_count?: number
  name?: string
  operator_seat_limit?: number
  status?: string
  tenant_id?: string
}

interface Principal {
  login_name?: string | null
  name?: string
  principal_id?: string
  role?: string
  status?: string
  tenant_id?: string | null
}

interface TenantAiStatus {
  configured?: boolean
  encryption_ready?: boolean
  model?: string
  provider?: string
  providers?: Array<{ default_model?: string; key?: string; label?: string }>
  version?: number
}

interface TenantListResponse { tenants?: Tenant[] }
interface PrincipalListResponse { principals?: Principal[] }
interface CreatedPrincipal extends Principal { temporary_password?: string }

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'
type TenantAction = { kind: 'delete' | 'pause' | 'resume'; tenant: Tenant } | null

function stateLabel(state: LoadState): string {
  return state === 'loading' ? '正在读取' : state === 'ready' ? '已连接' : state === 'error' ? '读取失败' : '等待企业服务连接'
}

function tenantStatus(status: string | undefined): string {
  return status === 'active' ? '已启用' : status === 'paused' || status === 'suspended' ? '已暂停' : (status || '状态未知')
}

function roleLabel(role: string | undefined): string {
  return role === 'tenant_admin' ? '企业管理员' : role === 'supervisor' ? '运营主管' : role === 'operator' ? '坐席' : role === 'super_admin' ? '平台管理员' : (role || '—')
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

/** Platform metadata governance. No tenant business data is queried here. */
export function PlatformPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [adminLoginName, setAdminLoginName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiConfig, setAiConfig] = useState<TenantAiStatus | null>(null)
  const [aiConsent, setAiConsent] = useState(false)
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiProvider, setAiProvider] = useState('')
  const [credentials, setCredentials] = useState<CreatedPrincipal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pendingAction, setPendingAction] = useState<TenantAction>(null)
  const [principals, setPrincipals] = useState<Principal[]>([])
  const [seatEdits, setSeatEdits] = useState<Record<string, string>>({})
  const [seatLimit, setSeatLimit] = useState('10')
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [state, setState] = useState<LoadState>('unavailable')
  const [submitting, setSubmitting] = useState(false)
  const [tenants, setTenants] = useState<Tenant[]>([])

  const selectedTenant = useMemo(
    () => tenants.find(tenant => tenant.tenant_id === selectedTenantId) ?? null,
    [selectedTenantId, tenants]
  )

  async function refreshPlatform() {
    if (!runtime) return
    const [tenantData, principalData] = await Promise.all([
      runtime.get<TenantListResponse>('/api/tenants'),
      runtime.get<PrincipalListResponse>('/api/principals')
    ])
    const nextTenants = tenantData.tenants ?? []
    setTenants(nextTenants)
    setPrincipals(principalData.principals ?? [])
    setSeatEdits(current => Object.fromEntries(nextTenants.map(tenant => {
      const id = tenant.tenant_id ?? ''
      return [id, current[id] ?? String(tenant.operator_seat_limit ?? 10)]
    })))
  }

  useEffect(() => {
    let mounted = true
    if (!runtime) {
      setTenants([])
      setPrincipals([])
      setState('unavailable')
      return () => { mounted = false }
    }
    setError(null)
    setState('loading')
    void refreshPlatform().then(() => {
      if (mounted) setState('ready')
    }).catch(reason => {
      if (!mounted) return
      setState('error')
      setError(errorText(reason, 'cannot load platform governance'))
    })
    return () => { mounted = false }
  }, [runtime])

  useEffect(() => {
    let mounted = true
    if (!runtime || !selectedTenantId) {
      setAiConfig(null)
      return () => { mounted = false }
    }
    setAiConfig(null)
    void runtime.get<TenantAiStatus>(`/api/platform-tenant-ai-config?tenant_id=${encodeURIComponent(selectedTenantId)}`)
      .then(config => {
        if (!mounted) return
        setAiConfig(config)
        setAiProvider(config.provider ?? config.providers?.[0]?.key ?? '')
        setAiModel(config.model ?? config.providers?.[0]?.default_model ?? '')
        setAiBaseUrl('')
      })
      .catch(reason => { if (mounted) setError(errorText(reason, 'cannot load tenant AI configuration status')) })
    return () => { mounted = false }
  }, [runtime, selectedTenantId])

  async function perform(work: () => Promise<void>) {
    if (!runtime?.post || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await work()
      await refreshPlatform()
      setState('ready')
    } catch (reason) {
      setError(errorText(reason, 'platform operation did not complete'))
    } finally {
      setSubmitting(false)
    }
  }

  async function createTenant() {
    const tenantName = name.trim()
    if (!runtime?.post || !tenantName) return
    await perform(async () => {
      await runtime.post?.('/api/tenants', { name: tenantName, operator_seat_limit: seatLimit })
      setName('')
      setSeatLimit('10')
    })
  }

  async function createTenantAdmin() {
    const principalName = adminName.trim()
    const loginName = adminLoginName.trim()
    if (!runtime?.post || !selectedTenantId || !principalName || !loginName) return
    const post = runtime.post
    await perform(async () => {
      const created = await post<CreatedPrincipal>('/api/principals', {
        login_name: loginName, name: principalName, role: 'tenant_admin', tenant_id: selectedTenantId
      })
      setCredentials(created)
      setAdminName('')
      setAdminLoginName('')
    })
  }

  async function updateSeatLimit(tenant: Tenant) {
    if (!runtime?.post || !tenant.tenant_id) return
    const post = runtime.post
    const tenantId = tenant.tenant_id
    await perform(async () => {
      await post('/api/tenant-operator-seat-limit', {
        operator_seat_limit: seatEdits[tenantId] ?? tenant.operator_seat_limit ?? 10,
        tenant_id: tenantId
      })
    })
  }

  async function confirmTenantAction() {
    const action = pendingAction
    if (!runtime?.post || !action?.tenant.tenant_id) return
    setPendingAction(null)
    await perform(async () => {
      if (action.kind === 'delete') {
        await runtime.post?.('/api/tenants-delete', { tenant_id: action.tenant.tenant_id })
      } else {
        await runtime.post?.('/api/tenant-status', {
          status: action.kind === 'pause' ? 'paused' : 'active', tenant_id: action.tenant.tenant_id
        })
      }
    })
  }

  async function revokePrincipal(principalId: string | undefined) {
    if (!runtime?.post || !principalId) return
    await perform(async () => { await runtime.post?.('/api/principals-delete', { principal_id: principalId }) })
  }

  async function saveAssistedAiConfig() {
    if (!runtime?.post || !selectedTenantId || !aiConsent) return
    const post = runtime.post
    const submittedKey = aiKey
    setAiKey('')
    await perform(async () => {
      const result = await post<TenantAiStatus>('/api/platform-tenant-ai-config', {
        api_key: submittedKey, assistance_confirmed: true, base_url: aiBaseUrl || undefined,
        model: aiModel, provider: aiProvider, tenant_id: selectedTenantId
      })
      setAiConfig(result)
      setAiConsent(false)
    })
  }

  return (
    <section className="hesc-page" data-testid="enterprise-client-platform">
      <header className="hesc-page-header">
        <div><h1>平台治理</h1><p>管理租户生命周期、企业管理员账号和坐席容量；平台不会读取任一企业的会话、知识或业务审计内容。</p></div>
        <span className="hesc-status" data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}>{stateLabel(state)}</span>
      </header>

      {error ? <div className="hesc-error" role="status"><div><strong>平台治理操作未完成</strong><span>{error}</span></div><button className="hesc-action" onClick={() => void refreshPlatform()} type="button">重新读取</button></div> : null}

      <div className="hesc-grid hesc-platform-provision-grid">
        <article className="hesc-card"><h2 className="hesc-section-title">开通企业租户</h2><p className="hesc-muted-copy">创建时同时保存坐席容量上限；服务端会在创建坐席时原子执行该额度。</p>
          <form className="hesc-provisioning-form" onSubmit={event => { event.preventDefault(); void createTenant() }}>
            <label>企业名称<input autoComplete="organization" disabled={submitting || !runtime?.post} onChange={event => setName(event.target.value)} placeholder="例如：早鸟科技" value={name} /></label>
            <label>可用坐席上限<input disabled={submitting || !runtime?.post} inputMode="numeric" min="1" onChange={event => setSeatLimit(event.target.value)} type="number" value={seatLimit} /></label>
            <button className="hesc-action" disabled={!name.trim() || !seatLimit || submitting || !runtime?.post} type="submit">开通企业并设置容量</button>
          </form>
        </article>
        <article className="hesc-card"><h2 className="hesc-section-title">创建首位企业管理员</h2><p className="hesc-muted-copy">开通企业后签发独立登录账号；初始密码只显示一次，首次登录必须修改。</p>
          <form className="hesc-provisioning-form" onSubmit={event => { event.preventDefault(); void createTenantAdmin() }}>
            <label>目标企业<select disabled={submitting || !runtime?.post || tenants.length === 0} onChange={event => setSelectedTenantId(event.target.value)} value={selectedTenantId}><option value="">请选择企业</option>{tenants.map(tenant => <option key={tenant.tenant_id} value={tenant.tenant_id ?? ''}>{tenant.name ?? tenant.tenant_id}</option>)}</select></label>
            <label>企业管理员姓名<input autoComplete="name" disabled={submitting || !runtime?.post} onChange={event => setAdminName(event.target.value)} value={adminName} /></label>
            <label>企业登录账号<input autoComplete="username" disabled={submitting || !runtime?.post} onChange={event => setAdminLoginName(event.target.value)} placeholder="例如：acme.admin" value={adminLoginName} /></label>
            <button className="hesc-action" disabled={!selectedTenantId || !adminName.trim() || !adminLoginName.trim() || submitting || !runtime?.post} type="submit">签发企业管理员账号</button>
          </form>
          {credentials ? <div className="hesc-provisioning-token" role="status"><strong>请通过受控渠道交付一次性登录凭据</strong><code>账号：{credentials.login_name ?? '—'}</code><code>初始密码：{credentials.temporary_password ?? '—'}</code><button className="hesc-action" onClick={() => setCredentials(null)} type="button">已安全保存，隐藏凭据</button></div> : null}
        </article>
      </div>

      <article className="hesc-card hesc-platform-card"><div className="hesc-section-heading"><div><h2 className="hesc-section-title">企业租户与坐席容量</h2><p className="hesc-muted-copy">表格固定高度并独立滚动；企业数量增加不会挤出窗口或遮挡操作。</p></div></div>
        {state === 'loading' ? <p className="hesc-muted-copy">正在读取企业租户…</p> : null}
        {state === 'ready' && tenants.length === 0 ? <p className="hesc-muted-copy">当前尚未开通企业租户。</p> : null}
        {tenants.length > 0 ? <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table hesc-platform-table"><thead><tr><th scope="col">企业</th><th scope="col">租户标识</th><th scope="col">状态</th><th scope="col">坐席占用</th><th scope="col">调整上限</th><th scope="col">生命周期</th></tr></thead><tbody>{tenants.map((tenant, index) => {
          const id = tenant.tenant_id ?? `tenant-${index}`
          return <tr key={id}><td>{tenant.name ?? '—'}</td><td>{tenant.tenant_id ?? '—'}</td><td><span className="hesc-status" data-tone={tenant.status === 'active' ? 'success' : 'warning'}>{tenantStatus(tenant.status)}</span></td><td>{tenant.active_operator_count ?? 0} / {tenant.operator_seat_limit ?? 10}</td><td><div className="hesc-inline-action"><input aria-label={`${tenant.name ?? id} 的坐席上限`} disabled={submitting} min="1" onChange={event => setSeatEdits(current => ({ ...current, [id]: event.target.value }))} type="number" value={seatEdits[id] ?? String(tenant.operator_seat_limit ?? 10)} /><button className="hesc-action" disabled={submitting || !tenant.tenant_id} onClick={() => void updateSeatLimit(tenant)} type="button">保存</button></div></td><td><div className="hesc-inline-action">{tenant.status === 'active' ? <button className="hesc-action" disabled={submitting} onClick={() => setPendingAction({ kind: 'pause', tenant })} type="button">暂停</button> : <button className="hesc-action" disabled={submitting} onClick={() => setPendingAction({ kind: 'resume', tenant })} type="button">启用</button>}<button className="hesc-action hesc-action-danger" disabled={submitting} onClick={() => setPendingAction({ kind: 'delete', tenant })} type="button">删除</button></div></td></tr>
        })}</tbody></table></div> : null}
      </article>

      <div className="hesc-grid hesc-platform-governance-grid">
        <article className="hesc-card"><h2 className="hesc-section-title">企业 AI 协助配置</h2><p className="hesc-muted-copy">企业管理员自行配置为默认流程。仅在企业明确授权时，平台才可代为保存；密钥只驻留服务器加密存储，不能回显。</p>
          <div className="hesc-provisioning-form">
            <label>协助企业<select disabled={submitting || tenants.length === 0} onChange={event => setSelectedTenantId(event.target.value)} value={selectedTenantId}><option value="">请选择企业</option>{tenants.map(tenant => <option key={tenant.tenant_id} value={tenant.tenant_id ?? ''}>{tenant.name ?? tenant.tenant_id}</option>)}</select></label>
            {selectedTenant ? <p className="hesc-muted-copy">当前状态：{aiConfig?.configured ? `已配置 ${aiConfig.provider ?? 'AI 厂商'}（版本 ${aiConfig.version ?? '—'}）` : aiConfig?.encryption_ready ? '尚未配置' : '服务器加密存储未就绪'}</p> : null}
            <label>AI 厂商<select disabled={submitting || !selectedTenantId} onChange={event => { const provider = event.target.value; setAiProvider(provider); const catalog = aiConfig?.providers?.find(item => item.key === provider); if (catalog?.default_model) setAiModel(catalog.default_model) }} value={aiProvider}><option value="">请选择厂商</option>{aiConfig?.providers?.map(provider => <option key={provider.key} value={provider.key}>{provider.label ?? provider.key}</option>)}</select></label>
            <label>模型<input disabled={submitting || !selectedTenantId} onChange={event => setAiModel(event.target.value)} value={aiModel} /></label>
            <label>Base URL（可选）<input disabled={submitting || !selectedTenantId} onChange={event => setAiBaseUrl(event.target.value)} placeholder="留空使用厂商默认地址" value={aiBaseUrl} /></label>
            <label>企业 AI 密钥<input autoComplete="off" disabled={submitting || !selectedTenantId} onChange={event => setAiKey(event.target.value)} placeholder="仅用于本次安全保存，不会回显" type="password" value={aiKey} /></label>
            <label className="hesc-checkbox-control"><input checked={aiConsent} disabled={submitting || !selectedTenantId} onChange={event => setAiConsent(event.target.checked)} type="checkbox" />企业已明确授权平台代为保存该 AI 配置</label>
            <button className="hesc-action" disabled={submitting || !selectedTenantId || !aiProvider || !aiModel || !aiKey || !aiConsent} onClick={() => void saveAssistedAiConfig()} type="button">安全保存企业 AI 配置</button>
          </div>
        </article>
        <article className="hesc-card"><h2 className="hesc-section-title">平台账号目录</h2><p className="hesc-muted-copy">账号状态来自服务端；撤销会立即使其会话失效。平台只可见账号元数据，不展示企业业务内容。</p>
          <div className="hesc-table-wrap hesc-scroll-region hesc-scroll-region-compact"><table className="hesc-table"><thead><tr><th scope="col">姓名</th><th scope="col">登录账号</th><th scope="col">角色</th><th scope="col">租户</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>{principals.map((principal, index) => <tr key={principal.principal_id ?? `principal-${index}`}><td>{principal.name ?? '—'}</td><td>{principal.login_name ?? '—'}</td><td>{roleLabel(principal.role)}</td><td>{principal.tenant_id ?? '平台'}</td><td>{principal.status === 'active' ? '已启用' : principal.status ?? '—'}</td><td><button className="hesc-action hesc-action-danger" disabled={submitting || !principal.principal_id || principal.role === 'super_admin'} onClick={() => void revokePrincipal(principal.principal_id)} type="button">撤销</button></td></tr>)}</tbody></table></div>
        </article>
      </div>

      {pendingAction ? <div aria-modal="true" className="hesc-dialog-backdrop" role="dialog"><div className="hesc-dialog"><h2>{pendingAction.kind === 'delete' ? '删除企业租户' : pendingAction.kind === 'pause' ? '暂停企业租户' : '启用企业租户'}</h2><p>{pendingAction.kind === 'delete' ? `将软删除“${pendingAction.tenant.name ?? pendingAction.tenant.tenant_id}”，其账号将不能继续登录；审计留存不会被删除。` : `确认要${pendingAction.kind === 'pause' ? '暂停' : '启用'}“${pendingAction.tenant.name ?? pendingAction.tenant.tenant_id}”吗？`}</p><div className="hesc-dialog-actions"><button className="hesc-action" disabled={submitting} onClick={() => setPendingAction(null)} type="button">取消</button><button className={pendingAction.kind === 'delete' ? 'hesc-action hesc-action-danger' : 'hesc-action'} disabled={submitting} onClick={() => void confirmTenantAction()} type="button">确认执行</button></div></div></div> : null}
    </section>
  )
}
