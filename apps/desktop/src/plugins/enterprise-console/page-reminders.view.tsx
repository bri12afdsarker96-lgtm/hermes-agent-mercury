/**
 * Reminders page — Presentational View layer.
 *
 * Receives fully-derived VMs + action slots from the glue. NO
 * transport, NO useQueryClient, NO session atom, NO permission
 * authority, NO `./actions` import. FormAction / ConfirmAction are
 * composed in the glue.
 *
 * Per W1-C §P24:
 *   - View MUST be a dependency leaf.
 *   - Visible copy, className, layout hierarchy, button labels,
 *     dialog titles, placeholder text, status text, section order
 *     must match pre-split exact behavior (per W1-C §P26).
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { ConsoleRows, QueryBody } from './page-kit'
import type { ReminderRowView } from './page-reminders.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props
// ---------------------------------------------------------------------------

export interface ReminderRowActionsSlotProps {
  reminderId: string
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface RemindersViewProps {
  reminders: ReminderRowView[]
  remindersIsPending: boolean
  remindersError: unknown
  reminderRowActionsSlot: (props: ReminderRowActionsSlotProps) => ReactNode
  // The create-action affordance (composed by the glue using
  // FormAction with reminder.write permission).
  createSlot: ReactNode
}

export function RemindersView({
  reminders,
  remindersIsPending,
  remindersError,
  reminderRowActionsSlot,
  createSlot,
}: RemindersViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-reminders"
    >
      <PageHeader
        actions={createSlot}
        purpose="Schedule and cancel server-authoritative reminders without duplicating the reminder state machine."
        status={<PageStatusBadge status="ready" />}
        title="Reminders"
      />

      <ConsolePanel divided title="Schedule">
        <QueryBody
          emptyText="no reminders"
          isEmpty={(data: { available: boolean; reminders: unknown[] }) =>
            !data.available || data.reminders.length === 0
          }
          query={{
            data: { available: true, reminders },
            error: remindersError,
            isPending: remindersIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-reminders">
              {reminders.map((reminder) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  data-testid={`console-reminder-row-${reminder.reminderId}`}
                  key={reminder.reminderId}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">{reminder.title}</div>
                    <div className="text-(--ui-text-tertiary)">
                      {reminder.subjectDisplay} · {reminder.scheduledForDisplay} · {reminder.timezone}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={reminder.tone} />
                      {reminder.state}
                    </span>
                    {reminderRowActionsSlot({ reminderId: reminder.reminderId })}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}