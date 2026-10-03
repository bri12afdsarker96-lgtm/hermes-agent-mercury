import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SearchField } from '../../components/ui/search-field'
import { controlVariants } from '../../components/ui/control'
import type { ReceivablesOverviewProps } from '../receivables-page'
import {
  $receivableJump,
  compatibleFilters,
  initialFilters,
  metricSelection,
  moneyMetrics,
  selectedTitle,
  statusLabels,
  todaySelection,
  useReceivablesData
} from './receivables-data'
import { MoneySummary } from './money-summary'
import '../receivables-report.css'
import './receivables.css'

export function WebReceivablesOverview({ runtime, scope, onInspect }: ReceivablesOverviewProps) {
  const [draft, setDraft] = useState(initialFilters)
  const [filters, setFilters] = useState(initialFilters)
  const [selection, setSelection] = useState(todaySelection)
  const [page, setPage] = useState('1')
  const detailsRef = useRef<HTMLElement>(null)
  const scrollOnLoad = useRef(false)
  const jump = useStore($receivableJump)
  useEffect(() => {
    if (jump?.scope !== scope) return
    setSelection(jump.selection)
    setPage('1')
    setDraft(initialFilters)
    setFilters(initialFilters)
    scrollOnLoad.current = true
  }, [jump, scope])
  const { data, busy, error, refresh } = useReceivablesData(runtime, scope, {
    ...filters,
    ...selection,
    page,
    page_size: '25'
  })
  useEffect(() => {
    if (!busy && !error && data && scrollOnLoad.current) {
      detailsRef.current?.scrollIntoView({ block: 'start' })
      scrollOnLoad.current = false
    }
  }, [busy, error, data])
  const choose = (next: typeof selection) => {
    setFilters(current => compatibleFilters(current, next))
    setDraft(current => compatibleFilters(current, next))
    setSelection(next)
    setPage('1')
    scrollOnLoad.current = true
  }
  const field = (key: keyof typeof initialFilters, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const options = data?.scope_options
  const people = options?.people.filter(person => !filters.group_id || person.group_id === filters.group_id) ?? []
  const scopeLabel = [
    options?.groups.find(group => group.group_id === filters.group_id)?.name ?? (filters.group_id ? '原团队（请重新选择）' : '权限内全部团队'),
    options?.people.find(person => `id:${person.principal_id}` === filters.owner)?.name ?? (filters.owner === 'mine' ? '我负责的' : filters.owner === 'all' ? '全部负责人' : '原负责人（请重新选择）')
  ].join(' / ')
  const selectScope = (group_id: string, owner: string) => {
    setFilters(current => ({...current, group_id, owner}))
    setDraft(current => ({...current, group_id, owner}))
    setPage('1')
  }
  return (
    <section className="web-receivables" aria-label="收款统计与客户台账" aria-busy={busy}>
      <h2>收款统计与客户台账</h2>
      <p aria-live="polite">统计范围：{scopeLabel}</p>
      {error ? <p role="alert">{error}<Button onClick={refresh}>重试</Button></p> : null}
      {busy ? <p role="status">正在同步金额与明细…</p> : null}
      {data ? <MoneySummary totals={data.summary_totals} disabled={busy || Boolean(error)} selection={selection} onSelect={(key, currency) => choose(metricSelection(key, currency))} /> : null}
      <details><summary>金额口径与统计日期</summary>
        <p>统计日期：{data?.as_of_date ?? '—'}（北京时间）。当日待收按当前预计到账日；逾期按最初约定到账日。未收总额包含关闭／取消未收；关闭不等于收款。</p>
      </details>
      <div className="web-scope-filters" role="group" aria-label="团队与人员范围">
        <label>业务团队<select className={controlVariants()} value={filters.group_id} disabled={!options} onChange={event => selectScope(event.target.value, 'all')}>
          <option value="">权限内全部团队</option>
          {filters.group_id && !options?.groups.some(group => group.group_id === filters.group_id) ? <option value={filters.group_id}>原团队（请重新选择）</option> : null}
          {options?.groups.map(group => <option key={group.group_id} value={group.group_id}>{group.name}</option>)}
        </select></label>
        <label>人员范围<select className={controlVariants()} value={filters.owner} disabled={!options} onChange={event => selectScope(filters.group_id, event.target.value)}>
          <option value="all">{filters.group_id ? '该团队全部负责人' : '权限内全部负责人'}</option>
          {!filters.group_id ? <option value="mine">我负责的</option> : null}
          {filters.owner.startsWith('id:') && !people.some(person => `id:${person.principal_id}` === filters.owner) ? <option value={filters.owner}>原负责人（请重新选择）</option> : null}
          {people.map(person => <option key={person.principal_id} value={`id:${person.principal_id}`}>{person.name}{person.role !== 'operator' ? '（负责人）' : ''}{person.active ? '' : '（停用／历史）'}</option>)}
        </select></label>
        {!options && !busy ? <span role="status">团队信息暂不可用，请刷新。</span> : null}
        {options && filters.group_id && !people.length ? <span>该团队暂无可见人员。</span> : null}
      </div>
      <form
        className="hesc-followup-filters"
        onSubmit={event => {
          event.preventDefault()
          const nextSelection = draft.status !== filters.status
            ? {...metricSelection('all', selection.currency), detail_view: draft.status === 'all' ? 'all' : ['closed', 'cancelled', 'completed', 'admin_deleted', 'written_off'].includes(draft.status) ? 'history' : 'current'}
            : selection
          setSelection(nextSelection)
          setFilters(compatibleFilters(draft, nextSelection))
          setDraft(current => compatibleFilters(current, nextSelection))
          setPage('1')
          refresh()
        }}
      >
        <label>查询已有应收款<SearchField
          aria-label="业务对象 / 群名称"
          placeholder="搜索业务对象 / 群名称"
          value={draft.query}
          containerClassName="web-receivable-search"
          onChange={value => field('query', value)}
        /></label>
        <label>
          状态
          <select
            className={controlVariants()}
            value={draft.status}
            onChange={event => field('status', event.target.value)}
          >
            <option value="all">全部状态</option>
            {Object.entries(statusLabels)
              .filter(([key]) => !['active', 'exhausted'].includes(key))
              .map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
          </select>
        </label>
        <details>
          <summary>台账日期筛选</summary>
          <div className="hesc-inline-actions">
            <label>
              日期口径
              <select
                className={controlVariants()}
                value={draft.date_field}
                onChange={event => field('date_field', event.target.value)}
              >
                {[
                  ['expected_receive_date', '当前预计到账日'],
                  ['original_expected_receive_date', '最初预计到账日'],
                  ['received_at', '实际到账日期'],
                  ['receivable_date', '应收日期'],
                  ['created_at', '创建日期']
                ].map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              开始日期
              <Input type="date" value={draft.from} onChange={event => field('from', event.target.value)} />
            </label>
            <label>
              结束日期
              <Input
                type="date"
                min={draft.from || undefined}
                value={draft.to}
                onChange={event => field('to', event.target.value)}
              />
            </label>
          </div>
        </details>
        <Button type="submit" disabled={busy}>
          查询
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setDraft(initialFilters)
            setFilters(initialFilters)
            choose(metricSelection('all', ''))
            refresh()
          }}
        >
          清空筛选
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
          刷新统计
        </Button>
      </form>
      {JSON.stringify(draft) !== JSON.stringify(filters) ? <p role="status">查询条件已编辑，点击“查询”后应用；当前金额与任务仍按已应用条件展示。</p> : null}
      {data ? (
        <>
          {filters.date_field === 'received_at' ? (
            <p>
              所选到账期间的有效收款：
              {data.summary_totals.map(total => `${total.period_received} ${total.currency}`).join('；') || '无'}
              。卡片中的已确认收款为命中应收单的累计收款。
            </p>
          ) : null}
          {!data.summary_totals.length ? <p>当前权限和筛选范围内没有应收款记录。</p> : null}
          <h3>每日待收款</h3>
          <details><summary>每日待收展示范围（不改变账目筛选）</summary>
          <form
            className="hesc-inline-actions"
            onSubmit={event => {
              event.preventDefault()
              setFilters(current => ({ ...current, daily_from: draft.daily_from, daily_to: draft.daily_to }))
              refresh()
            }}
          >
            <label>
              每日统计开始
              <Input
                type="date"
                value={draft.daily_from || data.daily_from}
                onChange={event => field('daily_from', event.target.value)}
              />
            </label>
            <label>
              每日统计结束
              <Input
                type="date"
                value={draft.daily_to || data.daily_to}
                min={draft.daily_from || data.daily_from}
                onChange={event => field('daily_to', event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              更新日期范围
            </Button>
          </form>
          </details>
          <div className="web-daily-amounts" role="region" aria-label="每日待收金额" tabIndex={0}>
            {data.daily.map(day => (
              <button
                className="hesc-card"
                type="button"
                key={`${day.date}:${day.currency}`}
                aria-label={`${day.currency} ${day.date} 待收款 ${day.amount}，${day.count} 项，查看对应任务`}
                disabled={busy || Boolean(error)}
                aria-pressed={selection.due_date === day.date && selection.currency === day.currency}
                onClick={() => choose({ ...metricSelection('outstanding', day.currency), due_date: day.date })}
              >
                <span>
                  {day.date}
                  {day.date === data.as_of_date ? ' · 今日' : ''}
                </span>
                <strong>
                  {day.amount} {day.currency}
                </strong>
                <span>{day.count} 项</span>
              </button>
            ))}
          </div>
          <div className="hesc-inline-actions">
            <Button
              variant="outline"
              aria-pressed={selection.detail_view === 'current'}
              onClick={() => choose({ ...metricSelection('all', ''), detail_view: 'current' })}
            >
              当前跟进
            </Button>
            <Button
              variant="outline"
              aria-pressed={selection.detail_view === 'history'}
              onClick={() => choose({ ...metricSelection('all', ''), detail_view: 'history' })}
            >
              历史记录
            </Button>
          </div>
          <section ref={detailsRef} aria-label="对应任务明细" className="web-receivable-details">
            <h3>
              {selectedTitle(selection)} · 对应任务{selection.currency ? `（${selection.currency}）` : ''}
            </h3>
            <p>当前范围：{scopeLabel}{filters.query ? ` · 对象：${filters.query}` : ''}{filters.status !== 'all' ? ` · ${statusLabels[filters.status]}` : ''}{filters.from || filters.to ? ` · 日期：${filters.from || '不限'} 至 ${filters.to || '不限'}` : ''}</p>
            {['overdue', 'age_1_7', 'age_8_30', 'age_31_plus'].includes(selection.bucket) ? <div className="hesc-inline-actions" aria-label="逾期账龄">
              {moneyMetrics.filter(([key]) => key === 'overdue' || key.startsWith('age_')).map(([key, label]) => <Button key={key} variant="outline" aria-pressed={selection.bucket === key} onClick={() => choose(metricSelection(key, selection.currency))}>{label}</Button>)}
            </div> : null}
            {!busy && !error ? (
              <>
                <p>共 {data.total} 项 · 仅展示当前金额或分类对应的记录</p>
                <div className="hesc-table-wrap">
                  <table className="hesc-table">
                    <thead>
                      <tr>
                        {[
                          '业务对象 / 群名称',
                          '负责人',
                          '应收',
                          '已确认收款',
                          '未收余额',
                          '当前预计到账日',
                          '原约定到账日',
                          '状态',
                          ...(selection.detail_view === 'history' ? ['处理时间'] : []),
                          '操作'
                        ].map(label => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.followups.map(row => (
                        <tr key={row.source_id}>
                          <td>
                            {row.business_subject}
                            <br />
                            {row.business_team}
                          </td>
                          <td>{row.owner_name}</td>
                          <td>
                            {row.amount} {row.currency}
                          </td>
                          <td>{row.received_amount}</td>
                          <td>{row.remaining_amount}</td>
                          <td>{row.expected_receive_date ?? '—'}</td>
                          <td>{row.original_expected_receive_date ?? '—'}</td>
                          <td>{statusLabels[row.resolution ?? row.status] ?? row.status}</td>
                          {selection.detail_view === 'history' ? (
                            <td>
                              {row.updated_at
                                ? new Date(row.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                                : '—'}
                            </td>
                          ) : null}
                          <td>
                            <Button variant="outline" onClick={() => onInspect(row)}>
                              查看与处理
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.total ? <p>此项暂无对应任务。</p> : null}
                <div className="hesc-inline-actions">
                  <Button disabled={data.page <= 1} onClick={() => setPage(String(data.page - 1))}>
                    上一页
                  </Button>
                  <span>
                    第 {data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))} 页
                  </span>
                  <Button
                    disabled={data.page * data.page_size >= data.total}
                    onClick={() => setPage(String(data.page + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </>
            ) : null}
          </section>
          <details>
            <summary>当前明细按业务对象 / 群名称汇总</summary>
            <div className="hesc-table-wrap">
              <table className="hesc-table">
                <thead>
                  <tr>
                    <th>业务对象 / 群名称</th>
                    <th>币种</th>
                    <th>应收</th>
                    <th>已确认收款</th>
                    <th>跟进中未收</th>
                    <th>关闭／取消未收</th>
                  </tr>
                </thead>
                <tbody>
                  {!busy && !error
                    ? data.customers?.map(row => (
                        <tr key={`${row.business_subject}:${row.currency}`}>
                          <td>{row.business_subject}</td>
                          <td>{row.currency}</td>
                          <td>{row.receivable}</td>
                          <td>{row.received}</td>
                          <td>{row.outstanding}</td>
                          <td>{row.inactive}</td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </section>
  )
}
