import { type FormEvent, useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface Reminder {
  reminder_id?: string
  scheduled_for?: number
  state?: string
  subject_id?: string
  subject_type?: string
  timezone?: string
  title?: string
}

interface RemindersResponse {
  available?: boolean
  reminders?: Reminder[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function stateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在读取'
  }

  if (state === 'ready') {
    return '已连接'
  }

  if (state === 'error') {
    return '读取失败'
  }

  return '等待企业服务连接'
}

function timestamp(seconds: number | undefined): string {
  if (typeof seconds !== 'number') {
    return '—'
  }

  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(seconds * 1000))
}

export function RemindersPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [scheduledFor, setScheduledFor] = useState('')
  const [state, setState] = useState<LoadState>('unavailable')
  const [subjectId, setSubjectId] = useState('')
  const [subjectType, setSubjectType] = useState('biz_task')
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [title, setTitle] = useState('')

  const load = useCallback(async () => {
    if (!runtime) {
      setReminders([])
      setState('unavailable')

      return
    }

    setError(null)
    setState('loading')

    try {
      const response = await runtime.get<RemindersResponse>('/api/reminders')
      setReminders(response.reminders ?? [])
      setState(response.available === false ? 'unavailable' : 'ready')
    } catch (reason) {
      setReminders([])
      setState('error')
      setError(reason instanceof Error ? reason.message : 'cannot load reminders')
    }
  }, [runtime])

  useEffect(() => {
    void load()
  }, [load])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!runtime?.post || !subjectId.trim() || !scheduledFor || !timezone.trim()) {
      return
    }

    const instant = new Date(scheduledFor).getTime()

    if (Number.isNaN(instant)) {
      setError('请选择有效的提醒时间')

      return
    }

    setAction('create')
    setError(null)
    void runtime
      .post('/api/reminder-create', {
        scheduled_for: instant / 1000,
        subject_id: subjectId.trim(),
        subject_type: subjectType.trim(),
        timezone: timezone.trim(),
        title: title.trim()
      })
      .then(async () => {
        setScheduledFor('')
        setSubjectId('')
        setTitle('')
        await load()
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'cannot create reminder'))
      .finally(() => setAction(null))
  }

  const cancel = (reminderId: string) => {
    if (!runtime?.post) {
      setError('当前桌面运行时不支持提醒写操作')

      return
    }

    setAction(reminderId)
    setError(null)
    void runtime
      .post('/api/reminder-cancel', { reminder_id: reminderId })
      .then(load)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'cannot cancel reminder'))
      .finally(() => setAction(null))
  }

  return (
    <article className="hesc-card hesc-audit-card" data-testid="enterprise-client-reminders">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">提醒中心</h2>
          <p className="hesc-muted-copy">提醒由服务端安排、投递和审计；客户端不持有租户或主体身份。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(state)}
        </span>
      </div>

      {error ? (
        <p className="hesc-error-copy" role="status">
          {error}
        </p>
      ) : null}
      {state === 'ready' && reminders.length === 0 ? (
        <p className="hesc-muted-copy">当前权限范围内没有活动提醒。</p>
      ) : null}
      <div className="hesc-outbound-list">
        {reminders.map((reminder, index) => {
          const reminderId = reminder.reminder_id

          return (
            <div className="hesc-outbound-item" key={reminderId ?? `reminder-${index}`}>
              <div>
                <strong>
                  {reminder.title || `${reminder.subject_type ?? '事项'} · ${reminder.subject_id ?? '—'}`}
                </strong>
                <span>
                  {reminder.state ?? '—'} · 计划于 {timestamp(reminder.scheduled_for)} · {reminder.timezone ?? '—'}
                </span>
              </div>
              {reminderId && reminder.state === 'active' ? (
                <button
                  className="hesc-action"
                  disabled={action !== null}
                  onClick={() => cancel(reminderId)}
                  type="button"
                >
                  {action === reminderId ? '正在取消…' : '取消提醒'}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <form className="hesc-agent-composer" onSubmit={submit}>
        <label htmlFor="enterprise-reminder-subject">关联事项</label>
        <input
          id="enterprise-reminder-subject"
          onChange={event => setSubjectId(event.target.value)}
          placeholder="事项标识"
          value={subjectId}
        />
        <input
          aria-label="提醒事项类型"
          onChange={event => setSubjectType(event.target.value)}
          placeholder="事项类型"
          value={subjectType}
        />
        <input
          aria-label="提醒标题"
          onChange={event => setTitle(event.target.value)}
          placeholder="提醒标题（可选）"
          value={title}
        />
        <input
          aria-label="提醒时间"
          onChange={event => setScheduledFor(event.target.value)}
          type="datetime-local"
          value={scheduledFor}
        />
        <input aria-label="提醒时区" onChange={event => setTimezone(event.target.value)} value={timezone} />
        <button className="hesc-action" disabled={!runtime?.post || action !== null} type="submit">
          {action === 'create' ? '正在创建…' : '创建提醒'}
        </button>
      </form>
    </article>
  )
}
