import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { ReceivableLedger } from '../receivable-ledger'
import { EnterpriseClientError, type EnterpriseClientRuntime } from '../runtime'
import type { ReminderCenterTask } from '../reminder-state'
import { statusLabels } from './receivables-data'
import { ReceivableWriteoff } from './receivable-writeoff'

interface TaskDetailsProps {
  runtime: EnterpriseClientRuntime
  scope: string
  task: ReminderCenterTask
  onClose(): void
}
interface TaskDetail extends ReminderCenterTask {
  resolution?: string
  expected_receive_date?: string
  receivable_date?: string
}
interface PendingAction {
  action: string
  followup_id?: string
  reminder_id?: string
  idempotency_key?: string
  expected_receive_date?: string
  scheduled_for?: number
}
const actions: Record<string, string> = {
  confirm: '确认建立跟进',
  received: '确认全部收款',
  reschedule: '改期跟进',
  cancel: '取消提醒',
  close: '关闭跟进',
  complete: '完成提醒',
  admin_delete: '管理员删除'
}

export function WebTaskDetails({ runtime, scope, task, onClose }: TaskDetailsProps) {
  const receivable = task.source_type === 'receivable_followup'
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [revision, refresh] = useState(0)
  const [ledgerRevision, refreshLedger] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState('')
  const [date, setDate] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [writeoffLocked, setWriteoffLocked] = useState(false)
  const [writeoffBusy, setWriteoffBusy] = useState(false)
  const pending = useRef<PendingAction | null>(null)
  const writing = useRef(false)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const recoveryKey = `hermes:web-task-action:${scope}:${task.source_type}:${task.source_id}`
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(recoveryKey)
      if (saved) {
        const value: PendingAction = JSON.parse(saved)
        if ((receivable ? value.followup_id : value.reminder_id) !== task.source_id || !actions[value.action])
          throw new Error('invalid recovery')
        pending.current = value
        setUncertain(true)
        setAction(value.action)
        setDate(value.expected_receive_date ?? '')
      }
    } catch {
      setUncertain(true)
      setError('未确认操作无法恢复，请先核对任务记录，勿重复提交。')
    }
  }, [recoveryKey, receivable, task.source_id])
  useEffect(() => {
    let alive = true
    setLoading(true)
    const read = async (): Promise<TaskDetail> => {
      if (receivable) {
        const result = await runtime.get<{ followup: TaskDetail }>(
          `/api/business-followups?followup_id=${encodeURIComponent(task.source_id)}`
        )
        if (result.followup?.source_id !== task.source_id || !Array.isArray(result.followup.allowed_actions))
          throw new Error('invalid detail')
        return result.followup
      }
      const result = await runtime.get<{
        reminders: { reminder_id: string; title: string; scheduled_for: number; state: string; resolution?: string; allowed_actions?: string[]; resolved_by?: string; resolved_at?: number }[]
      }>(`/api/assistant-reminders?reminder_id=${encodeURIComponent(task.source_id)}`)
      const row = result.reminders.find(item => item.reminder_id === task.source_id)
      if (!row) throw new Error('not available')
      return {
        ...task,
        business_subject: row.title,
        status: row.resolution || row.state,
        next_followup_at: new Date(row.scheduled_for * 1000).toISOString(),
        allowed_actions: ['active', 'exhausted'].includes(row.state) ? (row.allowed_actions ?? task.allowed_actions) : []
      }
    }
    void read()
      .then(result => {
        if (alive) setDetail(result)
      })
      .catch(() => {
        if (alive) {
          setDetail(null)
          setError('此任务未能读取，可能已变更或无权访问。请重试。')
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [runtime, scope, task, receivable, revision])
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.scope === scope) refresh(value => value + 1)
    }
    window.addEventListener('hermes:followup-changed', changed)
    return () => window.removeEventListener('hermes:followup-changed', changed)
  }, [scope])
  const submit = async () => {
    if (writing.current || !runtime.post || (!pending.current && !detail?.allowed_actions.includes(action))) return
    if (uncertain && !pending.current) return
    setError('')
    setNotice('')
    try {
      if (receivable && sessionStorage.getItem(`hermes:receivable-pending:${scope}:${task.source_id}`))
        throw new Error('请先在流水区确认上次未完成的提交，再更新任务状态。')
      if (!pending.current) {
        if (action === 'reschedule' && (!date || (!receivable && !Number.isFinite(Date.parse(`${date}+08:00`)))))
          throw new Error('请选择有效的新日期／时间。')
        pending.current = receivable
          ? {
              action,
              followup_id: task.source_id,
              idempotency_key: crypto.randomUUID(),
              ...(action === 'reschedule' ? { expected_receive_date: date } : {})
            }
          : {
              action,
              reminder_id: task.source_id,
              ...(action === 'reschedule' ? { scheduled_for: Date.parse(`${date}+08:00`) / 1000 } : {})
            }
      }
      sessionStorage.setItem(recoveryKey, JSON.stringify(pending.current))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法保存操作，请勿重复提交。')
      return
    }
    writing.current = true
    setBusy(true)
    try {
      const result = await runtime.post<{ ok?: boolean; reminder_id?: string; followup?: TaskDetail }>(
        receivable ? '/api/business-followup-action' : '/api/assistant-reminder-action',
        pending.current
      )
      if (
        receivable ? !result.ok || result.followup?.source_id !== task.source_id : result.reminder_id !== task.source_id
      )
        throw new Error('unconfirmed')
      if (
        receivable &&
        pending.current.action === 'reschedule' &&
        result.followup?.expected_receive_date !== pending.current.expected_receive_date
      )
        throw new Error('date mismatch')
      sessionStorage.removeItem(recoveryKey)
      pending.current = null
      setUncertain(false)
      setAction('')
      setDate('')
      setNotice('当前任务已更新。')
      refreshLedger(value => value + 1)
      window.dispatchEvent(new CustomEvent('hermes:followup-changed', { detail: { scope } }))
    } catch (failure) {
      if (failure instanceof EnterpriseClientError && [400, 403, 404, 409, 422].includes(failure.status)) {
        sessionStorage.removeItem(recoveryKey)
        pending.current = null
        setUncertain(false)
        setError('服务端拒绝了此次操作，请刷新当前任务后核对状态和权限。')
      } else {
        setUncertain(true)
        setError('提交结果尚未确认。请重试原提交，不要重复登记；关闭详情后仍保留原操作。')
      }
    } finally {
      writing.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !writing.current && !writeoffBusy) onClose()
      }}
    >
      <DialogContent
        fitContent
        className="hesc-update-dialog web-task-detail"
        onCloseAutoFocus={event => {
          event.preventDefault()
          opener.current?.focus({ preventScroll: true })
        }}
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogTitle>当前任务详情</DialogTitle>
        <DialogDescription>只显示本次选中的任务，关闭后返回原列表。</DialogDescription>
        <div className="web-task-detail-content">
          {loading ? <p role="status">正在读取当前任务…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          <Button
            variant="outline"
            disabled={loading || busy || writeoffLocked}
            onClick={() => {
              setError('')
              refresh(value => value + 1)
              refreshLedger(value => value + 1)
            }}
          >
            刷新当前任务
          </Button>
          {detail ? (
            <>
              <h2>{detail.business_subject}</h2>
              {receivable && ['created', 'pending_confirmation'].includes(detail.status) ? <p role="status">此记录仍待确认，尚未进入正常跟进；当前不可直接登记收款或改期。</p> : null}
              <dl className="hesc-detail-list web-task-summary">
                <div>
                  <dt>任务类型</dt>
                  <dd>{detail.task_source_label}</dd>
                </div>
                <div>
                  <dt>负责人</dt>
                  <dd>{detail.owner_name}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>
                    {!receivable && detail.status === 'completed'
                      ? '已完成'
                      : (statusLabels[detail.resolution ?? detail.status] ?? detail.status)}
                  </dd>
                </div>
                {receivable ? (
                  <>
                    <div>
                      <dt>业务团队</dt>
                      <dd>{detail.business_team || '—'}</dd>
                    </div>
                    <div>
                      <dt>应收金额</dt>
                      <dd>
                        {detail.amount} {detail.currency}
                      </dd>
                    </div>
                    <div>
                      <dt>当前预计到账日</dt>
                      <dd>{detail.expected_receive_date || '—'}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>提醒时间（北京时间）</dt>
                    <dd>
                      {detail.next_followup_at
                        ? new Date(detail.next_followup_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                        : '—'}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="hesc-inline-actions">
                {detail.allowed_actions
                  .filter(key => actions[key])
                  .map(key => (
                    <Button
                      key={key}
                      variant="outline"
                      disabled={busy || loading || uncertain || writeoffLocked}
                      onClick={() => {
                        setAction(key)
                        setDate('')
                        setError('')
                      }}
                    >
                      {actions[key]}
                    </Button>
                  ))}
              </div>
              {action ? (
                <section aria-label="确认任务操作">
                  <h3>{actions[action]}</h3>
                  <p>
                    {action === 'admin_delete' ? '确认以企业管理员身份删除当前任务？删除后停止提醒、移入历史记录，并记录“管理员删除”、操作人和时间。不删除业务事实或收款流水，不代表已收款。' : action === 'confirm' ? '仅确认应收记录并启动跟进，不代表款项到账。' : action === 'received'
                      ? '将整笔应收款确认为已收款。部分收款请使用下方收款登记。'
                      : ['cancel', 'close'].includes(action) && receivable
                        ? '仅停止此任务的跟进提醒，不代表款项已收回，剩余余额仍计入未收总额。'
                        : '仅更新当前任务。'}
                  </p>
                  {action === 'reschedule' ? (
                    <label>
                      新的日期{!receivable ? '时间（北京时间）' : ''}
                      <Input
                        type={receivable ? 'date' : 'datetime-local'}
                        disabled={busy || uncertain}
                        value={date}
                        onChange={event => setDate(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <Button disabled={busy || loading || (uncertain && !pending.current)} onClick={() => void submit()}>
                    {busy ? '正在提交…' : uncertain ? '重试原提交' : '确认操作'}
                  </Button>
                  {!uncertain ? (
                    <Button variant="outline" disabled={busy} onClick={() => setAction('')}>
                      返回详情
                    </Button>
                  ) : null}
                </section>
              ) : null}
              {receivable ? (
                <fieldset disabled={busy || uncertain || writeoffLocked}>
                  <ReceivableLedger refreshKey={ledgerRevision} hideRefresh runtime={runtime} scope={scope} followupId={task.source_id} />
                </fieldset>
              ) : null}
              {receivable && ['closed', 'cancelled'].includes(detail.status) ? <ReceivableWriteoff
                runtime={runtime} scope={scope} followupId={task.source_id} subject={detail.business_subject}
                refreshKey={ledgerRevision} disabled={busy || uncertain || Boolean(action)}
                onLock={setWriteoffLocked} onBusy={setWriteoffBusy}
                onChanged={() => {
                  refreshLedger(value => value + 1)
                  window.dispatchEvent(new CustomEvent('hermes:followup-changed', { detail: { scope } }))
                }} /> : null}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
