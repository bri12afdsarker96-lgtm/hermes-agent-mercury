/**
 * Reminder page — real `/api/reminders` data plus create/cancel controls that
 * post to server authority and refetch the authoritative result. The server
 * expects `scheduled_for` as UTC epoch seconds plus an IANA timezone. A native
 * `datetime-local` is interpreted in the browser's local zone, so we send that
 * same resolved IANA zone instead of allowing contradictory free-text metadata.
 */

import { Input, StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

interface ReminderRow {
  generation: number
  reminder_id: string
  scheduled_for: number
  state: string
  subject_id: string
  subject_type: string
  timezone: string
  title: string
}

interface RemindersResp {
  available: boolean
  reminders: ReminderRow[]
}

const REMINDER_TONE: Record<string, StatusTone> = {
  active: 'good',
  cancelled: 'muted',
  exhausted: 'warn'
}

const REMINDERS_KEY = ['enterprise-console', 'reminders'] as const

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function CreateReminder() {
  const transport = useTransport()
  const [subjectType, setSubjectType] = useState('biz_task')
  const [subjectId, setSubjectId] = useState('')
  const [when, setWhen] = useState('')
  const [title, setTitle] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const timezone = browserTimezone()
  const scheduledFor = when ? Math.floor(new Date(when).getTime() / 1000) : Number.NaN

  return (
    <FormAction
      canSubmit={subjectId.trim().length > 0 && Number.isFinite(scheduledFor)}
      invalidateKey={REMINDERS_KEY}
      onSuccess={() => setIdempotencyKey(crypto.randomUUID())}
      permission="reminder.write"
      submit={() =>
        transport.post('/api/reminder-create', {
          scheduled_for: scheduledFor,
          idempotency_key: idempotencyKey,
          subject_id: subjectId.trim(),
          subject_type: subjectType.trim(),
          timezone,
          title: title || undefined
        })
      }
      submitLabel="Create"
      testId="console-reminder-create"
      title="Create reminder"
      trigger="new reminder"
    >
      <Input
        data-testid="console-reminder-subject"
        onChange={event => setSubjectId(event.target.value)}
        placeholder="subject id"
        value={subjectId}
      />
      <Input onChange={event => setSubjectType(event.target.value)} placeholder="subject type" value={subjectType} />
      <div className="text-xs text-muted-foreground" data-testid="console-reminder-timezone">
        timezone: {timezone}
      </div>
      <input
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        data-testid="console-reminder-when"
        onChange={event => setWhen(event.target.value)}
        type="datetime-local"
        value={when}
      />
      <Input onChange={event => setTitle(event.target.value)} placeholder="title (optional)" value={title} />
    </FormAction>
  )
}

export function RemindersPage() {
  const transport = useTransport()
  const query = useConsoleQuery<RemindersResp>(REMINDERS_KEY, '/api/reminders')

  return (
    <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-reminders">
      <div className="flex justify-end">
        <CreateReminder />
      </div>
      <QueryBody
        emptyText="no reminders"
        isEmpty={data => !data.available || data.reminders.length === 0}
        query={query}
      >
        {data => (
          <ConsoleRows testId="console-reminders">
            {data.reminders.map(reminder => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={reminder.reminder_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{reminder.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {reminder.subject_type}:{reminder.subject_id} · {fmtEpoch(reminder.scheduled_for)} ·{' '}
                    {reminder.timezone}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={REMINDER_TONE[reminder.state] ?? 'muted'} />
                    {reminder.state}
                  </span>
                  {reminder.state === 'active' ? (
                    <ConfirmAction
                      destructive
                      invalidateKey={REMINDERS_KEY}
                      permission="reminder.write"
                      run={() => transport.post('/api/reminder-cancel', { reminder_id: reminder.reminder_id })}
                      testId={`console-reminder-cancel-${reminder.reminder_id}`}
                      title="Cancel this reminder?"
                    >
                      cancel
                    </ConfirmAction>
                  ) : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
