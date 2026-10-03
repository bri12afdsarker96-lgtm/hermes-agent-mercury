import { useEffect, useRef, useState } from 'react'
import type { EnterpriseClientRuntime } from './runtime'
import type { ReminderCenterTask } from './reminder-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { controlVariants } from '@/components/ui/control'
import './receivables-report.css'

interface MoneyTotals {
  currency: string
  receivable: string
  received: string
  period_received: string
  outstanding: string
  inactive: string
  overdue: string
  age_1_7: string
  age_8_30: string
  age_31_plus: string
}
interface ReportRow extends ReminderCenterTask {
  received_amount: string
  remaining_amount: string
  overdue_days: number | null
  original_expected_receive_date: string | null
}
interface Report {
  available: boolean
  total: number
  page: number
  page_size: number
  totals: MoneyTotals[]
  customers: (MoneyTotals & {business_subject: string})[]
  followups: ReportRow[]
  as_of_date: string
}
const initial = {query:'', owner:'all', team:'', status:'all', date_field:'expected_receive_date', from:'', to:'', currency:'', bucket:'all', page:'1', page_size:'25'}
const metrics = [
  ['receivable', '应收总额'], ['received', '已确认收款'], ['outstanding', '跟进中未收'],
  ['inactive', '关闭/取消未收'], ['overdue', '逾期未收'],
  ['age_1_7', '逾期 1–7 天'], ['age_8_30', '逾期 8–30 天'], ['age_31_plus', '逾期 31 天以上']
] as const

interface ReceivablesReportProps {
  runtime: EnterpriseClientRuntime; scope: string; onInspect(row: ReminderCenterTask): void
}
export function ReceivablesReport({runtime, scope, onInspect}: ReceivablesReportProps) {
  const [draft, setDraft] = useState(initial)
  const [query, setQuery] = useState(initial)
  const [revision, refresh] = useState(0)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const serial = useRef(0)
  useEffect(() => {
    const request = ++serial.current
    setBusy(true); setError(''); setReport(null)
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== ''))
    void runtime.get<Report>(`/api/receivables-report?${params}`).then(result => {
      if (request !== serial.current) {return}
      if (!result.available || !Array.isArray(result.totals) || !Array.isArray(result.followups)) {throw new Error('invalid report')}
      setReport(result)
    }).catch(() => {if (request === serial.current) {setError('统计未读取成功，请检查连接和权限后重试。')}})
      .finally(() => {if (request === serial.current) {setBusy(false)}})
    return () => {++serial.current}
  }, [query, revision, runtime, scope])
  useEffect(() => {
    const changed = (event: Event) => {if ((event as CustomEvent).detail?.scope === scope) {refresh(value => value + 1)}}
    window.addEventListener('hermes:followup-changed', changed)
    return () => window.removeEventListener('hermes:followup-changed', changed)
  }, [scope])
  const field = (name: keyof typeof initial, value: string) => setDraft(current => ({...current, [name]: value}))
  return <section className="hesc-card" aria-label="收款统计与客户台账">
    <h2>收款统计与客户台账</h2>
    <p>金额由服务端按当前账号权限汇总，不同币种分别计算。人工确认收款不等于银行对账；关闭或取消跟进不代表款项已收回。</p>
    <form className="hesc-followup-filters" onSubmit={event => {event.preventDefault(); setQuery({...draft, page:'1', bucket:'all'}); refresh(value => value + 1)}}>
      <SearchField aria-label="业务对象 / 群名称" placeholder="搜索业务对象 / 群名称" value={draft.query} onChange={value => field('query', value)} />
      <label>业务团队<Input value={draft.team} onChange={event => field('team', event.target.value)} /></label>
      <label>人员范围<select className={controlVariants()} value={draft.owner} onChange={event => field('owner', event.target.value)}><option value="all">权限内全部</option><option value="mine">我自己的</option><option value="others">其他成员</option></select></label>
      <label>状态<select className={controlVariants()} value={draft.status} onChange={event => field('status', event.target.value)}>{[['all','全部'],['open','待跟进'],['followup_due','到期待跟进'],['waiting_update','等待更新'],['completed','已收款'],['cancelled','已取消'],['closed','已关闭']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>日期口径<select className={controlVariants()} value={draft.date_field} onChange={event => field('date_field', event.target.value)}>{[['expected_receive_date','当前预计到账日'],['original_expected_receive_date','最初预计到账日'],['received_at','实际到账日期（流水）'],['receivable_date','应收日期'],['created_at','创建日期']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>开始日期<Input type="date" value={draft.from} onChange={event => field('from', event.target.value)} /></label>
      <label>结束日期<Input type="date" value={draft.to} min={draft.from || undefined} onChange={event => field('to', event.target.value)} /></label>
      <Button type="submit" disabled={busy}>查询</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => {setDraft(initial); setQuery(initial); refresh(value => value + 1)}}>清空筛选</Button>
    </form>
    {error ? <p role="alert">{error}<Button onClick={() => refresh(value => value + 1)}>重试</Button></p> : null}
    {busy ? <p role="status">正在读取统计…</p> : null}
    {report ? <>
      <p>统计日期：{report.as_of_date}（北京时间） · 共 {report.total} 条。账龄按最初约定到账日计算；缺失原日期的历史记录不推测账龄。</p>
      {query.date_field === 'received_at' ? <p>所选到账期内有效收款：{report.totals.map(total => `${total.period_received} ${total.currency}`).join('；') || '无'}。下方金额卡片为命中应收单的累计金额及当前余额。</p> : null}
      {query.bucket !== 'all' ? <Button variant="outline" onClick={() => setQuery(current => ({...current, bucket:'all', currency:'', page:'1'}))}>返回筛选范围全部统计</Button> : null}
      {report.totals.map(total => <div key={total.currency}><h3>{total.currency}</h3><div className="hesc-receivable-metrics">{metrics.map(([name, label]) => <button type="button" className="hesc-card" key={name} onClick={() => setQuery(current => ({...current, currency:total.currency, bucket:name === 'receivable' ? 'all' : name, page:'1'}))}><span>{label}</span><strong>{total[name]}</strong><small>查看明细</small></button>)}</div></div>)}
      {!report.total ? <p>当前条件没有记录。</p> : null}
      <h3>应收明细</h3>
      <div className="hesc-table-wrap"><table className="hesc-table"><thead><tr>{['业务对象 / 群名称','负责人','应收','已确认收款','未收余额','最初预计到账','账龄（天）','操作'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{report.followups.map(row => <tr key={row.source_id}><td>{row.business_subject}</td><td>{row.owner_name}</td><td>{row.amount} {row.currency}</td><td>{row.received_amount}</td><td>{row.remaining_amount}</td><td>{row.original_expected_receive_date ?? '—'}</td><td>{row.overdue_days ?? '—'}</td><td><Button variant="outline" onClick={() => onInspect(row)}>查看与处理</Button></td></tr>)}</tbody></table></div>
      <div className="hesc-inline-actions"><Button disabled={busy || report.page <= 1} onClick={() => setQuery(current => ({...current, page:String(report.page - 1)}))}>上一页</Button><span>第 {report.page} / {Math.max(1, Math.ceil(report.total / report.page_size))} 页</span><Button disabled={busy || report.page * report.page_size >= report.total} onClick={() => setQuery(current => ({...current, page:String(report.page + 1)}))}>下一页</Button></div>
      <details><summary>按业务对象 / 群名称汇总（{report.customers.length} 项）</summary><div className="hesc-table-wrap"><table className="hesc-table"><thead><tr><th>业务对象 / 群名称</th><th>币种</th><th>应收</th><th>已确认收款</th><th>跟进中未收</th><th>关闭/取消未收</th></tr></thead><tbody>{report.customers.map(row => <tr key={`${row.business_subject}:${row.currency}`}><td>{row.business_subject}</td><td>{row.currency}</td><td>{row.receivable}</td><td>{row.received}</td><td>{row.outstanding}</td><td>{row.inactive}</td></tr>)}</tbody></table></div></details>
    </> : null}
  </section>
}
