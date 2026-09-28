import { useCallback, useEffect, useState } from 'react'

import { LoginCredentials } from './login-credentials'
import type { EnterpriseClientRuntime } from './runtime'

interface SeatRequest {
  decision_note?: string | null
  login_name: string
  name: string
  request_id: string
  status: 'pending' | 'approving' | 'approved' | 'rejected'
  supervisor_principal_id?: string
  credentials_ready?: boolean
}

interface SeatRequestResponse { requests?: SeatRequest[] }
interface Credentials { login_name: string; temporary_password: string }

function statusText(status: SeatRequest['status']): string {
  return ({pending: '待企业管理员审批', approving: '正在审批', approved: '已开通', rejected: '已拒绝'} as const)[status]
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '账号申请服务暂时不可用。'
}

/** Same server-backed component for supervisor applications and admin review. */
export function SeatRequestPanel({ review = false, runtime }: { review?: boolean; runtime: EnterpriseClientRuntime | null }) {
  const [requests, setRequests] = useState<SeatRequest[]>([])
  const [name, setName] = useState('')
  const [loginName, setLoginName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  const load = useCallback(async () => {
    if (!runtime) {setRequests([]); return}
    const data = await runtime.get<SeatRequestResponse>('/api/seat-requests')
    setRequests(data.requests ?? [])
  }, [runtime])

  useEffect(() => {
    let active = true
    setError(null)
    void load().catch(reason => {if (active) {setError(errorText(reason))}})
    return () => {active = false}
  }, [load])

  const submit = useCallback(async () => {
    if (!runtime?.post || busyId || !name.trim() || !loginName.trim()) {return}
    setBusyId('new')
    setError(null)
    try {
      await runtime.post('/api/seat-requests', {name: name.trim(), login_name: loginName.trim()})
      setName('')
      setLoginName('')
      await load()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusyId(null)
    }
  }, [busyId, load, loginName, name, runtime])

  const decide = useCallback(async (request: SeatRequest, action: 'approve' | 'reject') => {
    if (!runtime?.post || busyId || request.status !== 'pending') {return}
    setBusyId(request.request_id)
    setError(null)
    try {
      await runtime.post('/api/seat-requests-decision', {action, request_id: request.request_id})
      await load()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusyId(null)
    }
  }, [busyId, load, runtime])

  const revealCredentials = useCallback(async (request: SeatRequest) => {
    if (!runtime?.post || busyId || !request.credentials_ready) {return}
    setBusyId(request.request_id)
    setError(null)
    try {
      const result = await runtime.post<{ credentials: Credentials }>('/api/seat-request-credentials', {
        request_id: request.request_id
      })
      setCredentials(result.credentials)
      await load()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusyId(null)
    }
  }, [busyId, load, runtime])

  // The administrator's screen is an approval inbox, not an employee history.
  // Once approved, the account belongs to the employee list and its group; the
  // applying supervisor still retains the separate one-time credential flow.
  const visibleRequests = review ? requests.filter(request => request.status === 'pending') : requests

  return <article className="hesc-card" data-testid={review ? 'seat-request-review' : 'seat-request-panel'}>
    <div className="hesc-section-heading">
      <div>
        <h2 className="hesc-section-title">{review ? '主管坐席申请' : '申请坐席账号'}</h2>
        <p className="hesc-muted-copy">{review ? '仅显示待审批申请。批准后该行会从此列表移除；初始密码不会显示给管理员，而是由申请主管在自己的列表中一次性查看。' : '提交后不会创建账号。批准后，初始账号密码会在此处仅显示一次，请安全交付给该坐席。'}</p>
      </div>
      <button className="hesc-action hesc-action-secondary" disabled={Boolean(busyId)} onClick={() => void load()} type="button">刷新</button>
    </div>

    {!review ? <form className="hesc-provisioning-form" onSubmit={event => {event.preventDefault(); void submit()}}>
      <label>员工姓名<input maxLength={80} onChange={event => setName(event.target.value)} required value={name} /></label>
      <label>登录账号<input autoComplete="off" maxLength={128} onChange={event => setLoginName(event.target.value)} placeholder="例如：earlybird.zhangsan" required value={loginName} /></label>
      <button className="hesc-action" disabled={!runtime?.post || busyId === 'new'} type="submit">{busyId === 'new' ? '正在提交…' : '提交坐席申请'}</button>
    </form> : null}

    {credentials ? <LoginCredentials key={credentials.login_name} login={credentials.login_name} password={credentials.temporary_password} hideLabel="已安全交付，隐藏密码" onHide={() => setCredentials(null)} /> : null}
    {error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
    <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table"><thead><tr><th>员工</th><th>登录账号</th>{review ? <th>申请主管</th> : null}<th>状态</th><th>{review ? '操作' : '初始凭据'}</th></tr></thead><tbody>
      {visibleRequests.map(request => <tr key={request.request_id}><td>{request.name}</td><td><span className="hesc-selectable">{request.login_name}</span></td>{review ? <td>{request.supervisor_principal_id ?? '—'}</td> : null}<td>{statusText(request.status)}</td><td>{review ? (request.status === 'pending' ? <div className="hesc-inline-actions"><button className="hesc-action" disabled={Boolean(busyId)} onClick={() => void decide(request, 'approve')} type="button">批准并开通</button><button className="hesc-action hesc-action-danger" disabled={Boolean(busyId)} onClick={() => void decide(request, 'reject')} type="button">拒绝</button></div> : request.decision_note || '—') : (request.credentials_ready ? <button className="hesc-action" disabled={Boolean(busyId)} onClick={() => void revealCredentials(request)} type="button">查看一次性账号密码</button> : '—')}</td></tr>)}
      {visibleRequests.length === 0 ? <tr><td colSpan={review ? 5 : 4}>{review ? '暂无待处理的主管申请。' : '尚未提交坐席申请。'}</td></tr> : null}
    </tbody></table></div>
  </article>
}
