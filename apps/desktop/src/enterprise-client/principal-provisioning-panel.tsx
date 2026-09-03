import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

interface PrincipalProvisionRequest {
  created_principal_id?: string
  created_ts?: number | string
  request_id?: string
  requested_name?: string
  requested_role?: string
  requested_by?: string
  reviewed_by?: string
  reviewed_ts?: number | string
  status?: string
}

interface PrincipalProvisioningResponse {
  requests?: PrincipalProvisionRequest[]
}

interface ProvisionedPrincipalResponse extends PrincipalProvisionRequest {
  token?: string
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function requestStatus(status: string | undefined): string {
  if (status === 'approved') {
    return '已批准'
  }

  if (status === 'rejected') {
    return '已驳回'
  }

  return '待批准'
}

function requirePost(runtime: EnterpriseClientRuntime): NonNullable<EnterpriseClientRuntime['post']> {
  if (!runtime.post) {
    throw new Error('当前企业服务不支持员工申请操作')
  }

  return runtime.post
}

function oneTimeToken(response: ProvisionedPrincipalResponse): string | null {
  return typeof response.token === 'string' && response.token.length > 0 ? response.token : null
}

/**
 * Presentation for the server-owned supervisor → tenant-admin approval flow.
 * Role checks only select an affordance; every request remains authorized by
 * the current server identity and tenant context.
 */
export function PrincipalProvisioningPanel({
  identity,
  runtime
}: {
  identity: EnterpriseIdentity | null
  runtime: EnterpriseClientRuntime | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [requests, setRequests] = useState<PrincipalProvisionRequest[]>([])
  const [state, setState] = useState<LoadState>('unavailable')
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  const isSupportedRole = identity?.role === 'supervisor' || identity?.role === 'tenant_admin'

  async function refreshRequests() {
    if (!runtime || !isSupportedRole) {
      return
    }

    const response = await runtime.get<PrincipalProvisioningResponse>('/api/principal-provisioning')
    setRequests(response.requests ?? [])
  }

  useEffect(() => {
    let active = true

    if (!runtime || !isSupportedRole) {
      setError(null)
      setName('')
      setRequests([])
      setState('unavailable')
      setSubmitting(false)
      setToken(null)

      return () => {
        active = false
      }
    }

    setError(null)
    setRequests([])
    setState('loading')
    setToken(null)
    void runtime
      .get<PrincipalProvisioningResponse>('/api/principal-provisioning')
      .then(response => {
        if (!active) {
          return
        }

        setRequests(response.requests ?? [])
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setRequests([])
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load principal provisioning requests')
      })

    return () => {
      active = false
    }
  }, [isSupportedRole, runtime])

  if (!isSupportedRole) {
    return null
  }

  async function submitRequest() {
    const requestedName = name.trim()

    if (!runtime || !requestedName || submitting) {
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const post = requirePost(runtime)
      await post<PrincipalProvisionRequest>('/api/principal-provisioning', { name: requestedName, role: 'operator' })
      setName('')
      await refreshRequests()
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot create principal provisioning request')
    } finally {
      setSubmitting(false)
    }
  }

  async function approveRequest(requestId: string) {
    if (!runtime || submitting) {
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const post = requirePost(runtime)

      const response = await post<ProvisionedPrincipalResponse>('/api/principal-provisioning-approve', {
        request_id: requestId
      })

      setToken(oneTimeToken(response))
      await refreshRequests()
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot approve principal provisioning request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="hesc-card hesc-provisioning-card" data-testid="enterprise-client-principal-provisioning">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">员工申请与批准</h2>
          <p className="hesc-muted-copy">
            {identity?.role === 'supervisor'
              ? '主管只能提交员工申请；企业管理员批准前不会创建可登录账号。'
              : '仅批准待处理申请。批准会创建员工账号，并只在当前视图显示一次初始令牌。'}
          </p>
        </div>
        <span className="hesc-status" data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}>
          {state === 'loading' ? '正在读取' : state === 'ready' ? '已连接' : state === 'error' ? '读取失败' : '等待连接'}
        </span>
      </div>

      {identity?.role === 'supervisor' ? (
        <form
          className="hesc-provisioning-form"
          onSubmit={event => {
            event.preventDefault()
            void submitRequest()
          }}
        >
          <label>
            员工姓名
            <input
              autoComplete="name"
              disabled={submitting}
              onChange={event => setName(event.target.value)}
              value={name}
            />
          </label>
          <p className="hesc-muted-copy">申请角色固定为员工；角色和租户由服务端当前身份决定。</p>
          <button className="hesc-action" disabled={!name.trim() || submitting} type="submit">
            提交员工申请
          </button>
        </form>
      ) : null}

      {token ? (
        <div className="hesc-provisioning-token" role="status">
          <strong>请立即通过受控渠道交付此初始令牌</strong>
          <code>{token}</code>
          <button className="hesc-action" onClick={() => setToken(null)} type="button">
            已安全保存，隐藏令牌
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>员工申请操作未完成</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {state === 'loading' ? <p className="hesc-muted-copy">正在读取员工申请…</p> : null}
      {state === 'ready' && requests.length === 0 ? <p className="hesc-muted-copy">当前没有可展示的员工申请。</p> : null}
      {requests.length > 0 ? (
        <div className="hesc-table-wrap">
          <table className="hesc-table">
            <thead>
              <tr>
                <th scope="col">员工</th>
                <th scope="col">申请角色</th>
                <th scope="col">申请人</th>
                <th scope="col">状态</th>
                {identity?.role === 'tenant_admin' ? <th scope="col">操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {requests.map((request, index) => (
                <tr key={request.request_id ?? `principal-provision-${index}`}>
                  <td>{request.requested_name ?? '—'}</td>
                  <td>{request.requested_role ?? 'operator'}</td>
                  <td>{request.requested_by ?? '—'}</td>
                  <td>{requestStatus(request.status)}</td>
                  {identity?.role === 'tenant_admin' ? (
                    <td>
                      {request.status === 'pending' && request.request_id ? (
                        <button
                          className="hesc-action"
                          disabled={submitting}
                          onClick={() => void approveRequest(request.request_id ?? '')}
                          type="button"
                        >
                          批准并创建账号
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}
