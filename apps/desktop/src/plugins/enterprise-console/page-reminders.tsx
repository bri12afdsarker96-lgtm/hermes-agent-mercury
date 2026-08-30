/**
 * Reminders page — Glue layer.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P8 + §P6:
 *   - Reads `query.data?.available ?? false` (server truth; NEVER
 *     fabricates `available: true`).
 *   - Uses REMINDERS_KEY constant from controller for every
 *     invalidateKey (no literal query-key arrays in glue).
 *   - Per-row cancel action is gated on the VM-derived
 *     canCancelFromState flag. Glue does NOT recompute state.
 *   - active → cancel visible; cancelled/exhausted/other → cancel
 *     absent.
 *
 * Per W1-C §P13 (Reminders contract):
 *   - Idempotency invariant: same key on failure, rotate on success.
 *   - Cancel: only when state === 'active'; destructive confirm.
 *   - datetime-local interpreted in browser local zone; sends
 *     scheduled_for = floor(ms/1000) and the same resolved IANA
 *     timezone.
 */

import { Input } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { fmtEpoch } from './page-kit'
import {
  REMINDERS_KEY,
  useKbReminders,
  useRemindersMutations,
} from './page-reminders.controller'
import {
  type ReminderRowActionsSlotProps,
  RemindersView,
} from './page-reminders.view'
import { deriveReminders } from './page-reminders.view-model'

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
      invalidateKey={REMINDERS_KEY}
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

function ReminderRowActionsSlot({
  reminderId,
  canCancelFromState,
}: ReminderRowActionsSlotProps) {
  const mutations = useRemindersMutations()

  if (!canCancelFromState) {
    return null
  }

  return (
    <ConfirmAction
      destructive
      invalidateKey={REMINDERS_KEY}
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
  const available = query.data?.available ?? false
  const remindersVm = deriveReminders(query.data?.reminders, fmtEpoch)

  return (
    <RemindersView
      available={available}
      createSlot={<CreateReminderSlot />}
      reminderRowActionsSlot={(props) => <ReminderRowActionsSlot {...props} />}
      reminders={remindersVm}
      remindersError={query.error}
      remindersIsPending={query.isPending}
    />
  )
}
