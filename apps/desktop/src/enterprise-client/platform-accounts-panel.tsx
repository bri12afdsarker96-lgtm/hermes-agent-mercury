import { useEffect, useRef, useState } from 'react'

import { EnterpriseModalDialog } from './enterprise-design-system'
import { LoginCredentials } from './login-credentials'
import type { EnterpriseClientRuntime } from './runtime'

interface Administrator {
  principal_id: string
  name?: string
  login_name?: string
  temporary_password?: string
}

interface Activity {
  ts?: string | number
  type?: string
  tenant_id?: string
  new_limit?: number
  new_status?: string
}

const activityLabels: Record<string, string> = {
  'tenant.created': '开通企业',
  'tenant.status_changed': '调整企业状态',
  'tenant.operator_seat_limit_updated': '调整坐席容量',
  'tenant.ai_config_platform_assisted': '协助配置企业 AI',
  'platform.admin_password_reset': '重置企业管理员密码'
}

export function PlatformAccountsPanel({ runtime, tenants }: {
  runtime: EnterpriseClientRuntime | null
  tenants: Array<{ tenant_id?: string; name?: string }>
}) {
  const [tenantId, setTenantId] = useState('')
  const [administrators, setAdministrators] = useState<Administrator[]>([])
  const [events, setEvents] = useState<Activity[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<Administrator | null>(null)
  const [credentials, setCredentials] = useState<Administrator | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    generation.current += 1
    setSubmitting(false)
    setCredentials(null)
    setPending(null)
    setAdministrators([])
    setEvents([])
    setError('')
    if (!runtime) { return }
    setLoading(true)
    void Promise.all([
      tenantId ? runtime.get<{ principals: Administrator[] }>(`/api/platform-administrators?tenant_id=${encodeURIComponent(tenantId)}`) : Promise.resolve({ principals: [] }),
      runtime.get<{ events: Activity[] }>('/api/platform-activity')
    ]).then(([accounts, activity]) => {
      if (!active) { return }
      if (!Array.isArray(accounts.principals) || !Array.isArray(activity.events)) { throw new Error('平台管理接口返回异常，请刷新重试') }
      setAdministrators(accounts.principals)
      setEvents(activity.events)
    }).catch(reason => {
      if (active) { setError(reason instanceof Error ? reason.message : '平台管理信息读取失败') }
    }).finally(() => { if (active) { setLoading(false) } })
    return () => { active = false; generation.current += 1 }
  }, [runtime, tenantId, revision])

  async function resetPassword() {
    if (!runtime?.post || !pending || submitting) { return }
    setSubmitting(true)
    setCredentials(null)
    setError('')
    const current = generation.current
    try {
      const result = await runtime.post<Administrator>('/api/platform-administrator-reset', {
        tenant_id: tenantId, principal_id: pending.principal_id, confirmed: true
      })
      if (current !== generation.current) { return }
      setCredentials(result)
      setPending(null)
      // Refresh activity separately: a failed audit read must not hide the one-time password.
      try {
        const activity = await runtime.get<{ events: Activity[] }>('/api/platform-activity')
        if (current !== generation.current) { return }
        if (!Array.isArray(activity.events)) { throw new Error('invalid activity') }
        setEvents(activity.events)
      } catch { if (current === generation.current) { setError('密码已重置，操作记录暂时无法刷新。请先保存一次性密码。') } }
    } catch (reason) {
      if (current !== generation.current) { return }
      setError(reason instanceof Error ? reason.message : '密码重置未完成，请核实账号状态后重试')
      setPending(null)
    } finally { if (current === generation.current) { setSubmitting(false) } }
  }

  return <article className="hesc-card hesc-platform-card">
    <h2 className="hesc-section-title">企业管理员与平台操作记录</h2>
    <div className="hesc-inline-action">
      <label>管理企业<select disabled={submitting} value={tenantId} onChange={event => setTenantId(event.target.value)}><option value="">请选择企业</option>{tenants.map(tenant => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.name ?? tenant.tenant_id}</option>)}</select></label>
      <button className="hesc-action" disabled={!runtime || loading || submitting} type="button" onClick={() => setRevision(value => value + 1)}>刷新管理信息</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">正在读取管理信息…</p> : null}
    {!loading && !error && tenantId && administrators.length === 0 ? <p>该企业暂无启用的管理员账号。</p> : null}
    {administrators.length > 0 ? <div className="hesc-table-wrap"><table className="hesc-table"><thead><tr><th>管理员</th><th>登录账号</th><th>账号维护</th></tr></thead><tbody>{administrators.map(admin => <tr key={admin.principal_id}><td>{admin.name}</td><td>{admin.login_name ?? admin.name}</td><td><button className="hesc-action" disabled={submitting || !runtime?.post} type="button" onClick={() => setPending(admin)}>重置密码</button></td></tr>)}</tbody></table></div> : null}
    {credentials?.temporary_password ? <LoginCredentials title="密码已重置，新密码仅显示本次" login={credentials.login_name ?? credentials.name ?? ''} password={credentials.temporary_password} hideLabel="已安全保存，隐藏凭据" onHide={() => setCredentials(null)} /> : null}
    <h3>近期平台操作</h3><p className="hesc-muted-copy">展示当前日志最近范围内最多 100 条企业开通、状态、容量、AI 协助和管理员重置记录。</p>
    {!loading && !error && events.length === 0 ? <p>当前日志范围内暂无平台操作记录。</p> : null}
    {events.length > 0 ? <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table"><thead><tr><th>时间</th><th>操作</th><th>企业</th><th>变更结果</th></tr></thead><tbody>{events.map((event, index) => <tr key={index}><td>{typeof event.ts === 'number' ? new Date(event.ts * 1000).toLocaleString() : event.ts ?? '—'}</td><td>{activityLabels[event.type ?? ''] ?? '平台操作'}</td><td>{tenants.find(tenant => tenant.tenant_id === event.tenant_id)?.name ?? event.tenant_id ?? '—'}</td><td>{event.new_limit != null ? `坐席上限 ${event.new_limit}` : event.new_status === 'active' ? '已启用' : event.new_status === 'paused' || event.new_status === 'suspended' ? '已暂停' : event.new_status === 'deleted' ? '已删除' : '已完成'}</td></tr>)}</tbody></table></div> : null}
    {pending ? <EnterpriseModalDialog label="重置企业管理员密码" onClose={() => { if (!submitting) { setPending(null) } }}><h2>重置企业管理员密码</h2><p>确认重置 {pending.login_name ?? pending.name} 的密码？旧密码及现有登录会失效，新密码仅显示一次，首次登录必须修改。</p><div className="hesc-dialog-actions"><button className="hesc-action" disabled={submitting} onClick={() => setPending(null)} type="button">取消</button><button className="hesc-action hesc-action-danger" disabled={submitting} onClick={() => void resetPassword()} type="button">确认重置密码</button></div></EnterpriseModalDialog> : null}
  </article>
}
