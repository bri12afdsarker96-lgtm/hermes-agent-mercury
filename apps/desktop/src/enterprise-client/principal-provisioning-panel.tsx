import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

interface PrincipalProvisionRequest {
  created_principal_id?: string
  created_ts?: number | string
  rejection_reason?: string
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

const REJECTION_REASONS = [
  { label: '重复申请', value: 'duplicate_request' },
  { label: '信息不完整', value: 'insufficient_information' },
  { label: '岗位尚未批准', value: 'position_not_approved' },
  { label: '其他（不记录自由文本）', value: 'other' }
] as const

type RejectionReason = (typeof REJECTION_REASONS)[number]['value']

function requestStatus(status: string | undefined): string {
  if (status === 'approved') {
    return '已批准'
  }

  if (status === 'rejected') {
    return '已驳回'
  }

  if (status === 'withdrawn') {
    return '已撤回'
  }

  return '待批准'
}

function rejectionReasonLabel(reason: string | undefined): string | null {
  return REJECTION_REASONS.find(candidate => candidate.value === reason)?.label ?? null
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
  const [notice, setNotice] = useState<string | null>(null)
  const [requests, setRequests] = useState<PrincipalProvisionRequest[]>([])
  const [rejectionReason, setRejectionReason] = useState<RejectionReason>('insufficient_information')
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
      setNotice(null)
      setRequests([])
      setState('unavailable')
      setSubmitting(false)
      setToken(null)

      return () => {
        active = false
      }
    }

    setError(null)
    setNotice(null)
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
    setNotice(null)
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
    setNotice(null)
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

  async function rejectRequest(requestId: string) {
    if (!runtime || submitting) {
      return
    }

    setError(null)
    setNotice(null)
    setToken(null)
    setSubmitting(true)

    try {
      const post = requirePost(runtime)
      await post<PrincipalProvisionRequest>('/api/principal-provisioning-reject', {
        request_id: requestId,
        reason: rejectionReason
      })
      setNotice(`员工申请已因“${rejectionReasonLabel(rejectionReason)}”驳回；系统未创建账号或初始令牌。`)
      await refreshRequests()
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot reject principal provisioning request')
    } finally {
      setSubmitting(false)
    }
  }

  async function withdrawRequest(requestId: string) {
    if (!runtime || submitting) {
      return
    }

    setError(null)
    setNotice(null)
    setToken(null)
    setSubmitting(true)

    try {
      const post = requirePost(runtime)
      await post<PrincipalProvisionRequest>('/api/principal-provisioning-withdraw', { request_id: requestId })
      setNotice('员工申请已撤回；如仍需开通，请提交新的申请并等待企业管理员批准。')
      await refreshRequests()
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot withdraw principal provisioning request')
    } finally {
      setSubmitting(false)
    }
  }

  async function reissueToken(principalId: string) {
    if (!runtime || submitting) {
      return
    }

    setError(null)
    setNotice(null)
    setToken(null)
    setSubmitting(true)

    try {
      const post = requirePost(runtime)
      const response = await post<ProvisionedPrincipalResponse>('/api/principal-token-reissue', {
        principal_id: principalId
      })
      setToken(oneTimeToken(response))
      setNotice('旧初始令牌已失效；请通过受控渠道交付新令牌。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'cannot reissue principal token')
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

      {notice ? <p className="hesc-provisioning-notice" role="status">{notice}</p> : null}

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
                {identity?.role === 'tenant_admin' || identity?.role === 'supervisor' ? <th scope="col">操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {requests.map((request, index) => (
                <tr key={request.request_id ?? `principal-provision-${index}`}>
                  <td>{request.requested_name ?? '—'}</td>
                  <td>{request.requested_role ?? 'operator'}</td>
                  <td>{request.requested_by ?? '—'}</td>
                  <td>
                    <span>{requestStatus(request.status)}</span>
                    {request.status === 'rejected' && rejectionReasonLabel(request.rejection_reason) ? (
                      <small className="hesc-provisioning-reason">{rejectionReasonLabel(request.rejection_reason)}</small>
                    ) : null}
                  </td>
                  {identity?.role === 'tenant_admin' ? (
                    <td>
                      {request.status === 'pending' && request.request_id ? (
                        <div className="hesc-provisioning-actions">
                          <button
                            className="hesc-action"
                            disabled={submitting}
                            onClick={() => void approveRequest(request.request_id ?? '')}
                            type="button"
                          >
                            批准并创建账号
                          </button>
                          <label className="hesc-provisioning-reason-select">
                            <span>驳回理由</span>
                            <select
                              aria-label={`为 ${request.requested_name ?? '该员工'} 选择驳回理由`}
                              disabled={submitting}
                              onChange={event => setRejectionReason(event.target.value as RejectionReason)}
                              value={rejectionReason}
                            >
                              {REJECTION_REASONS.map(reason => (
                                <option key={reason.value} value={reason.value}>{reason.label}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="hesc-action hesc-action-danger"
                            disabled={submitting}
                            onClick={() => void rejectRequest(request.request_id ?? '')}
                            type="button"
                          >
                            驳回申请
                          </button>
                        </div>
                      ) : request.status === 'approved' && request.created_principal_id ? (
                        <button
                          className="hesc-action"
                          disabled={submitting}
                          onClick={() => void reissueToken(request.created_principal_id ?? '')}
                          type="button"
                        >
                          重新签发初始令牌
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                  {identity?.role === 'supervisor' ? (
                    <td>
                      {request.status === 'pending' && request.request_id ? (
                        <button
                          className="hesc-action hesc-action-danger"
                          disabled={submitting}
                          onClick={() => void withdrawRequest(request.request_id ?? '')}
                          type="button"
                        >
                          撤回申请
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
