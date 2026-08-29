/**
 * Reminders page — Presentational view.
 *
 * Receives a RemindersViewModel + form state + 2 mutation callbacks.
 * The CreateReminderForm sub-component owns the form's local state
 * (subjectType / subjectId / when / title / idempotencyKey).
 *
 * Wave 1 / Step 9 of W5-B0 contract freeze.
 */

import { Input, StatusDot } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows, fmtEpoch } from './page-kit'
import type { RemindersViewModel } from './page-reminders.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

export interface RemindersViewProps {
  vm: RemindersViewModel
  onCreate: (body: {
    idempotency_key: string
    scheduled_for: number
    subject_id: string
    subject_type: string
    timezone: string
    title?: string
  }) => void
  onCancel: (reminderId: string) => void
  onRotateIdempotencyKey: () => string
  /** Derived: the IANA timezone string for the create form. */
  timezone: string
  /** Derived: convert `datetime-local` value → UTC epoch seconds (NaN
   *  if empty). */
  datetimeLocalToEpochSeconds: (value: string) => number
}

interface CreateReminderFormProps {
  onCreate: RemindersViewProps['onCreate']
  onRotateIdempotencyKey: RemindersViewProps['onRotateIdempotencyKey']
  timezone: string
  datetimeLocalToEpochSeconds: RemindersViewProps['datetimeLocalToEpochSeconds']
}

function CreateReminderForm({
  onCreate,
  onRotateIdempotencyKey,
  timezone,
  datetimeLocalToEpochSeconds,
}: CreateReminderFormProps) {
  const [subjectType, setSubjectType] = useState('biz_task')
  const [subjectId, setSubjectId] = useState('')
  const [when, setWhen] = useState('')
  const [title, setTitle] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => onRotateIdempotencyKey())

  const scheduledFor = datetimeLocalToEpochSeconds(when)
  const canSubmit =
    subjectId.trim().length > 0 && subjectType.trim().length > 0 && Number.isFinite(scheduledFor)

  return (
    <FormAction
      canSubmit={canSubmit}
      invalidateKey={['enterprise-console', 'reminders']}
      onSuccess={() => setIdempotencyKey(onRotateIdempotencyKey())}
      permission="reminder.write"
      submit={() => {
        onCreate({
          idempotency_key: idempotencyKey,
          scheduled_for: scheduledFor,
          subject_id: subjectId.trim(),
          subject_type: subjectType.trim(),
          timezone,
          title: title || undefined,
        })
        setSubjectId('')
        setTitle('')
      }}
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

export function RemindersView({
  vm,
  onCreate,
  onCancel,
  onRotateIdempotencyKey,
  timezone,
  datetimeLocalToEpochSeconds,
}: RemindersViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-reminders"
    >
      <PageHeader
        actions={
          <CreateReminderForm
            onCreate={onCreate}
            onRotateIdempotencyKey={onRotateIdempotencyKey}
            timezone={timezone}
            datetimeLocalToEpochSeconds={datetimeLocalToEpochSeconds}
          />
        }
        purpose="Schedule and cancel server-authoritative reminders without duplicating the reminder state machine."
        status={<PageStatusBadge status="ready" />}
        title="Reminders"
      />

      <ConsolePanel divided title="Schedule">
        {vm.isEmpty ? (
          <p className="text-(--ui-text-tertiary)" data-testid="console-reminders-empty">
            {!vm.isAvailable ? 'reminders module is not assembled' : 'no reminders'}
          </p>
        ) : (
          <ConsoleRows testId="console-reminders">
            {vm.rows.map(row => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={row.reminderId}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-(--ui-text-primary)">{row.displayTitle}</div>
                  <div className="text-(--ui-text-tertiary)">
                    {row.subjectType}:{row.subjectId} · {fmtEpoch(row.scheduledFor)} · {row.timezone}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={row.tone} />
                    {row.state}
                  </span>
                  {row.canCancel ? (
                    <ConfirmAction
                      destructive
                      invalidateKey={['enterprise-console', 'reminders']}
                      permission="reminder.write"
                      run={() => onCancel(row.reminderId)}
                      testId={`console-reminder-cancel-${row.reminderId}`}
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
      </ConsolePanel>
    </div>
  )
}