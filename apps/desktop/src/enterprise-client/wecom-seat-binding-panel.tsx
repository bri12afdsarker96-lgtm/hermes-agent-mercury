import { useEffect, useRef, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface BindingCode {
  code: string
  expires_in: number
  instruction: string
}

interface BindingStatus {
  bound: boolean
  pending: boolean
  account_id: string | null
  app_config_ref: string | null
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '暂时无法创建企业微信绑定码。'
}

/** Personal WeCom binding belongs in the tools area, separate from reminder creation. */
export function WeComSeatBindingPanel({ runtime }: { runtime?: EnterpriseClientRuntime | null }) {
  const [binding, setBinding] = useState<BindingCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<BindingStatus | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [expiresAt, setExpiresAt] = useState(0)
  const epoch = useRef(0)

  // eslint-disable-next-line no-restricted-syntax -- Lifecycle cancellation counter; no atom or reactive value is mirrored into this ref.
  useEffect(() => {
    epoch.current += 1
    setBinding(null)
    setStatus(null)
    setError('')
    setBusy(false)

    return () => {epoch.current += 1}
  }, [runtime])

  useEffect(() => {
    if (!runtime) {return}
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    async function check(): Promise<void> {
      try {
        const next = await runtime!.get<BindingStatus>('/api/wecom-seat-binding')

        if (!active) {return}
        setStatus(next)
        setError('')

        if (next.bound && !next.pending) {
          setBinding(null)

          return
        }
      } catch (reason) {
        if (!active) {return}
        setError(reason instanceof Error ? reason.message : '无法查询绑定状态，请刷新重试。')
      }

      if (active && binding && Date.now() < expiresAt) {
        timer = setTimeout(() => void check(), 3000)
      } else if (active && binding) {
        setBinding(null)
        setError('绑定码已过期，请重新获取后发送。')
      }
    }

    void check()

    return () => {active = false;

 if (timer) {clearTimeout(timer)}}
  }, [runtime, binding, expiresAt, refresh])

  async function issueBinding(): Promise<void> {
    if (!runtime?.post || busy) {
      return
    }

    setBusy(true)
    setError('')
    const requestEpoch = epoch.current

    try {
      const result = await runtime.post<BindingCode>('/api/wecom-seat-binding', {})

      if (requestEpoch !== epoch.current) {return}
      setBinding(result)
      setExpiresAt(Date.now() + result.expires_in * 1000)
    } catch (reason) {
      if (requestEpoch === epoch.current) {setError(errorText(reason))}
    } finally {
      if (requestEpoch === epoch.current) {setBusy(false)}
    }
  }

  return <article className="hesc-card" data-testid="wecom-seat-binding-panel">
    <div className="hesc-section-heading">
      <div>
        <h2 className="hesc-section-title">企业微信直达提醒</h2>
        <p className="hesc-muted-copy">绑定本人企业微信后，自己创建的提醒将向该账号发送私信。绑定码仅用于本次验证，请在有效期内发送。</p>
      </div>
      <span className="hesc-status" data-tone={error ? 'warning' : status?.bound ? 'success' : 'warning'}>{error ? '状态待确认' : status?.bound ? '已绑定' : status === null ? '正在查询绑定状态' : binding ? '等待企业微信验证' : '未绑定'}</span>
    </div>
    <button className="hesc-action" disabled={busy || !runtime?.post} onClick={() => void issueBinding()} type="button">
      {busy ? '正在创建绑定码…' : status?.bound ? '更换绑定账号' : '绑定我的企业微信'}
    </button>
    <button className="hesc-action hesc-action-secondary" disabled={!runtime} onClick={() => setRefresh(value => value + 1)} type="button">刷新绑定状态</button>
    {status?.bound ? <div className="hesc-success-copy" role="status">
      <strong>{error ? '上次确认的绑定账号（当前状态查询失败）' : status.pending ? '当前已绑定，等待验证新账号' : '企业微信绑定成功'}</strong>
      <p>已绑定账号（UserID）：{status.account_id}</p>
      <p>所属应用：{status.app_config_ref}。你创建的到期提醒将发送到此账号。</p>
    </div> : null}
    {binding ? <p role="status">{binding.instruction}（{binding.expires_in} 秒内有效）</p> : null}
    {error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
  </article>
}
