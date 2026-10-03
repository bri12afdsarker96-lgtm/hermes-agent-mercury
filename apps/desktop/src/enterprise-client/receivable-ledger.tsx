import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { controlVariants } from '@/components/ui/control'
import { readPendingReceivable, receivableMutationPath, type ReceivableMutation } from './receivable-pending'
import { EnterpriseClientError, type EnterpriseClientRuntime } from './runtime'
import { useWebPresentation } from './web-presentation'

interface Receipt {
  event_type: string; receipt_id: string; amount: string; received_at?: string
  recorded_at?: string; note?: string; actor_principal_id?: string; reversed: boolean
}
interface HistoryItem {history_id: string; event_type: string; created_at: string; actor_principal_id?: string; facts_delta: Record<string, unknown>}
interface Ledger {
  available: boolean; can_record_receipt: boolean; can_correct_receipt: boolean
  can_add_note?: boolean; transfer_targets?: {principal_id: string; name: string; role?: string; group_id?: string | null; group_name?: string}[]
  received_amount: string; remaining_amount: string; receipts: Receipt[]; history: HistoryItem[]
}
interface ReceivableLedgerProps {runtime: EnterpriseClientRuntime; scope: string; followupId: string; refreshKey?: number; hideRefresh?: boolean}
const dateLabel = (value?: string) => value ? new Date(value).toLocaleString() : '—'
const eventLabels: Record<string, string> = {created:'创建应收款', receipt_recorded:'登记收款', receipt_reversed:'冲销纠错', completed:'确认结清', cancelled:'取消提醒', closed:'关闭跟进', expected_date_changed:'更改预计到账日期', owner_transferred:'移交负责人', not_received:'确认未收款', followup_due:'提醒到期', reminder_scheduled:'安排提醒', confirmed:'确认应收款', followup_note:'跟进备注'}

export function ReceivableLedger({runtime, scope, followupId, refreshKey, hideRefresh = false}: ReceivableLedgerProps) {
  const web = useWebPresentation()
  const recoveryKey = `hermes:receivable-pending:${scope}:${followupId}`
  const [data, setData] = useState<Ledger | null>(null)
  const [revision, refresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [amount, setAmount] = useState('')
  const [receivedAt, setReceivedAt] = useState('')
  const [note, setNote] = useState('')
  const [followupNote, setFollowupNote] = useState('')
  const [target, setTarget] = useState('')
  const [targetGroup, setTargetGroup] = useState('')
  const [correction, setCorrection] = useState<Receipt | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef<ReceivableMutation | null>(null)
  const writing = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])
  useEffect(() => {
    try {
      pending.current = readPendingReceivable(recoveryKey, followupId)
      setUncertain(Boolean(pending.current))
    } catch {setError('无法读取未确认操作，请勿重复登记；请先核对流水或联系管理员。'); setUncertain(true)}
  }, [recoveryKey, followupId])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void runtime.get<Ledger>(`/api/business-followup-history?followup_id=${encodeURIComponent(followupId)}`).then(result => {
      if (!active) {return}
      if (!result.available || !Array.isArray(result.receipts) || !Array.isArray(result.history)) {throw new Error('invalid ledger')}
      setData(result)
    }).catch(() => {if (active) {setError('收款流水未读取成功，请重试。')}}).finally(() => {if (active) {setLoading(false)}})
    return () => {active = false}
  }, [runtime, scope, followupId, revision, refreshKey])
  useEffect(() => {
    if (web.enabled && data && target && !data.transfer_targets?.some(person => person.principal_id === target)) {
      setTarget(''); setNotice('原负责人已不在当前授权候选中，请重新选择。')
    }
  }, [data, target, web.enabled])
  useEffect(() => {
    if (web.enabled && data && targetGroup && !data.transfer_targets?.some(person => (person.group_id || '__ungrouped__') === targetGroup)) {
      setTargetGroup(''); setTarget(''); setNotice('原团队已无可转交的授权人员，请重新选择。')
    }
  }, [data, targetGroup, web.enabled])
  const save = async (management?: 'note' | 'transfer') => {
    if (writing.current || !runtime.post) {return}
    // Recheck only new transfers. An uncertain submission must retain its original idempotency key.
    if (web.enabled && management === 'transfer' && !pending.current) {
      if (!target) {setError('请选择授权范围内的新负责人。'); return}
      writing.current = true; setBusy(true); setError('')
      try {
        const fresh = await runtime.get<Ledger>(`/api/business-followup-history?followup_id=${encodeURIComponent(followupId)}`)
        if (!mounted.current) return
        setData(fresh)
        if (!fresh.available || !fresh.transfer_targets?.some(person => person.principal_id === target)) {
          setTarget(''); setError('该负责人已不在当前授权候选中，请重新选择。'); return
        }
      } catch {if (mounted.current) setError('未能核对最新授权候选，未提交转交，请重试。'); return}
      finally {writing.current = false; if (mounted.current) setBusy(false)}
    }
    if (!pending.current) {
      if (uncertain) {setError('无法恢复原操作，请先核对流水或联系管理员。'); return}
      if (management) {
        if (management === 'note' && !followupNote.trim()) {setError('请填写跟进备注。'); return}
        if (management === 'transfer' && !target) {setError('请选择授权范围内的新负责人。'); return}
        pending.current = {action:management, followup_id:followupId, idempotency_key:crypto.randomUUID(),
          ...(management === 'note' ? {note:followupNote.trim()} : {target_principal_id:target})}
      } else if (correction) {
        if (!note.trim()) {setError('冲销必须填写原因。'); return}
        pending.current = {action:'reverse', followup_id:followupId, receipt_id:correction.receipt_id, note:note.trim(), idempotency_key:crypto.randomUUID()}
      } else {
        const timestamp = new Date(receivedAt)
        if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !receivedAt || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now()) {setError('请填写有效金额和不晚于当前时间的实际到账时间。'); return}
        pending.current = {action:'receipt', followup_id:followupId, amount, received_at:timestamp.toISOString(), note:note.trim(), idempotency_key:crypto.randomUUID()}
      }
    }
    writing.current = true; setBusy(true); setError(''); setNotice('')
    try {
      // If recovery storage is unavailable, do not send a financial mutation.
      sessionStorage.setItem(recoveryKey, JSON.stringify(pending.current))
      const result = await runtime.post<{ok: boolean}>(receivableMutationPath(pending.current), pending.current)
      if (!result.ok) {throw new Error('receipt not confirmed')}
      sessionStorage.removeItem(recoveryKey)
      pending.current = null
      if (!mounted.current) {return}
      setUncertain(false); setCorrection(null); setAmount(''); setReceivedAt(''); setNote('')
      setFollowupNote(''); setTarget('')
      setNotice('已保存到服务端。'); refresh(value => value + 1)
      window.dispatchEvent(new CustomEvent('hermes:followup-changed', {detail:{scope}}))
    } catch (failure) {
      if (failure instanceof EnterpriseClientError && [400, 403, 409, 422].includes(failure.status)) {
        sessionStorage.removeItem(recoveryKey); pending.current = null
        if (mounted.current) {setUncertain(false); setError('服务端拒绝了此次提交，请刷新流水，检查金额、状态和权限后再操作。')}
      } else if (mounted.current) {setUncertain(true); setError('尚未确认保存结果。请使用“重试原提交”，不要重复登记。刷新或重新打开详情后仍可重试原操作。')}
    } finally {writing.current = false; if (mounted.current) {setBusy(false)}}
  }
  return <section className="hesc-receivable-ledger" aria-label="收款流水与操作历史">
    <h3>收款流水与操作历史</h3>
    {!hideRefresh ? <Button variant="outline" disabled={loading || busy} onClick={() => refresh(value => value + 1)}>刷新流水</Button> : null}
    {loading ? <p role="status">正在读取流水…</p> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {data ? <>
      <p>已确认收款：{data.received_amount} · 未收余额：{data.remaining_amount}。人工登记不代表银行对账通过。</p>
      {web.enabled && !data.can_record_receipt && Boolean(data.transfer_targets?.length) ? <p role="status">当前为管理查看，可转交负责人；收款登记由当前负责人按任务状态处理，转交后由接任人继续处理。</p> : null}
      {uncertain ? <div role="status"><p>有一项待确认操作：{pending.current?.action === 'transfer' ? '转交负责人' : pending.current?.action === 'note' ? '跟进备注' : '收款登记或冲销'}{pending.current?.amount ? ` · ${pending.current.amount}` : ''}</p><Button disabled={busy} onClick={() => void save()}>重试原提交</Button></div> : null}
      {(data.can_record_receipt || correction) && !uncertain ? <form className="hesc-delivery-form" onSubmit={event => {event.preventDefault(); void save()}}>
        <h4>{correction ? `冲销 ${correction.amount}（保留原流水）` : '登记实际收款（支持部分收款）'}</h4>
        {!correction ? <div className="hesc-inline-actions"><label>本次收款金额<Input aria-label="本次收款金额" inputMode="decimal" value={amount} disabled={busy || uncertain} onChange={event => setAmount(event.target.value)} /></label><label>实际到账时间（本机时区）<Input aria-label="实际到账时间" type="datetime-local" value={receivedAt} disabled={busy || uncertain} onChange={event => setReceivedAt(event.target.value)} /></label></div> : null}
        <label>{correction ? '纠错原因（必填）' : '收款备注'}<Textarea aria-label="流水备注" maxLength={1000} value={note} disabled={busy || uncertain} onChange={event => setNote(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>{busy ? '正在保存…' : uncertain ? '重试原提交' : correction ? '确认冲销' : '确认登记收款'}</Button>
        {correction && !uncertain ? <Button variant="outline" type="button" disabled={busy} onClick={() => {setCorrection(null); setNote('')}}>取消纠错</Button> : null}
      </form> : null}
      <div className="hesc-table-wrap"><table className="hesc-table"><thead><tr><th>类型</th><th>金额</th><th>实际到账</th><th>登记时间</th><th>备注</th><th>操作</th></tr></thead><tbody>{data.receipts.map((row, index) => <tr key={`${row.receipt_id}:${row.event_type}:${index}`}><td>{row.event_type === 'receipt_reversed' ? '冲销' : row.reversed ? '收款（已冲销）' : '收款'}</td><td>{row.amount}</td><td>{dateLabel(row.received_at)}</td><td>{dateLabel(row.recorded_at)}</td><td>{row.note}</td><td>{data.can_correct_receipt && row.event_type === 'receipt_recorded' && !row.reversed ? <Button variant="outline" disabled={busy || uncertain} onClick={() => {setCorrection(row); setNote(''); setError('')}}>登记纠错</Button> : null}</td></tr>)}</tbody></table></div>
      {!data.receipts.length ? <p>暂无已登记收款。</p> : null}
      {data.can_add_note || data.transfer_targets?.length ? <details open={!web.enabled || undefined}><summary hidden={!web.enabled}>备注与负责人转交</summary>
      {data.can_add_note ? <form className="hesc-delivery-form" onSubmit={event => {event.preventDefault(); void save('note')}}><label>跟进备注<Textarea aria-label="跟进备注" maxLength={1000} value={followupNote} disabled={busy || uncertain} onChange={event => setFollowupNote(event.target.value)} /></label><Button type="submit" disabled={busy || uncertain || !followupNote.trim()}>保存跟进备注</Button></form> : null}
      {data.transfer_targets?.length ? <form className="hesc-delivery-form" onSubmit={event => {event.preventDefault(); void save('transfer')}}>
        {web.enabled ? <label>目标团队<select className={controlVariants()} aria-label="转交目标团队" value={targetGroup} disabled={busy || uncertain} onChange={event => {setTargetGroup(event.target.value); setTarget('')}}><option value="">请选择团队</option>{[...new Map(data.transfer_targets.map(person => [person.group_id || '__ungrouped__', person.group_name || '未分组'])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
        <label>转交负责人<select className={controlVariants()} aria-label="转交负责人" value={target} disabled={busy || uncertain || (web.enabled && !targetGroup)} onChange={event => setTarget(event.target.value)}><option value="">请选择</option>{data.transfer_targets.filter(person => !web.enabled || (person.group_id || '__ungrouped__') === targetGroup).map(person => <option key={person.principal_id} value={person.principal_id}>{person.name}</option>)}</select></label><p>确认后，后续提醒和处理责任转交给新负责人；原收款流水保留。</p><Button type="submit" disabled={busy || uncertain || !target}>确认转交</Button></form> : null}
      </details> : null}
      <details><summary>操作历史</summary><ol>{data.history.filter(row => eventLabels[row.event_type]).slice().reverse().map(row => <li key={row.history_id}>{dateLabel(row.created_at)} · {web.enabled && row.facts_delta.resolution === 'admin_deleted' ? '管理员删除' : eventLabels[row.event_type]} · {row.actor_principal_id || '系统'}{typeof row.facts_delta.note === 'string' ? ` · ${row.facts_delta.note}` : ''}</li>)}</ol></details>
    </> : null}
  </section>
}
