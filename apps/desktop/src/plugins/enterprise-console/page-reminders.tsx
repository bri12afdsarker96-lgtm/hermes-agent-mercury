/**
 * Reminders page — Glue layer.
 *
 * Composes:
 *   - controller (queries + mutations)
 *   - view-model (pure derivations)
 *   - view (presentational; action slots)
 *
 * Per W1-C §P23, the glue owns:
 *   - local form state (subjectType, subjectId, when, title, idempotency key)
 *   - browser timezone computation (per P14)
 *   - FormAction / ConfirmAction composition
 *   - datetime-local → epoch seconds conversion
 *
 * Per W1-C §P13 (Reminders contract):
 *   - Idempotency invariant: same key on failure, rotate on success.
 *   - Cancel: only when state === 'active'; destructive confirm.
 *   - datetime-local interpreted in browser local zone; sends
 *     scheduled_for = floor(ms/1000) and the same resolved IANA
 *     timezone (no free-text timezone input).
 */

import { Input } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { fmtEpoch } from './page-kit'
import { useKbReminders, useRemindersMutations } from './page-reminders.controller'
import { RemindersView } from './page-reminders.view'
import { deriveReminders } from './page-reminders.view-model'

// ---------------------------------------------------------------------------
// Browser timezone (per P14 — exact current behavior)
// ---------------------------------------------------------------------------

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function CreateReminderSlot() {
  const mutations = useRemindersMutations()
  const [subjectType, setSubjectType] = useState('biz_task')
  const [subjectId, setSubjectId] = useState('')
  const [when, setWhen] = useState('')
  const [title, setTitle] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const timezone = browserTimezone()

  const scheduledFor = when
    ? Math.floor(new Date(when).getTime() / 1000)
    : Number.NaN

  return (
    <FormAction
      canSubmit={
        subjectId.trim().length > 0 &&
        subjectType.trim().length > 0 &&
        Number.isFinite(scheduledFor)
      }
      invalidateKey={['enterprise-console', 'reminders']}
      onSuccess={() => setIdempotencyKey(crypto.randomUUID())}
      permission="reminder.write"
      submit={() =>
        mutations.createReminder({
          scheduled_for: scheduledFor,
          idempotency_key: idempotencyKey,
          subject_id: subjectId.trim(),
          subject_type: subjectType.trim(),
          timezone,
          title: title || undefined,
        })
      }
      submitLabel="Create"
      testId="console-reminder-create"
      title="Create reminder"
      trigger="new reminder"
    >
      <Input
        data-testid="console-reminder-subject"
        onChange={(event) => setSubjectId(event.target.value)}
        placeholder="subject id"
        value={subjectId}
      />
      <Input
        onChange={(event) => setSubjectType(event.target.value)}
        placeholder="subject type"
        value={subjectType}
      />
      <div
        className="text-xs text-muted-foreground"
        data-testid="console-reminder-timezone"
      >
        timezone: {timezone}
      </div>
      <input
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        data-testid="console-reminder-when"
        onChange={(event) => setWhen(event.target.value)}
        type="datetime-local"
        value={when}
      />
      <Input
        onChange={(event) => setTitle(event.target.value)}
        placeholder="title (optional)"
        value={title}
      />
    </FormAction>
  )
}

function ReminderRowActionsSlot({ reminderId }: { reminderId: string }) {
  const mutations = useRemindersMutations()

  return (
    <ConfirmAction
      destructive
      invalidateKey={['enterprise-console', 'reminders']}
      permission="reminder.write"
      run={() => mutations.cancelReminder(reminderId)}
      testId={`console-reminder-cancel-${reminderId}`}
      title="Cancel this reminder?"
    >
      cancel
    </ConfirmAction>
  )
}

export function RemindersPage() {
  const query = useKbReminders()
  const remindersVm = deriveReminders(query.data?.reminders, fmtEpoch)

  return (
    <RemindersView
      createSlot={<CreateReminderSlot />}
      reminderRowActionsSlot={({ reminderId }) => (
        <ReminderRowActionsSlot reminderId={reminderId} />
      )}
      reminders={remindersVm}
      remindersError={query.error}
      remindersIsPending={query.isPending}
    />
  )
}