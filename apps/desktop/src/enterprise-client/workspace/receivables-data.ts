import { atom } from 'nanostores'
import { useEffect, useRef, useState } from 'react'
import type { EnterpriseClientRuntime } from '../runtime'
import type { ReminderCenterTask } from '../reminder-state'

export const moneyMetrics = [
  ['due_today', '当日待收款'],
  ['unpaid', '未收款总额'],
  ['overdue', '逾期未收款'],
  ['outstanding', '跟进中未收'],
  ['inactive', '关闭／取消未收'],
  ['received', '累计已确认收款'],
  ['all', '应收总额'],
  ['age_1_7', '逾期 1–7 天'],
  ['age_8_30', '逾期 8–30 天'],
  ['age_31_plus', '逾期 31 天以上']
] as const
export type MoneyBucket = (typeof moneyMetrics)[number][0]
export const primaryMoneyMetrics = moneyMetrics.filter(([key]) => ['due_today', 'unpaid', 'overdue', 'received'].includes(key))
export interface ScopeOptions {
  current_principal_id: string
  groups: {group_id: string; name: string}[]
  people: {principal_id: string; name: string; group_id: string | null; role: string; active: boolean}[]
}
export interface MoneyTotals extends Record<string, string> {
  currency: string
}
export interface ReceivableRow extends ReminderCenterTask {
  resolution?: string
  expected_receive_date?: string
  receivable_date?: string
  received_amount: string
  remaining_amount: string
  original_expected_receive_date: string | null
  overdue_days: number | null
}
export interface ReceivablesData {
  scope_options?: ScopeOptions
  available: boolean
  as_of_date: string
  total: number
  page: number
  page_size: number
  summary_totals: MoneyTotals[]
  daily_from: string
  daily_to: string
  daily: { date: string; currency: string; amount: string; count: number }[]
  followups: ReceivableRow[]
  customers?: (MoneyTotals & { business_subject: string })[]
}
export interface ReceivableSelection {
  bucket: MoneyBucket
  currency: string
  due_date: string
  detail_view: string
}
export const initialFilters = {
  query: '',
  owner: 'all',
  team: '',
  group_id: '',
  status: 'all',
  date_field: 'expected_receive_date',
  from: '',
  to: '',
  daily_from: '',
  daily_to: ''
}
export function compatibleFilters(filters: typeof initialFilters, selection: ReceivableSelection) {
  const terminal = ['completed', 'cancelled', 'closed', 'admin_deleted', 'written_off'].includes(filters.status)
  const currentOnly = ['due_today', 'outstanding', 'overdue', 'age_1_7', 'age_8_30', 'age_31_plus'].includes(selection.bucket) || Boolean(selection.due_date)
  const incompatible = filters.status !== 'all' && (
    selection.detail_view === 'current' && terminal ||
    selection.detail_view === 'history' && !terminal ||
    currentOnly && terminal ||
    selection.bucket === 'inactive' && !['cancelled', 'closed'].includes(filters.status)
  )
  return incompatible ? {...filters, status: 'all'} : filters
}
export const todaySelection: ReceivableSelection = {
  bucket: 'due_today',
  currency: '',
  due_date: '',
  detail_view: 'all'
}
export const $receivableJump = atom<{ scope: string; selection: ReceivableSelection; nonce: number } | null>(null)
export function metricSelection(bucket: MoneyBucket, currency: string): ReceivableSelection {
  return { bucket, currency, due_date: '', detail_view: 'all' }
}
export function selectedTitle(selection: ReceivableSelection): string {
  if (selection.due_date) return `${selection.due_date} 待收款`
  if (selection.detail_view === 'history') return '历史记录'
  if (selection.detail_view === 'current') return '当前跟进任务'
  return moneyMetrics.find(([key]) => key === selection.bucket)?.[1] ?? '应收任务'
}
export function useReceivablesData(runtime: EnterpriseClientRuntime, scope: string, query: Record<string, string>) {
  const [snapshot, setSnapshot] = useState<{scope: string; params: string; data: ReceivablesData} | null>(null)
  const [busy, setBusy] = useState(true)
  const [failure, setFailure] = useState<{scope: string; params: string} | null>(null)
  const [revision, refresh] = useState(0)
  const serial = useRef(0)
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== '')).toString()
  const data = snapshot?.scope === scope ? snapshot.data : null
  const error = failure?.scope === scope && failure.params === params ? '统计读取失败，请检查连接和权限后重试。' : ''
  const awaitingSelection = !error && (snapshot?.scope !== scope || snapshot.params !== params)
  useEffect(() => {
    const request = ++serial.current
    setBusy(true)
    setFailure(null)
    void runtime
      .get<ReceivablesData>(`/api/receivables-report?${params}`)
      .then(result => {
        if (request !== serial.current) return
        if (
          !result.available ||
          !Array.isArray(result.summary_totals) ||
          !Array.isArray(result.daily) ||
          !Array.isArray(result.followups)
        )
          throw new Error('invalid report')
        setSnapshot({scope, params, data: result})
      })
      .catch(() => {
        if (request === serial.current) setFailure({scope, params})
      })
      .finally(() => {
        if (request === serial.current) setBusy(false)
      })
    return () => {
      ++serial.current
    }
  }, [runtime, scope, params, revision])
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.scope === scope) refresh(value => value + 1)
    }
    const timer = window.setInterval(() => refresh(value => value + 1), 60_000)
    window.addEventListener('hermes:followup-changed', changed)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('hermes:followup-changed', changed)
    }
  }, [scope])
  return { data, busy: busy || awaitingSelection, error, refresh: () => refresh(value => value + 1) }
}
export const statusLabels: Record<string, string> = {
  created: '已创建',
  open: '待跟进',
  pending_confirmation: '待确认',
  followup_due: '到期待跟进',
  waiting_update: '等待更新',
  completed: '已收款',
  cancelled: '已取消',
  closed: '已关闭',
  admin_deleted: '管理员删除',
  written_off: '已冲销',
  active: '待处理',
  exhausted: '通知失败待处理'
}
