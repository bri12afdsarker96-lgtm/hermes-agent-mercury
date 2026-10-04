import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { EnterpriseClientError, type EnterpriseClientRuntime } from '../runtime'
import { clearPendingOperation, readPendingOperation, savePendingOperation } from '../receivable-pending'
import { $enterprisePackageInstallFrozen } from '../enterprise-install-readiness'
import { useDeliveryWork } from '../use-delivery-work'

interface Writeoff {
  amount: string
  note: string
  recorded_at: string
  actor_name?: string
}
interface Balance {
  available: boolean
  can_write_off: boolean
  version: number
  original_amount: string
  received_amount: string
  remaining_amount: string
  currency: string
  writeoffs: Writeoff[]
}
interface Confirmation {
  action: 'write_off'
  followup_id: string
  idempotency_key: string
  amount: string
  expected_version: number
  note: string
}
interface Props {
  runtime: EnterpriseClientRuntime
  scope: string
  followupId: string
  subject: string
  refreshKey: number
  disabled: boolean
  onLock(locked: boolean): void
  onBusy(busy: boolean): void
  onChanged(): void
}

export function ReceivableWriteoff({ runtime, scope, followupId, subject, refreshKey, disabled, onLock, onBusy, onChanged }: Props) {
  const frozen = useStore($enterprisePackageInstallFrozen)
  const blocked = disabled || frozen
  const [balance, setBalance] = useState<Balance | null>(null)
  const [stage, setStage] = useState<'idle' | 'reason' | 'confirm'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, refresh] = useState(0)
  const pending = useRef<Confirmation | null>(null)
  const writing = useRef(false)
  const recoveryKey = `hermes:web-writeoff:${scope}:${followupId}`
  useDeliveryWork(busy || uncertain || stage !== 'idle' || Boolean(note))
  useEffect(() => {
    try {
      const saved = readPendingOperation(recoveryKey)
      if (saved) {
        const value: Confirmation = JSON.parse(saved)
        if (value.action !== 'write_off' || value.followup_id !== followupId || !value.idempotency_key ||
          !Number.isInteger(value.expected_version) || typeof value.amount !== 'string' || typeof value.note !== 'string') throw new Error('invalid recovery')
        pending.current = value
        setNote(value.note)
        setStage('confirm')
        setUncertain(true)
      }
    } catch {
      setUncertain(true)
      setError('上次冲销结果待核对，无法恢复原提交。请联系管理员核对记录，勿重复操作。')
    }
  }, [recoveryKey, followupId])
  useEffect(() => {
    onLock(stage !== 'idle' || uncertain)
    return () => onLock(false)
  }, [stage, uncertain, onLock])
  useEffect(() => {
    let alive = true
    setLoading(true)
    void runtime.get<Balance>(`/api/business-followup-history?followup_id=${encodeURIComponent(followupId)}`)
      .then(value => {
        if (!value.available || !Array.isArray(value.writeoffs) || !Number.isInteger(value.version)) throw new Error('invalid balance')
        if (alive) setBalance(value)
      })
      .catch(() => { if (alive) { setBalance(null); setError('冲销信息读取失败，请刷新当前任务。') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [runtime, followupId, refreshKey, revision])

  const submit = async () => {
    if ($enterprisePackageInstallFrozen.get() || writing.current || !runtime.post || disabled || (uncertain && !pending.current)) return
    setError('')
    try {
      if (readPendingOperation(`hermes:receivable-pending:${scope}:${followupId}`) ||
        readPendingOperation(`hermes:web-task-action:${scope}:receivable_followup:${followupId}`))
        throw new Error('请先核对本任务上次未完成的操作。')
      if (!pending.current) {
        if (stage !== 'confirm' || !balance?.can_write_off || !note.trim()) return
        pending.current = { action: 'write_off', followup_id: followupId, idempotency_key: crypto.randomUUID(),
          amount: balance.remaining_amount, expected_version: balance.version, note: note.trim() }
      }
      savePendingOperation(recoveryKey, pending.current)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法保存确认信息，请勿提交。')
      return
    }
    writing.current = true
    setBusy(true)
    onBusy(true)
    try {
      const result = await runtime.post<{ok?: boolean; followup_id?: string; resolution?: string}>(
        '/api/receivable-receipt-action', pending.current)
      if (!result.ok || result.followup_id !== followupId || result.resolution !== 'written_off') throw new Error('unconfirmed')
      clearPendingOperation(recoveryKey)
      pending.current = null
      setUncertain(false)
      setStage('idle')
      setNote('')
      setNotice('冲销已完成，原账目已保留在“已冲销”历史中。')
      refresh(value => value + 1)
      onChanged()
    } catch (failure) {
      if (failure instanceof EnterpriseClientError && [400, 403, 404, 409, 422].includes(failure.status)) {
        clearPendingOperation(recoveryKey)
        pending.current = null
        setUncertain(false)
        setStage('idle')
        setError('冲销未获确认：余额、状态或权限可能已变化。请重新核对当前金额。')
        refresh(value => value + 1)
      } else {
        setUncertain(true)
        setError('冲销结果尚未确认。只能重试原提交；请勿另建冲销或重复登记。')
      }
    } finally {
      writing.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  return <section className="web-writeoff-panel" aria-label="未收余额冲销">
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {balance?.writeoffs.map((item, index) => <div className="web-writeoff-record" key={`${item.recorded_at}:${index}`}>
      <h3>已冲销</h3>
      <p>冲销金额：{item.amount} {balance.currency}</p>
      <p>原因：{item.note}</p>
      <p>操作人：{item.actor_name || '企业管理员'} · {new Date(item.recorded_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
    </div>)}
    {stage === 'idle' && balance?.can_write_off ? <Button variant="outline" disabled={blocked || loading || uncertain}
      onClick={() => { setStage('reason'); setError(''); setNotice('') }}>冲销未收余额</Button> : null}
    {stage !== 'idle' ? <div aria-label={stage === 'confirm' ? '再次确认冲销' : '填写冲销原因'}>
      <h3>{stage === 'confirm' ? '再次确认冲销' : '冲销未收余额'}</h3>
      <dl className="hesc-detail-list">
        <div><dt>业务对象</dt><dd>{subject}</dd></div>
        <div><dt>原应收</dt><dd>{balance?.original_amount ?? '—'} {balance?.currency}</dd></div>
        <div><dt>已收款</dt><dd>{balance?.received_amount ?? '—'} {balance?.currency}</dd></div>
        <div><dt>本次冲销</dt><dd>{pending.current?.amount ?? balance?.remaining_amount ?? '—'} {balance?.currency}</dd></div>
      </dl>
      <p>将冲销全部剩余未收金额，未收余额归零，不计入已收款。原账目和操作记录保留在“已冲销”历史中。</p>
      {stage === 'reason' ? <label>冲销原因（必填）<Input maxLength={1000} value={note}
        disabled={busy || blocked} onChange={event => setNote(event.target.value)} /></label> : <p>冲销原因：{note}</p>}
      <div className="hesc-inline-actions">
        {stage === 'reason' ? <Button disabled={blocked || loading || !note.trim()}
          onClick={() => setStage('confirm')}>下一步：核对冲销</Button>
          : <Button disabled={blocked || busy || loading || (uncertain && !pending.current)} onClick={() => void submit()}>
            {busy ? '正在冲销…' : uncertain ? '重试原冲销' : '确认冲销全部剩余金额'}</Button>}
        {!uncertain ? <Button variant="outline" disabled={frozen || busy} onClick={() => { setStage('idle'); setNote('') }}>取消冲销</Button> : null}
      </div>
    </div> : null}
  </section>
}
