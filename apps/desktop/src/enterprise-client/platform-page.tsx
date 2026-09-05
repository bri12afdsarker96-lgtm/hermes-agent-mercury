import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface Tenant {
  created_ts?: number | string
  name?: string
  status?: string
  tenant_id?: string
}

interface TenantListResponse {
  tenants?: Tenant[]
}

interface TenantAdminResponse {
  name?: string
  onboarding_state?: string
  principal_id?: string
  tenant_id?: string
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function statusLabel(state: LoadState): string {
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

function tenantStatus(status: string | undefined): string {
  if (status === 'active') {
    return '已启用'
  }

  if (status === 'suspended') {
    return '已暂停'
  }

  return status || '状态未知'
}

/**
 * Global platform surface. It purposefully calls only the super-admin tenant
 * API; it does not imitate tenant workspaces with an absent tenant context.
 */
export function PlatformPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [error, setError] = useState<string | null>(null)
  const [adminName, setAdminName] = useState('')
  const [adminNotice, setAdminNotice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [state, setState] = useState<LoadState>('unavailable')
  const [submitting, setSubmitting] = useState(false)
  const [tenants, setTenants] = useState<Tenant[]>([])

  async function refreshTenants() {
    if (!runtime) {
      return
    }

    const response = await runtime.get<TenantListResponse>('/api/tenants')
    setTenants(response.tenants ?? [])
  }

  useEffect(() => {
    let active = true

    if (!runtime) {
      setError(null)
      setState('unavailable')
      setTenants([])

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void runtime.get<TenantListResponse>('/api/tenants')
      .then(response => {
        if (!active) {
          return
        }

        setTenants(response.tenants ?? [])
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setTenants([])
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load platform tenants')
      })

    return () => {
      active = false
    }
  }, [runtime])

  async function createTenant() {
    const tenantName = name.trim()

    if (!runtime || !runtime.post || !tenantName || submitting) {
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await runtime.post('/api/tenants', { name: tenantName })
      setName('')
      await refreshTenants()
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot create tenant')
    } finally {
      setSubmitting(false)
    }
  }

  async function appointTenantAdmin() {
    const principalName = adminName.trim()

    if (!runtime || !runtime.post || !selectedTenantId || !principalName || submitting) {
      return
    }

    setAdminNotice(null)
    setError(null)
    setSubmitting(true)

    try {
      const created = await runtime.post<TenantAdminResponse>('/api/platform-tenant-admins', {
        name: principalName,
        tenant_id: selectedTenantId
      })

      setAdminName('')
      setAdminNotice(
        `已为“${created.tenant_id ?? selectedTenantId}”任命“${created.name ?? principalName}”为企业管理员；` +
        '下一步需要绑定其已验证的企业登录身份，完成前不能登录客户端。'
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot appoint tenant administrator')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="hesc-page" data-testid="enterprise-client-platform">
      <header className="hesc-page-header">
        <div>
          <h1>平台企业开通</h1>
          <p>平台管理员仅管理企业租户的开通状态，不读取或操作任一企业的业务、会话、知识或审计内容。</p>
        </div>
        <span className="hesc-status" data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}>
          {statusLabel(state)}
        </span>
      </header>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>平台租户服务响应异常</strong>
            <span>{error}</span>
          </div>
          <button className="hesc-action" onClick={() => void refreshTenants()} type="button">重试</button>
        </div>
      ) : null}

      <div className="hesc-grid">
        <article className="hesc-card">
          <h2 className="hesc-section-title">开通企业租户</h2>
          <p className="hesc-muted-copy">创建企业的隔离边界。创建成功不等同于已向任何个人授予登录权限。</p>
          <form
            className="hesc-provisioning-form"
            onSubmit={event => {
              event.preventDefault()
              void createTenant()
            }}
          >
            <label>
              企业名称
              <input
                autoComplete="organization"
                disabled={submitting || !runtime?.post}
                onChange={event => setName(event.target.value)}
                placeholder="例如：早鸟科技"
                value={name}
              />
            </label>
            <button className="hesc-action" disabled={!name.trim() || submitting || !runtime?.post} type="submit">
              {submitting ? '正在开通' : '开通企业'}
            </button>
          </form>
        </article>

        <article className="hesc-card">
          <h2 className="hesc-section-title">管理员账号与权限</h2>
          <p className="hesc-muted-copy">
            租户创建后，首位企业管理员必须同时具备 Hermes 身份主体和已验证的企业登录身份绑定。
            本操作只任命 Hermes 权限主体；完成身份绑定前，系统不会伪造“已可登录”的管理员账号。
          </p>
          <form
            className="hesc-provisioning-form"
            onSubmit={event => {
              event.preventDefault()
              void appointTenantAdmin()
            }}
          >
            <label>
              目标企业
              <select
                disabled={submitting || !runtime?.post || tenants.length === 0}
                onChange={event => setSelectedTenantId(event.target.value)}
                value={selectedTenantId}
              >
                <option value="">请选择企业</option>
                {tenants.map(tenant => (
                  <option key={tenant.tenant_id} value={tenant.tenant_id ?? ''}>
                    {tenant.name ?? tenant.tenant_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              企业管理员姓名
              <input
                autoComplete="name"
                disabled={submitting || !runtime?.post}
                onChange={event => setAdminName(event.target.value)}
                value={adminName}
              />
            </label>
            <button
              className="hesc-action"
              disabled={!selectedTenantId || !adminName.trim() || submitting || !runtime?.post}
              type="submit"
            >
              {submitting ? '正在任命' : '任命企业管理员'}
            </button>
          </form>
          {adminNotice ? <p className="hesc-provisioning-notice" role="status">{adminNotice}</p> : null}
          <p className="hesc-muted-copy">
            后续流程固定为：平台管理员开通租户 → 创建并绑定首位企业管理员 → 企业管理员创建主管 → 主管申请员工 → 企业管理员批准后生效。
          </p>
        </article>
      </div>

      <article className="hesc-card">
        <h2 className="hesc-section-title">已开通企业</h2>
        {state === 'loading' ? <p className="hesc-muted-copy">正在读取企业租户…</p> : null}
        {state === 'ready' && tenants.length === 0 ? <p className="hesc-muted-copy">当前尚未开通企业租户。</p> : null}
        {tenants.length > 0 ? (
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  <th scope="col">企业名称</th>
                  <th scope="col">租户标识</th>
                  <th scope="col">状态</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant, index) => (
                  <tr key={tenant.tenant_id ?? `tenant-${index}`}>
                    <td>{tenant.name ?? '—'}</td>
                    <td>{tenant.tenant_id ?? '—'}</td>
                    <td>{tenantStatus(tenant.status)}</td>
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
