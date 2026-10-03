import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'
import { $enterpriseReminderTasks, $personalReminders, $reminderSync, type ReminderCenterTask, type FollowupScopeOptions } from './reminder-state'
import { FollowupFilterBar, filterFollowups, initialFollowupFilters, useFollowupStatus } from './followup-filters'
import { ReminderRepeatTracker, type ReminderCue } from './reminder-repeat'
import { ReminderSound } from './reminder-sound'
import { FollowupPendingActions } from './followup-pending-action'
import { ReceivableLedger } from './receivable-ledger'
import { useDeliveryCopy } from './delivery-copy'
import { Button } from '@/components/ui/button'
import { useWebPresentation } from './web-presentation'
import { useWebLayoutCopy } from './web-sections'
import { beijingReminderInput, beijingReminderSeconds } from './web-reminder-time'

interface Reminder { reminder_id: string; title: string; scheduled_for: number; state: string; resolution?: string; resolved_at?: number; resolved_by?: string; owner_name?: string; generation?: number; overdue?: boolean }
interface ReminderCenterPayload { tasks?: ReminderCenterTask[]; scope_options?: FollowupScopeOptions; personal_history?: Reminder[] | null }
interface FollowupDetailPayload { followup?: ReminderCenterTask }
interface FollowupAction { task: ReminderCenterTask; kind: 'result' | 'reschedule' }
function occurrenceKey(row: Reminder): string {
  return `${row.reminder_id}:${row.generation ?? row.scheduled_for}`
}
interface Draft { title: string; scheduled_for: number | null; clarification: string; planning_notice?: string }
interface ReminderProps {
  history?: ReactNode
  selectedFollowup?: ReminderCenterTask | null
  runtime: EnterpriseClientRuntime
  scope: string
  inline?: boolean
  open: boolean
  request: string
  inboxRequest?: number
  onClose: () => void
  onInspect?: (task: ReminderCenterTask) => void
}

function localInput(seconds: number): string {
  const date = new Date(seconds * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function localDate(value: string): string { return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : '' }
function localTime(value: string): string { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value.slice(11, 16) : '' }
function withDate(value: string, date: string, defaultHour: number): string {
  return date ? `${date}T${localTime(value) || `${String(defaultHour).padStart(2, '0')}:00`}` : ''
}
function withTime(value: string, time: string): string {
  return time ? `${localDate(value) || localDate(localInput(Date.now() / 1000))}T${time}` : ''
}
function isOverdue(row: Reminder): boolean { return row.overdue ?? (row.state === 'active' && row.scheduled_for <= Date.now() / 1000) }
function taskTime(row: ReminderCenterTask, beijing = false): string {
  return row.next_followup_at ? new Date(row.next_followup_at).toLocaleString('zh-CN', beijing ? { timeZone: 'Asia/Shanghai' } : undefined) : '待确认'
}
function taskStatus(row: ReminderCenterTask): string {
  return ({ pending_followup: '待跟进', due_today: '今日待处理', overdue: '逾期未处理', awaiting_reschedule: '等待改期', paid: '已收款', reminder_cancelled: '已取消提醒', closed: '已关闭' } as Record<string, string>)[row.task_status] ?? row.status
}
function taskKey(row: ReminderCenterTask): string { return `${row.source_type}:${row.source_id}:${row.reminder_generation ?? row.next_followup_at ?? ''}` }
function readSoundPreference(scope: string) {
  try {
    const value = JSON.parse(localStorage.getItem(`hermes-reminder-sound:${scope}`) ?? '{}')
    return {enabled:value.enabled !== false, volume:typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 1}
  } catch {return {enabled:true, volume:1}}
}

export function AssistantReminders({ runtime, scope, open, request, onClose, inline, selectedFollowup, history, onInspect, inboxRequest }: ReminderProps) {
  const web = useWebPresentation()
  const layout = useWebLayoutCopy()
  const [section, setSection] = useState('tasks')
  const [managedHistory, setManagedHistory] = useState<Reminder[] | null>(null)
  const [createMode, setCreateMode] = useState('ai')
  const secondsFor = (value: string) => web.enabled ? beijingReminderSeconds(value) : new Date(value).getTime() / 1000
  const inputFor = (seconds: number) => web.enabled ? beijingReminderInput(seconds) : localInput(seconds)
  const setTime = (value: string, time: string) => web.enabled ? (time ? `${localDate(value) || inputFor(Date.now()/1000).slice(0,10)}T${time}` : '') : withTime(value,time)
  const displayTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('zh-CN', web.enabled ? { timeZone: 'Asia/Shanghai' } : undefined)
  const copy = useDeliveryCopy()
  const [rows, setRows] = useState<Reminder[]>([])
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [shift, setShift] = useState(() => {
    try { return localStorage.getItem(`hermes-reminder-shift:${scope}`) === '14' ? 14 : 9 } catch { return 9 }
  })
  const [rescheduling, setRescheduling] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [dueNotice, setDueNotice] = useState<Reminder | null>(null)
  const [allTasks, setTasks] = useState<ReminderCenterTask[]>([])
  const [scopeOptions, setScopeOptions] = useState<FollowupScopeOptions>()
  const [memberFilters, setMemberFilters] = useState(initialFollowupFilters)
  const followupStatus = useFollowupStatus()
  const [taskFilter, setTaskFilter] = useState<'all' | 'receivable' | 'personal' | 'overdue' | 'pending'>('all')
  useEffect(() => {
    if (!inboxRequest) return
    setSection('tasks')
    setTaskFilter('all')
    setMemberFilters(initialFollowupFilters())
    document.getElementById('reminder-inbox-title')?.scrollIntoView({block:'start'})
  }, [inboxRequest])
  const tasks = (web.enabled ? filterFollowups(allTasks, memberFilters, scopeOptions?.current_principal_id || '') : allTasks).filter(task => taskFilter === 'all'
    || (taskFilter === 'receivable' && task.source_type === 'receivable_followup')
    || (taskFilter === 'personal' && task.source_type === 'assistant_personal')
    || (taskFilter === 'overdue' && task.overdue)
    || (taskFilter === 'pending' && ['pending_followup', 'due_today', 'awaiting_reschedule'].includes(task.task_status)))
  const [followupAction, setFollowupAction] = useState<FollowupAction | null>(null)
  const [followupDate, setFollowupDate] = useState('')
  const [followupDetail, setFollowupDetail] = useState<ReminderCenterTask | null>(null)
  useEffect(() => {
    if (!open || !selectedFollowup) {return}
    let active = true
    setFollowupDetail(null); setFollowupAction(null)
    void runtime.get<FollowupDetailPayload>(`/api/business-followups?followup_id=${encodeURIComponent(selectedFollowup.source_id)}`).then(result => {
      if (!result.followup || !Array.isArray(result.followup.allowed_actions)) {throw new Error('invalid followup')}
      if (active) {setFollowupDetail(result.followup); setFollowupAction(result.followup.allowed_actions.length ? { task: result.followup, kind: 'result' } : null)}
    }).catch(() => {if (active) {setError('应收款详情未读取成功，请检查连接和权限后重试。')}})
    return () => {active = false}
  }, [open, selectedFollowup, runtime])
  const alive = useRef(true)
  const readRevision = useRef(0)
  const loadingRequest = useRef(false)
  const reloadQueued = useRef(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const personalCues = useRef(new ReminderRepeatTracker())
  const followupCues = useRef(new ReminderRepeatTracker())
  const sound = useRef(new ReminderSound())
  const [soundPreference, setSoundPreference] = useState(() => readSoundPreference(scope))
  const soundPreferenceRef = useRef(soundPreference)
  soundPreferenceRef.current = soundPreference
  const [soundError, setSoundError] = useState(false)
  const submitting = useRef(false)
  const processed = useRef('')
  const idempotencyKey = useRef(crypto.randomUUID())
  const followupActionKeys = useRef(new FollowupPendingActions())
  const dialogRef = useRef<HTMLElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)
  const work = useRef({ busy, content, title, due })
  work.current = { busy, content, title, due }

  useEffect(() => {
    alive.current = true
    let storage: Storage | undefined
    try {storage = window.localStorage} catch { /* Storage may be disabled. */ }
    personalCues.current = new ReminderRepeatTracker(storage, `hermes-reminder-cues:personal:${scope}`)
    followupCues.current = new ReminderRepeatTracker(storage, `hermes-reminder-cues:followup:${scope}`)
    followupActionKeys.current = new FollowupPendingActions()
    setDueNotice(null)
    setSoundPreference(readSoundPreference(scope))
    setRows([]); setTasks([]); setHasSnapshot(false); setSyncFailed(false)
    setManagedHistory(null)
    setScopeOptions(undefined); setMemberFilters(initialFollowupFilters())
    setFollowupDetail(null); setFollowupAction(null)
    loadingRequest.current = false; reloadQueued.current = false
    const activity = registerEnterpriseInstallActivity({ blocker: () => work.current.busy
      ? '提醒正在保存，请等待完成后更新。' : work.current.title || work.current.content || work.current.due
        ? '提醒草稿尚未提交，请保存或清空后更新。' : null, stopPlayback: async () => sound.current.stop() })
    return () => { alive.current = false; ++readRevision.current; sound.current.stop(); activity.dispose() }
  }, [runtime, scope])

  const load = useCallback(async (): Promise<void> => {
    if (loadingRequest.current) {reloadQueued.current = true; return}
    loadingRequest.current = true
    const revision = ++readRevision.current
    const previousSync = $reminderSync.get()
    $reminderSync.set({scope, loading: true, failed: false, lastSuccess: previousSync?.scope === scope ? previousSync.lastSuccess : null})
    try {
      const [personalResult, centreResult] = await Promise.allSettled([
        runtime.get<{ reminders: Reminder[] }>('/api/assistant-reminders'),
        runtime.get<ReminderCenterPayload>('/api/reminder-center?filter=all&scope=combined')
      ])
      if (!alive.current || revision !== readRevision.current) {return}
      const result = personalResult.status === 'fulfilled' && Array.isArray(personalResult.value.reminders) ? personalResult.value : null
      const centre = centreResult.status === 'fulfilled' && Array.isArray(centreResult.value.tasks) ? centreResult.value : null
      const failed = !result || !centre
      setSyncFailed(failed)
      if (result) {
        setRows(result.reminders)
        $personalReminders.set({ scope, rows: result.reminders })
      }
      $reminderSync.set({scope, loading: false, failed, lastSuccess: centre ? Date.now() : previousSync?.scope === scope ? previousSync.lastSuccess : null})
      const announcements: (ReminderCue & { repeated: boolean })[] = []
      if (centre) {
        const all = centre
        setHasSnapshot(true)
        setTasks(all.tasks ?? [])
        setManagedHistory(web.enabled ? all.personal_history ?? null : null)
        setScopeOptions(all.scope_options)
        if (Array.isArray(all.tasks) && !$enterprisePackageInstallFrozen.get()) {
          $enterpriseReminderTasks.set({ scope, rows: all.tasks, scope_options: all.scope_options })
          announcements.push(...followupCues.current.reconcile(all.tasks
            .filter(task => task.source_type === 'receivable_followup' && task.overdue && task.allowed_actions.some(action => action !== 'admin_delete'))
            .map(task => ({ id: task.source_id, occurrence: taskKey(task), status: JSON.stringify([task.status, task.updated_at]),
              title: task.business_subject, body: `${task.business_subject} · ${taskTime(task, web.enabled)}` })), Date.now()))
        }
      }
      if (!alive.current || revision !== readRevision.current || $enterprisePackageInstallFrozen.get()) {return}
      if (result) {announcements.push(...personalCues.current.reconcile(result.reminders
        .filter(row => row.state === 'active' && isOverdue(row))
        .map(row => ({ id: row.reminder_id, occurrence: occurrenceKey(row), status: row.state,
          title: row.title, body: row.title })), Date.now()))}
      if (announcements.length) {
        const first = announcements[0]
        setDueNotice({ reminder_id: first.id, title: first.title, scheduled_for: Date.now() / 1000, state: 'active' })
        void window.hermesDesktop?.notify({ title: 'Hermes · ' + copy.reminderCueTitle,
          body: announcements.map(row => `${row.repeated ? copy.reminderRepeatPrefix : ''}${row.body}`).join('\n').slice(0, 500),
          tag: `${scope}:${first.occurrence}:${first.repeated ? 'repeat' : 'first'}`, silent: true })?.catch(() => {})
        if (soundPreferenceRef.current.enabled) {
          void sound.current.play(soundPreferenceRef.current.volume).then(ok => {if (alive.current && revision === readRevision.current) {setSoundError(!ok)}})
        }
      }
    } catch {
      if (alive.current && revision === readRevision.current) {
        setSyncFailed(true)
        $reminderSync.set({scope, loading: false, failed: true, lastSuccess: previousSync?.scope === scope ? previousSync.lastSuccess : null})
      }
    } finally {
      if (alive.current && revision === readRevision.current) {
        loadingRequest.current = false
        if (reloadQueued.current) {reloadQueued.current = false; void load()}
      }
    }
  }, [runtime, scope, copy])

  useEffect(() => {
    void load()
    const reload = () => {
      void load()
    }
    const timer = window.setInterval(reload, 15_000)
    window.addEventListener('focus', reload)
    window.addEventListener('online', reload)
    const followupChanged = (event: Event) => {
      if ((event as CustomEvent).detail?.scope === scope) {void load()}
    }
    window.addEventListener('hermes:followup-changed', followupChanged)
    document.addEventListener('visibilitychange', reload)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', reload)
      window.removeEventListener('online', reload)
      window.removeEventListener('hermes:followup-changed', followupChanged)
      document.removeEventListener('visibilitychange', reload)
    }
  }, [load, scope])

  useEffect(() => {
    if (!open) {processed.current = ''; return}
    setError(''); void load()
    if (request.trim() && processed.current !== request) {
      processed.current = request; setContent(request)
      void perform(() => prepareFromText(request))
    }
  }, [open, request, load])

  useEffect(() => {
    if (!open || inline) {
      return
    }

    restoreFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusable = () => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.getAttribute('aria-hidden') !== 'true') : []
    focusable()[0]?.focus()

    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()

        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const controls = focusable()

      if (controls.length === 0) {
        event.preventDefault()
        dialog?.focus()

        return
      }

      const first = controls[0]
      const last = controls[controls.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', keepFocusInDialog)

    return () => {
      window.removeEventListener('keydown', keepFocusInDialog)
      restoreFocusTo.current?.focus()
      restoreFocusTo.current = null
    }
  }, [inline, onClose, open])

  async function prepareFromText(text: string) {
    const draft = await runtime.post!<Draft>('/api/assistant-reminder-action', { action: 'prepare', content: text, default_hour: shift })
    if (!alive.current) {return}
    setTitle(draft.title); setDue(draft.scheduled_for ? inputFor(draft.scheduled_for) : '')
    if (web.enabled) { setSection('create'); setCreateMode('manual') }
    if (!draft.title || !draft.scheduled_for || draft.clarification) {
      setNotice(draft.clarification || '请补充明确的提醒事项和时间。'); return
    }
    setNotice(draft.planning_notice || `AI 已整理提醒草稿：${draft.title}。请核对时间后确认创建。`)
  }

  async function confirmDraft() {
    const scheduledFor = secondsFor(due)
    if (!title.trim() || !Number.isFinite(scheduledFor)) {
      setNotice('请先补充有效的提醒事项和时间。')
      return
    }
    await runtime.post!('/api/assistant-reminder-action', { action: 'create', title: title.trim(), scheduled_for: scheduledFor, idempotency_key: idempotencyKey.current })
    if (!alive.current) {return}
    idempotencyKey.current = crypto.randomUUID(); setContent(''); setTitle(''); setDue('')
    setNotice(`已创建：${title.trim()} · ${displayTime(scheduledFor)}。已保存到服务器。`)
    await load()
  }

  async function perform(action: () => Promise<void>) {
    if (submitting.current || $enterprisePackageInstallFrozen.get()) {return}
    submitting.current=true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { if (alive.current) {setError(reason instanceof Error ? reason.message : '提醒操作未完成，请重试。')} }
    finally {submitting.current=false;if (alive.current) {setBusy(false)}}
  }

  const actionRows = rows.filter(row => row.state === 'active' || row.state === 'exhausted')

  async function submitFollowupAction(task: ReminderCenterTask, action: 'received' | 'reschedule' | 'cancel' | 'close') {
    if (action === 'reschedule' && !followupDate) { setError('请选择新的预计到账日期。'); return }
    const request = followupActionKeys.current.request(task.source_id, action, action === 'reschedule' ? followupDate : undefined)
    const result = await runtime.post!<{ followup?: { expected_receive_date?: string } }>('/api/business-followup-action', request)
    if (action === 'reschedule' && result.followup?.expected_receive_date !== request.expected_receive_date) {
      throw new Error('服务端返回日期与本次提交不一致，请刷新核对后再操作。')
    }
    followupActionKeys.current.confirm(task.source_id, action)
    window.dispatchEvent(new CustomEvent('hermes:followup-changed', { detail: { scope } }))
    setFollowupAction(null)
    setFollowupDate('')
    setFollowupDetail(null)
    setNotice(({ received: '已确认收款，原始应收款记录和提醒状态已同步。', reschedule: '新的跟进日期已保存，旧周期不会继续作为待办。', cancel: '仅提醒已取消；应收款业务事实和历史记录仍被保留。', close: '应收款跟进已关闭，不会被标记为已收款。' } as Record<string, string>)[action])
    await load()
  }

  async function viewFollowup(task: ReminderCenterTask) {
    const result = await runtime.get<FollowupDetailPayload>(`/api/business-followups?followup_id=${encodeURIComponent(task.source_id)}`)
    if (!alive.current) { return }
    setFollowupDetail(result.followup ?? task)
  }

  return <>
    {dueNotice ? <div className="hesc-reminder-toast" role="alert"><div><strong>到时间了 · {dueNotice.title}</strong><span>该事项仍待处理；可在“我的提醒”中完成或改期。</span></div><button type="button" className="hesc-action" onClick={() => setDueNotice(null)}>稍后处理</button></div> : null}
    {open ? <div className={inline ? "hesc-page" : "hesc-reminder-backdrop"}><section aria-label="智能助理定时提醒" aria-modal={inline ? undefined : true} className="hesc-card hesc-reminder-dialog" data-inline={inline ? 'true' : undefined} ref={dialogRef} role={inline ? undefined : 'dialog'} tabIndex={inline ? undefined : -1}>
      <header className="hesc-section-heading"><div><h2>提醒中心</h2><p>{web.enabled ? '管理待办，或新建定时提醒。' : '用一句话安排事项和时间，AI 先整理草稿，确认后才保存到企业服务器。运行时通知，退出期间到期的事项下次登录补提醒。'}</p></div>{!inline ? <button className="hesc-action" type="button" onClick={onClose}>收起</button> : null}</header>
      {web.enabled ? <div className="web-section-tabs" role="group" aria-label={layout.settings}>{[['tasks',layout.tasks],['create',layout.create],['history',layout.history],['settings',layout.notifications]].map(([id,label]) => <Button key={id} variant={section === id ? 'default' : 'outline'} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</Button>)}</div> : null}
      <div hidden={web.enabled && section !== 'settings'} style={!web.enabled ? {display:'contents'} : undefined}>
      {history}
      <div className="hesc-inline-actions"><p>{copy.reminderRepeatHint}</p>
        <label><input type="checkbox" checked={soundPreference.enabled} onChange={event => {
          const next = {...soundPreference, enabled:event.target.checked}; setSoundPreference(next)
          if (!next.enabled) {sound.current.stop(); setSoundError(false)}
          try {localStorage.setItem(`hermes-reminder-sound:${scope}`, JSON.stringify(next))} catch { /* Applies in this session. */ }
        }} />提醒提示音</label>
        <label>音量<input type="range" min="0" max="1" step="0.1" value={soundPreference.volume} onChange={event => {
          const next = {...soundPreference, volume:Number(event.target.value)}; setSoundPreference(next)
          try {localStorage.setItem(`hermes-reminder-sound:${scope}`, JSON.stringify(next))} catch { /* Applies in this session. */ }
        }} /></label>
        <Button size="sm" type="button" onClick={() => void sound.current.play(soundPreference.volume).then(ok => setSoundError(!ok))}>{copy.reminderSoundTest}</Button>
      </div>
      {soundError ? <p role="status">{copy.reminderSoundFailed}</p> : null}
      </div>
      {web.enabled && section === 'create' ? <div className="web-section-tabs" role="group" aria-label={layout.create}>{[['ai',layout.ai],['manual',layout.manual]].map(([id,label]) => <Button key={id} variant={createMode === id ? 'default' : 'outline'} aria-pressed={createMode === id} onClick={() => setCreateMode(id)}>{label}</Button>)}</div> : null}
      {web.enabled && notice ? <p role="status">{notice}</p> : null}{web.enabled && error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
      <div className="hesc-reminder-layout">
      <div className="hesc-reminder-primary">
      <div className="web-reminder-compose" style={!web.enabled ? {display:'contents'} : undefined} hidden={web.enabled && (section !== 'create' || createMode !== 'ai')}>
      <label>用一句话安排提醒<textarea aria-label="提醒要求" placeholder="例如：明天下午三点提醒我回访客户，核实材料进度" value={content} onChange={event => setContent(event.target.value)} /></label>
      <label>我的默认班次<select aria-label="我的默认班次" value={shift} onChange={event => {
        const value = Number(event.target.value) === 14 ? 14 : 9
        setShift(value)
        try { localStorage.setItem(`hermes-reminder-shift:${scope}`, String(value)) } catch { /* preference still applies this session */ }
      }}><option value={9}>上午班 · 09:00</option><option value={14}>下午班 · 14:00</option></select><small>未指定具体时刻时使用班次时间（北京时间）。</small></label>
      <button className="hesc-action" disabled={busy || !content.trim()} type="button" onClick={() => void perform(() => prepareFromText(content))}>{busy ? 'AI 正在整理…' : 'AI 解析并预览'}</button>
      {title && due ? <div className="hesc-ai-reminder-note" role="status"><strong>AI 整理的提醒草稿</strong><span>{title} · {displayTime(secondsFor(due))}</span><span>请核对事项和时间；如需修改，可在下方手动调整。</span><button className="hesc-action" disabled={busy} type="button" onClick={() => void perform(confirmDraft)}>确认保存该草稿</button></div> : null}
      {!web.enabled && notice ? <p role="status">{notice}</p> : null}{!web.enabled && error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
      </div>
      <section className="hesc-reminder-inbox" hidden={web.enabled && section !== 'tasks'} aria-labelledby="reminder-inbox-title">
        <div className="hesc-reminder-inbox-heading"><div><h3 id="reminder-inbox-title">统一任务收件箱</h3>{!web.enabled ? <p className="hesc-muted-copy">应收款跟进只显示来源摘要；处理结果和改期会回写原始业务记录。</p> : null}</div></div>
        <div className="hesc-reminder-filters" role="group" aria-label="提醒筛选">
          {([['all', '全部'], ['receivable', '应收款'], ['personal', '个人提醒'], ['overdue', '逾期未处理'], ['pending', '待跟进']] as const).map(([filter, label]) => <button aria-pressed={taskFilter === filter} className="hesc-reminder-filter" key={filter} onClick={() => setTaskFilter(filter)} type="button">{label}</button>)}
        </div>
        {web.enabled ? <FollowupFilterBar rows={allTasks} value={memberFilters} onChange={setMemberFilters} scopeOptions={scopeOptions} statuses={[...new Set(allTasks.map(task => task.status))].map(value => ({value,label:followupStatus(value)}))}/> : null}
        {syncFailed ? <p role="alert">{copy.failed} <Button variant="outline" onClick={() => void load()}>{copy.refresh}</Button></p> : null}
        {!hasSnapshot && !syncFailed ? <p role="status">{copy.loading}</p> : null}
        {tasks.length === 0 && hasSnapshot && !syncFailed ? <p className="hesc-muted-copy">当前筛选下暂无待处理任务。</p> : <div className="hesc-reminder-task-list">
          {tasks.map(task => <article className="hesc-reminder-task" data-overdue={task.overdue} key={`${task.source_type}:${task.source_id}`}>
            <div className="hesc-reminder-task-summary">
              <div className="hesc-reminder-task-tags"><span className="hesc-reminder-source">{task.task_source_label}</span>{task.overdue ? <span className="hesc-reminder-risk">逾期风险</span> : null}<span>{taskStatus(task)}</span></div>
              <strong>{task.business_subject}</strong>
              <dl className="hesc-reminder-task-meta"><div><dt>计划跟进</dt><dd>{taskTime(task, web.enabled)}</dd></div><div><dt>负责人</dt><dd>{task.owner_name}</dd></div>{task.source_type === 'receivable_followup' ? <div><dt>应收金额</dt><dd>{task.amount} {task.currency}</dd></div> : null}</dl>
            </div>
            <div className="hesc-reminder-task-actions">
              {onInspect ? <Button variant="outline" onClick={() => onInspect(task)}>查看详情</Button> : task.source_type === 'receivable_followup' ? <><button className="hesc-text-action" onClick={() => void perform(() => viewFollowup(task))} type="button">查看详情</button>{task.allowed_actions.includes('reschedule') ? <button className="hesc-action" disabled={busy} onClick={() => { setFollowupAction({ task, kind: 'reschedule' }); setFollowupDate(task.next_followup_at?.slice(0, 10) ?? '') }} type="button">改期跟进</button> : null}{task.allowed_actions.some(action => ['received', 'cancel', 'close'].includes(action)) ? <button className="hesc-action" disabled={busy} onClick={() => { setFollowupAction({ task, kind: 'result' }); setFollowupDate('') }} type="button">处理结果</button> : null}</> : <span className="hesc-muted-copy">个人提醒可在下方管理</span>}
            </div>
          </article>)}
        </div>}
        {followupAction ? <form className="hesc-followup-action-form" onSubmit={event => { event.preventDefault(); if (followupAction.kind === 'reschedule') { void perform(() => submitFollowupAction(followupAction.task, 'reschedule')) } }}>
          <div><strong>{followupAction.kind === 'reschedule' ? '改期继续跟进' : '选择处理结果'}</strong><p className="hesc-muted-copy">{followupAction.task.business_subject}</p></div>
          {followupAction.kind === 'reschedule' ? <label>新的预计到账日期<input aria-label="新的预计到账日期" min={new Date().toISOString().slice(0, 10)} onChange={event => setFollowupDate(event.target.value)} required type="date" value={followupDate} /></label> : <div className="hesc-inline-actions"><button className="hesc-action" disabled={busy || !followupAction.task.allowed_actions.includes('received')} onClick={() => void perform(() => submitFollowupAction(followupAction.task, 'received'))} type="button">已收款</button><button className="hesc-action" disabled={busy || !followupAction.task.allowed_actions.includes('cancel')} onClick={() => void perform(() => submitFollowupAction(followupAction.task, 'cancel'))} type="button">取消提醒</button><button className="hesc-text-action" disabled={busy || !followupAction.task.allowed_actions.includes('close')} onClick={() => void perform(() => submitFollowupAction(followupAction.task, 'close'))} type="button">关闭跟进</button></div>}
          {followupAction.kind === 'result' && followupAction.task.allowed_actions.includes('reschedule') ? <button className="hesc-action" disabled={busy} type="button" onClick={() => {setFollowupAction({task: followupAction.task, kind: 'reschedule'}); setFollowupDate(followupAction.task.next_followup_at?.slice(0, 10) ?? '')}}>改期继续跟进</button> : null}
          {followupAction.kind === 'reschedule' ? <button className="hesc-action" disabled={busy || !followupDate} type="submit">保存新的跟进日期</button> : null}<button className="hesc-text-action" disabled={busy} onClick={() => { setFollowupAction(null); setFollowupDate('') }} type="button">返回</button>
        </form> : null}
        {followupDetail ? <section className="hesc-followup-detail" aria-label="应收款跟进详情"><div><h4>{followupDetail.business_subject}</h4><p>来源：应收款跟进 · 负责人：{followupDetail.owner_name}</p><p>应收金额：{followupDetail.amount} {followupDetail.currency} · 预计到账：{taskTime(followupDetail, web.enabled)}</p></div><button className="hesc-text-action" onClick={() => setFollowupDetail(null)} type="button">关闭详情</button></section> : null}
        {followupDetail ? <ReceivableLedger key={`${scope}:${followupDetail.source_id}`} runtime={runtime} scope={scope} followupId={followupDetail.source_id} /> : null}
      </section>
      {(!web.enabled || !onInspect || syncFailed) ? <><h3>个人提醒管理</h3>
      {rescheduling ? <form onSubmit={event => { event.preventDefault(); void perform(async () => {
        await runtime.post!('/api/assistant-reminder-action', { action: 'reschedule', reminder_id: rescheduling, scheduled_for: secondsFor(nextDue) })
        setRescheduling(''); setNextDue(''); setDueNotice(null); setNotice('下次跟进时间已保存到服务器，到期会再次提醒。'); await load()
      }) }}><div className="hesc-inline-actions"><label>下次跟进日期（点选日历）<input aria-label="下次跟进日期" type="date" required value={localDate(nextDue)} onChange={event => setNextDue(withDate(nextDue, event.target.value, shift))} /></label><label>下次跟进时间<input aria-label="下次跟进时间" type="time" required value={localTime(nextDue)} onChange={event => setNextDue(setTime(nextDue, event.target.value))} /></label></div><button className="hesc-action" disabled={busy || !nextDue} type="submit">保存跟进时间</button><button type="button" className="hesc-text-action" onClick={() => setRescheduling('')}>返回</button></form> : null}
      {actionRows.length === 0 && !syncFailed && hasSnapshot ? <p>暂无待处理提醒。</p> : null}
      {actionRows.map(row => <div className="hesc-outbound-item" key={row.reminder_id}><div><strong>{row.title}</strong><span>{displayTime(row.scheduled_for)}</span>{row.state === 'exhausted' ? <span>上次通知未成功送达，请重新安排时间。</span> : isOverdue(row) ? <span>已到期，等待处理。</span> : null}</div><button className="hesc-action" disabled={busy} type="button" onClick={() => { setRescheduling(row.reminder_id); setNextDue(inputFor(Math.max(Date.now() / 1000 + 300, row.scheduled_for))) }}>{row.state === 'exhausted' ? '重新安排' : '改期跟进'}</button>{(['complete','cancel'] as const).map(action => <button key={action} className="hesc-action" disabled={busy} onClick={() => void perform(async () => { await runtime.post!('/api/assistant-reminder-action', {action,reminder_id:row.reminder_id}); if (dueNotice?.reminder_id === row.reminder_id) {setDueNotice(null)}; setNotice(action === 'complete' ? '提醒已完成并从待处理列表移除。' : '提醒已取消，未标记为完成。'); await load() })} type="button">{action === 'complete' ? '完成并移除' : '取消提醒'}</button>)}</div>)}
      </> : null}
      <details hidden={web.enabled && section !== 'history'} open={web.enabled ? true : undefined}><summary>{managedHistory ? '企业定时提醒处理记录' : '个人提醒处理记录'}</summary>{(managedHistory ?? rows).filter(row => row.state === 'cancelled').sort((a, b) => (b.resolved_at ?? 0) - (a.resolved_at ?? 0)).map(row => <div className="hesc-outbound-item" key={row.reminder_id}><strong>{row.title}</strong>{web.enabled && row.owner_name ? <span>所属成员：{row.owner_name}</span> : null}<span>{row.resolution === 'admin_deleted' ? '管理员删除' : row.resolution === 'completed' ? '已完成' : row.resolution === 'cancelled' ? '已取消' : '历史已结束（未记录处理方式）'}</span>{web.enabled && row.resolved_by ? <span>操作人：{row.resolved_by}</span> : null}<span>{row.resolved_at ? new Date(row.resolved_at * 1000).toLocaleString('zh-CN', web.enabled ? {timeZone:'Asia/Shanghai'} : undefined) : '处理时间未记录'}</span></div>)}</details>
      </div>
      <aside className="hesc-reminder-manual" hidden={web.enabled && (section !== 'create' || createMode !== 'manual')} aria-label="手动设置事项和时间">
      <h3>手动设置事项和时间</h3>
      <p className="hesc-muted-copy">不使用 AI 解析时，直接选择日期、时间并创建提醒。</p>
      <form className="hesc-agent-composer" onSubmit={event => { event.preventDefault(); void perform(async () => {
        await runtime.post!('/api/assistant-reminder-action', { action: 'create', title, scheduled_for: secondsFor(due), idempotency_key: idempotencyKey.current })
        if (!alive.current) {return}
        idempotencyKey.current = crypto.randomUUID(); setContent(''); setTitle(''); setDue(''); setNotice('提醒已保存到服务器。'); await load()
      }) }}>
        <label>提醒事项<input aria-label="个人提醒事项" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="hesc-inline-actions"><label>提醒日期（点选日历）<input aria-label="个人提醒日期" required type="date" value={localDate(due)} onChange={event => setDue(withDate(due, event.target.value, shift))} /></label><label>提醒时间{web.enabled ? '（北京时间）' : ''}<input aria-label="个人提醒时间" required type="time" value={localTime(due)} onChange={event => setDue(setTime(due, event.target.value))} /></label></div>
        <div className="hesc-inline-actions"><button className="hesc-action" disabled={busy || !title.trim() || !due} type="submit">确认创建提醒</button><button className="hesc-text-action" disabled={busy} type="button" onClick={() => {setContent('');setTitle('');setDue('')}}>清空草稿</button></div>
      </form>
      </aside>
      </div>
    </section></div> : null}
  </>
}
