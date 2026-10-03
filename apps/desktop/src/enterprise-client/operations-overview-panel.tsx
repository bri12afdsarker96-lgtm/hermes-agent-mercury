import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'
import { useWebPresentation } from './web-presentation'
import { WebDisclosure, useWebLayoutCopy } from './web-sections'

interface OperationsSummary {
  today_questions: number
  today_answers: number
  today_customer_replies: number
  week_answers: number
  total_answers: number
  total_customer_replies: number
}

interface OperationsGroup {
  group_id: string
  member_count: number
  name: string
  owner_name: string
}

interface OperationsStaff extends OperationsSummary {
  group_name: string
  login_name: string
  name: string
  principal_id: string
}

interface OperationsReminder {
  group_name: string
  overdue?: boolean
  owner_name: string
  reminder_id: string
  scheduled_for: number
  state?: string
  status_label: string
  title: string
}

interface OperationsServerTime {
  now: string
  reminder_rule: string
  timezone_label: string
  runner: { interval_seconds?: number; last_ready_count?: number; last_success_at?: number | null; running?: boolean }
}

interface OperationsReminderPoll {
  reminders: OperationsReminder[]
  server_time: OperationsServerTime
}

interface OperationsOverview {
  groups: OperationsGroup[]
  knowledge: { pending_review: number; published: number }
  knowledge_available: boolean
  reminders: OperationsReminder[]
  reminder_summary?: { current: number; overdue: number }
  scope: { operator_count: number; scoped_operator_count?: number; read_only: boolean }
  staff: OperationsStaff[]
  summary: OperationsSummary
  server_time?: OperationsServerTime
}

function localTime(value: number): string {
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export function OperationsOverviewPanel({ runtime, role }: { runtime: EnterpriseClientRuntime | null; role?: string }) {
  const web = useWebPresentation()
  const labels = useWebLayoutCopy()
  const [period, setPeriod] = useState('today')
  const [data, setData] = useState<OperationsOverview | null>(null)
  const [error, setError] = useState('')
  const [reminderError, setReminderError] = useState('')
  const [serverClock, setServerClock] = useState<{ browser_epoch_ms: number; server_epoch_ms: number } | null>(null)
  const [clockTick, setClockTick] = useState(0)

  function synchronizeServerClock(serverTime?: OperationsServerTime) {
    const serverEpoch = Date.parse(serverTime?.now ?? '')
    if (Number.isNaN(serverEpoch)) { return }
    const browserEpoch = Date.now()
    setServerClock({ browser_epoch_ms: browserEpoch, server_epoch_ms: serverEpoch })
    setClockTick(browserEpoch)
  }

  useEffect(() => {
    let active = true
    if (!runtime || (role !== 'tenant_admin' && role !== 'supervisor')) {
      setData(null)
      setServerClock(null)
      return () => { active = false }
    }
    const load = () => {
      setError('')
      void runtime.get<OperationsOverview>('/api/operations-overview').then(result => {
        if (active) {
          setData(result)
          synchronizeServerClock(result.server_time)
        }
      }).catch(reason => {
        if (active) {
          setError(reason instanceof Error ? reason.message : '运营数据暂时无法读取')
        }
      })
    }
    load()
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        load()
      }
    }
    const timer = window.setInterval(reloadWhenVisible, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [role, runtime])

  useEffect(() => {
    let active = true
    if (!runtime || (role !== 'tenant_admin' && role !== 'supervisor')) {
      setReminderError('')
      return () => { active = false }
    }
    const loadReminders = () => {
      void runtime.get<OperationsReminderPoll>('/api/operations-reminders').then(result => {
        if (!active) { return }
        setReminderError('')
        setData(current => current ? {
          ...current,
          reminders: result.reminders,
          reminder_summary: {
            current: result.reminders.length,
            overdue: result.reminders.filter(row => row.overdue === true).length
          },
          server_time: result.server_time
        } : current)
        synchronizeServerClock(result.server_time)
      }).catch(reason => {
        if (active) { setReminderError(reason instanceof Error ? reason.message : '坐席定时任务暂时无法读取') }
      })
    }
    loadReminders()
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        loadReminders()
      }
    }
    const timer = window.setInterval(reloadWhenVisible, 15_000)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [role, runtime])

  useEffect(() => {
    if (!serverClock) { return }
    const tick = () => setClockTick(Date.now())
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [serverClock])

  if (role !== 'tenant_admin' && role !== 'supervisor') {
    return null
  }

  const displayedServerTime = serverClock
    ? new Date(serverClock.server_epoch_ms + (clockTick - serverClock.browser_epoch_ms))
    : null
  const reminderSummary = data?.reminder_summary ?? {
    current: data?.reminders.length ?? 0,
    overdue: data?.reminders.filter(row => row.overdue === true).length ?? 0
  }

  return <section className="hesc-operations-overview" data-testid="operations-overview">
    <div className="hesc-section-heading" hidden={web.enabled}>
      <div>
        <h2 className="hesc-section-title">运营数据看板</h2>
        <p className="hesc-muted-copy">数据由企业服务端按当前角色和组归属汇总，每 10 分钟自动刷新。主管仅只读查看本组坐席与知识库状态，不获得知识库配置权限。</p>
      </div>
      <span className="hesc-status" data-tone={error ? 'error' : data ? 'success' : 'warning'}>{error ? '读取失败' : data ? '已同步' : '正在读取'}</span>
    </div>
    {error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
    {!data && !error ? <p className="hesc-muted-copy">正在汇总运营数据…</p> : null}
    {data ? <>
      <div hidden={web.enabled} style={web.enabled ? undefined : { display: 'contents' }}>
      {web.enabled ? <div className="web-operations-summary">
        <section><h3>{labels.knowledge}</h3><p>已发布 <strong>{data.knowledge_available ? data.knowledge.published : '—'}</strong> · 待审核 <strong>{data.knowledge_available ? data.knowledge.pending_review : '—'}</strong></p><p>本视图坐席数：<strong>{data.scope.scoped_operator_count ?? '—'}</strong></p></section>
        <section><h3>{labels.usage}</h3><div className="web-section-tabs" role="group" aria-label={labels.usage}>{[['today',labels.today],['week',labels.week],['total',labels.total]].map(([id,label]) => <button className="hesc-action" type="button" key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}</div><p>智能助手回答：<strong>{(period === 'today' ? data.summary.today_answers : period === 'week' ? data.summary.week_answers : data.summary.total_answers) ?? '—'}</strong></p>{period === 'today' ? <p>企业／知识提问：{data.summary.today_questions ?? '—'} · 客户回复生成：{data.summary.today_customer_replies ?? '—'}</p> : null}{period === 'total' ? <p>累计客户回复生成：{data.summary.total_customer_replies ?? '—'}</p> : null}</section>
      </div> : null}
      <div className="hesc-kpis" hidden={web.enabled}>
        <article className="hesc-card"><div className="hesc-card-label">知识库已发布</div><div className="hesc-card-value">{data.knowledge_available ? data.knowledge.published : '—'}</div><p className="hesc-card-note">当前可用于企业问答的知识条数</p></article>
        <article className="hesc-card"><div className="hesc-card-label">知识库待审核</div><div className="hesc-card-value">{data.knowledge_available ? data.knowledge.pending_review : '—'}</div><p className="hesc-card-note">含待审核、冲突和待发布资料</p></article>
        <article className="hesc-card"><div className="hesc-card-label">今日企业/知识提问</div><div className="hesc-card-value">{data.summary.today_questions}</div><p className="hesc-card-note">只统计企业问答与知识库问答</p></article>
        <article className="hesc-card"><div className="hesc-card-label">今日智能助手回答</div><div className="hesc-card-value">{data.summary.today_answers}</div><p className="hesc-card-note">客户回复生成另行统计</p></article>
      </div>
      <div className="hesc-kpis" hidden={web.enabled}>
        <article className="hesc-card"><div className="hesc-card-label">本周智能助手回答</div><div className="hesc-card-value">{data.summary.week_answers}</div><p className="hesc-card-note">从本周一至今的成功回答</p></article>
        <article className="hesc-card"><div className="hesc-card-label">累计智能助手回答</div><div className="hesc-card-value">{data.summary.total_answers}</div><p className="hesc-card-note">服务端聚合，不保存问答正文</p></article>
        <article className="hesc-card"><div className="hesc-card-label">今日客户回复生成</div><div className="hesc-card-value">{data.summary.today_customer_replies}</div><p className="hesc-card-note">不混入“今日提问数”</p></article>
        <article className="hesc-card"><div className="hesc-card-label">本视图坐席数</div><div className="hesc-card-value">{data.scope.operator_count}</div><p className="hesc-card-note">{role === 'supervisor' ? '仅本主管组内坐席' : '当前企业的全部坐席'}</p></article>
      </div>
      {web.enabled && reminderError ? <p className="hesc-error-copy" role="alert">下属任务同步失败，以下保留上次数据：{reminderError}</p> : null}
      <WebDisclosure label={web.enabled ? `${labels.organization} · ${reminderError ? '同步失败' : `${reminderSummary.current} 条当前任务 · ${reminderSummary.overdue} 条逾期`}` : labels.organization}>
      <div className="hesc-operations-management-grid">
        <div className="hesc-operations-management-left">
          <article className="hesc-card">
            <h3 className="hesc-section-title">员工组别</h3>
            {data.groups.length ? <div className="hesc-alert-list">{data.groups.map(group => <div key={group.group_id}><strong>{group.name}</strong><span> · 负责人：{group.owner_name} · 坐席 {group.member_count} 人</span></div>)}</div> : <p className="hesc-muted-copy">暂无已配置的员工组别。</p>}
          </article>
          {data.server_time ? <WebDisclosure label={labels.diagnostics}><article className="hesc-card">
            <h3 className="hesc-section-title">服务端时间与提醒规则</h3>
            <p><strong>{data.server_time.timezone_label}</strong> · {displayedServerTime ? displayedServerTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '正在与服务端校时…'}</p>
            <p className="hesc-muted-copy">{data.server_time.reminder_rule}</p>
            <p className="hesc-muted-copy">提醒调度：{data.server_time.runner.running ? '运行中' : '未运行'} · 最近扫描：{data.server_time.runner.last_success_at ? localTime(data.server_time.runner.last_success_at) : '等待首次扫描'} · 最近就绪 {data.server_time.runner.last_ready_count ?? 0} 条</p>
          </article></WebDisclosure> : null}
        </div>
        <article className="hesc-card hesc-operations-reminder-card" data-has-reminders={data.reminders.length > 0 ? 'true' : 'false'}>
          <div className="hesc-section-heading"><div><h3 className="hesc-section-title">下属定时任务提醒（只读）</h3><p className="hesc-muted-copy">{role === 'tenant_admin' ? '企业管理员可查看坐席与主管的当前任务。' : '主管仅可查看本组坐席的当前任务。'}</p></div><span className="hesc-status" data-tone={reminderError || reminderSummary.overdue ? 'error' : 'success'}>{reminderError ? '同步失败' : `${reminderSummary.current} 条当前任务 · ${reminderSummary.overdue} 条逾期`}</span></div>
          {reminderError ? <p className="hesc-error-copy" role="alert">{reminderError}</p> : null}
          {data.reminders.length ? <div className="hesc-alert-list hesc-operations-reminder-list">{data.reminders.map(row => <div className="hesc-operations-reminder-row" data-overdue={row.overdue ? 'true' : 'false'} key={row.reminder_id}><strong>{row.owner_name} · {row.title}</strong><span>{row.group_name} · {row.overdue ? '逾期未处理 · ' : ''}{row.status_label} · 下次提醒：{localTime(row.scheduled_for)}</span></div>)}</div> : <p className="hesc-muted-copy">当前范围内暂无下属定时任务。</p>}
        </article>
      </div>
      </WebDisclosure>
      </div>
      <article className="hesc-card" data-testid="seat-activity">
        <h3 className="hesc-section-title">{web.enabled ? '坐席活跃情况' : '坐席活跃度'}</h3>
        <p className="hesc-muted-copy">“今日提问数”只含企业问答和知识库问答；客户回复生成单独列出。</p>
        {data.staff.length ? <div className="hesc-table-wrap hesc-scroll-region hesc-operations-staff-list"><table className="hesc-table"><thead><tr><th>坐席</th><th>组别</th><th>今日提问</th><th>今日回答</th><th>本周回答</th><th>累计回答</th><th>今日客户回复</th></tr></thead><tbody>{data.staff.map(staff => <tr key={staff.principal_id}><td>{staff.name}<br /><span className="hesc-muted-copy">{staff.login_name}</span></td><td>{staff.group_name}</td><td>{staff.today_questions}</td><td>{staff.today_answers}</td><td>{staff.week_answers}</td><td>{staff.total_answers}</td><td>{staff.today_customer_replies}</td></tr>)}</tbody></table></div> : <p className="hesc-muted-copy">当前范围内没有已分组坐席。</p>}
      </article>
    </> : null}
  </section>
}
