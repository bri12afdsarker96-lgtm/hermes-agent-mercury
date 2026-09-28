import { useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface BindingCode {
  code: string
  expires_in: number
  instruction: string
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '暂时无法创建企业微信绑定码。'
}

/** Personal WeCom binding belongs in the tools area, separate from reminder creation. */
export function WeComSeatBindingPanel({ runtime }: { runtime?: EnterpriseClientRuntime | null }) {
  const [binding, setBinding] = useState<BindingCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function issueBinding(): Promise<void> {
    if (!runtime?.post || busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await runtime.post<BindingCode>('/api/wecom-seat-binding', {})
      setBinding(result)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return <article className="hesc-card" data-testid="wecom-seat-binding-panel">
    <div className="hesc-section-heading">
      <div>
        <h2 className="hesc-section-title">企业微信直达提醒</h2>
        <p className="hesc-muted-copy">绑定本人企业微信后，自己创建的提醒会同时保留网页、客户端与企业微信私信通知；绑定码不会保存或回显在浏览器中。</p>
      </div>
      <span className="hesc-status" data-tone={binding ? 'success' : 'warning'}>{binding ? '绑定码已创建' : '待绑定'}</span>
    </div>
    <button className="hesc-action" disabled={busy || !runtime?.post} onClick={() => void issueBinding()} type="button">
      {busy ? '正在创建绑定码…' : '绑定我的企业微信'}
    </button>
    {binding ? <p role="status">{binding.instruction}（{binding.expires_in} 秒内有效）</p> : null}
    {error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
  </article>
}
