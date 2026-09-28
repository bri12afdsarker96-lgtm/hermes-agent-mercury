import { LoginCredentials } from './login-credentials'
import { useEffect, useMemo, useState } from 'react'

import { EnterpriseModalDialog } from './enterprise-design-system'
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

interface CreatedPrincipal extends Principal { temporary_password?: string }

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'
type TenantAction = { kind: 'delete' | 'pause' | 'resume'; tenant: Tenant } | null

function stateLabel(state: LoadState): string {
  return state === 'loading' ? '正在读取' : state === 'ready' ? '已连接' : state === 'error' ? '读取失败' : '等待企业服务连接'
}

function tenantStatus(status: string | undefined): string {
  return status === 'active' ? '已启用' : status === 'paused' || status === 'suspended' ? '已暂停' : (status || '状态未知')
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
  const [notice, setNotice] = useState<string | null>(null)
  const [usage, setUsage] = useState<(Tenant & { uploaded_document_count: number; uploaded_bytes: number; parsed_chunk_count: number }) | null>(null)
  const [name, setName] = useState('')
  const [pendingAction, setPendingAction] = useState<TenantAction>(null)
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
    if (!runtime) {return}

    const tenantData = await runtime.get<TenantListResponse>('/api/tenants')

    const nextTenants = tenantData.tenants ?? []
    setTenants(nextTenants)
    setSeatEdits(current => Object.fromEntries(nextTenants.map(tenant => {
      const id = tenant.tenant_id ?? ''

      return [id, current[id] ?? String(tenant.operator_seat_limit ?? 10)]
    })))
  }

  useEffect(() => {
    let mounted = true

    if (!runtime) {
      setTenants([])
      setState('unavailable')

      return () => { mounted = false }
    }

    setError(null)
    setState('loading')
    void refreshPlatform().then(() => {
      if (mounted) {setState('ready')}
    }).catch(reason => {
      if (!mounted) {return}
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
        if (!mounted) {return}
        setAiConfig(config)
        setAiProvider(config.provider ?? config.providers?.[0]?.key ?? '')
        setAiModel(config.model ?? config.providers?.[0]?.default_model ?? '')
        setAiBaseUrl('')
      })
      .catch(reason => { if (mounted) {setError(errorText(reason, 'cannot load tenant AI configuration status'))} })

    return () => { mounted = false }
  }, [runtime, selectedTenantId])

  async function perform(work: () => Promise<void>) {
    if (!runtime?.post || submitting) {return}
    setError(null)
    setSubmitting(true)
    setNotice(null)

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

    if (!runtime?.post || !tenantName) {return}
    await perform(async () => {
      await runtime.post?.('/api/tenants', { name: tenantName, operator_seat_limit: seatLimit })
      setName('')
      setSeatLimit('10')
    })
  }

  async function createTenantAdmin() {
    const principalName = adminName.trim()
    const loginName = adminLoginName.trim()

    if (!runtime?.post || !selectedTenantId || !principalName || !loginName) {return}
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
    if (!runtime?.post || !tenant.tenant_id) {return}
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

    if (!runtime?.post || !action?.tenant.tenant_id) {return}
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

  async function saveAssistedAiConfig() {
    if (!runtime?.post || !selectedTenantId || !aiConsent) {return}
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
      setNotice(`已为“${selectedTenant?.name ?? selectedTenantId}”保存 AI 配置，密钥已加密保存在服务器。`)
    })
  }

  return (
    <section className="hesc-page" data-testid="enterprise-client-platform">
      <header className="hesc-page-header">
        <div><h1>平台治理</h1><p>管理租户生命周期、企业管理员账号和坐席容量；平台不会读取任一企业的会话、知识或业务审计内容。</p></div>
        <span className="hesc-status" data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}>{stateLabel(state)}</span>
      </header>

      {error ? <div className="hesc-error" role="status"><div><strong>平台治理操作未完成</strong><span>{error}</span></div><button className="hesc-action" onClick={() => void refreshPlatform()} type="button">重新读取</button></div> : null}
      {notice ? <p className="hesc-success-copy" role="status">{notice}</p> : null}

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
          {credentials ? <LoginCredentials key={credentials.login_name} login={credentials.login_name ?? ''} password={credentials.temporary_password ?? ''} hideLabel="已安全保存，隐藏凭据" onHide={() => setCredentials(null)} /> : null}
        </article>
      </div>

      <article className="hesc-card hesc-platform-card"><div className="hesc-section-heading"><div><h2 className="hesc-section-title">企业租户与坐席容量</h2><p className="hesc-muted-copy">表格固定高度并独立滚动；企业数量增加不会挤出窗口或遮挡操作。</p></div></div>
        {state === 'loading' ? <p className="hesc-muted-copy">正在读取企业租户…</p> : null}
        {state === 'ready' && tenants.length === 0 ? <p className="hesc-muted-copy">当前尚未开通企业租户。</p> : null}
        {tenants.length > 0 ? <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table hesc-platform-table"><thead><tr><th scope="col">企业</th><th scope="col">租户标识</th><th scope="col">状态</th><th scope="col">坐席占用</th><th scope="col">调整上限</th><th scope="col">生命周期</th></tr></thead><tbody>{tenants.map((tenant, index) => {
          const id = tenant.tenant_id ?? `tenant-${index}`

          return <tr key={id}><td><button className="hesc-text-action" type="button" onClick={() => void runtime?.get<Tenant & { uploaded_document_count: number; uploaded_bytes: number; parsed_chunk_count: number }>(`/api/platform-tenant-usage?tenant_id=${encodeURIComponent(id)}`).then(setUsage).catch(reason => setError(errorText(reason, "企业用量暂时不可用")))}>{tenant.name ?? "—"}</button></td><td>{tenant.tenant_id ?? '—'}</td><td><span className="hesc-status" data-tone={tenant.status === 'active' ? 'success' : 'warning'}>{tenantStatus(tenant.status)}</span></td><td>{tenant.active_operator_count ?? 0} / {tenant.operator_seat_limit ?? 10}</td><td><div className="hesc-inline-action"><input aria-label={`${tenant.name ?? id} 的坐席上限`} disabled={submitting} min="1" onChange={event => setSeatEdits(current => ({ ...current, [id]: event.target.value }))} type="number" value={seatEdits[id] ?? String(tenant.operator_seat_limit ?? 10)} /><button className="hesc-action" disabled={submitting || !tenant.tenant_id} onClick={() => void updateSeatLimit(tenant)} type="button">保存</button></div></td><td><div className="hesc-inline-action">{tenant.status === 'active' ? <button className="hesc-action" disabled={submitting} onClick={() => setPendingAction({ kind: 'pause', tenant })} type="button">暂停</button> : <button className="hesc-action" disabled={submitting} onClick={() => setPendingAction({ kind: 'resume', tenant })} type="button">启用</button>}<button className="hesc-action hesc-action-danger" disabled={submitting} onClick={() => setPendingAction({ kind: 'delete', tenant })} type="button">删除</button></div></td></tr>
        })}</tbody></table></div> : null}
      </article>

      <div className="hesc-grid hesc-platform-governance-grid">
        <article className="hesc-card"><h2 className="hesc-section-title">企业 AI 协助配置</h2><p className="hesc-muted-copy">企业管理员自行配置为默认流程。仅在企业明确授权时，平台才可代为保存；密钥只驻留服务器加密存储，不能回显。</p>
          <div className="hesc-provisioning-form">
            <label>协助企业<select disabled={submitting || tenants.length === 0} onChange={event => setSelectedTenantId(event.target.value)} value={selectedTenantId}><option value="">请选择企业</option>{tenants.map(tenant => <option key={tenant.tenant_id} value={tenant.tenant_id ?? ''}>{tenant.name ?? tenant.tenant_id}</option>)}</select></label>
            {selectedTenant ? <p className="hesc-muted-copy">当前状态：{aiConfig?.configured ? `已配置 ${aiConfig.provider ?? 'AI 厂商'}（版本 ${aiConfig.version ?? '—'}）` : aiConfig?.encryption_ready ? '尚未配置' : '服务器加密存储未就绪'}</p> : null}
            <label>AI 厂商<select disabled={submitting || !selectedTenantId} onChange={event => { const provider = event.target.value; setAiProvider(provider); const catalog = aiConfig?.providers?.find(item => item.key === provider);

 if (catalog?.default_model) {setAiModel(catalog.default_model)} }} value={aiProvider}><option value="">请选择厂商</option>{aiConfig?.providers?.map(provider => <option key={provider.key} value={provider.key}>{provider.label ?? provider.key}</option>)}</select></label>
            <label>模型<input disabled={submitting || !selectedTenantId} onChange={event => setAiModel(event.target.value)} value={aiModel} /></label>
            <label>Base URL（可选）<input disabled={submitting || !selectedTenantId} onChange={event => setAiBaseUrl(event.target.value)} placeholder="留空使用厂商默认地址" value={aiBaseUrl} /></label>
            <label>企业 AI 密钥<input autoComplete="off" disabled={submitting || !selectedTenantId} onChange={event => setAiKey(event.target.value)} placeholder="仅用于本次安全保存，不会回显" type="password" value={aiKey} /></label>
            <label className="hesc-checkbox-control"><input checked={aiConsent} disabled={submitting || !selectedTenantId} onChange={event => setAiConsent(event.target.checked)} type="checkbox" />企业已明确授权平台代为保存该 AI 配置</label>
            <button className="hesc-action" disabled={submitting || !selectedTenantId || !aiProvider || !aiModel || !aiKey || !aiConsent} onClick={() => void saveAssistedAiConfig()} type="button">安全保存企业 AI 配置</button>
          </div>
        </article>

      </div>

      {usage ? <EnterpriseModalDialog label="企业详情" onClose={() => setUsage(null)}><h2>{usage.name} · 企业详情</h2><dl className="hesc-detail-list"><div><dt>状态</dt><dd>{tenantStatus(usage.status)}</dd></div><div><dt>在用坐席 / 上限</dt><dd>{usage.active_operator_count ?? '—'} / {usage.operator_seat_limit ?? '—'}</dd></div><div><dt>知识上传文档</dt><dd>{usage.uploaded_document_count}</dd></div><div><dt>上传原文件累计大小</dt><dd>{(usage.uploaded_bytes / 1024 / 1024).toFixed(2)} MiB</dd></div><div><dt>解析知识片段</dt><dd>{usage.parsed_chunk_count}</dd></div></dl><p>仅展示容量统计，不展示员工账号、文档名称或知识正文。上传文件大小不等于向量数据库磁盘占用。</p><button className="hesc-action" type="button" onClick={() => setUsage(null)}>关闭</button></EnterpriseModalDialog> : null}
      {pendingAction ? <EnterpriseModalDialog label={pendingAction.kind === 'delete' ? '删除企业租户' : pendingAction.kind === 'pause' ? '暂停企业租户' : '启用企业租户'} onClose={() => setPendingAction(null)}><h2>{pendingAction.kind === 'delete' ? '删除企业租户' : pendingAction.kind === 'pause' ? '暂停企业租户' : '启用企业租户'}</h2><p>{pendingAction.kind === 'delete' ? `将软删除“${pendingAction.tenant.name ?? pendingAction.tenant.tenant_id}”，其账号将不能继续登录；审计留存不会被删除。` : `确认要${pendingAction.kind === 'pause' ? '暂停' : '启用'}“${pendingAction.tenant.name ?? pendingAction.tenant.tenant_id}”吗？`}</p><div className="hesc-dialog-actions"><button className="hesc-action" disabled={submitting} onClick={() => setPendingAction(null)} type="button">取消</button><button className={pendingAction.kind === 'delete' ? 'hesc-action hesc-action-danger' : 'hesc-action'} disabled={submitting} onClick={() => void confirmTenantAction()} type="button">确认执行</button></div></EnterpriseModalDialog> : null}
    </section>
  )
}
