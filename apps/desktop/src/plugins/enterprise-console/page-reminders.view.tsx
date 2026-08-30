/**
 * Reminders page — Presentational View layer.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P8:
 *   - Available flag is propagated from the SERVER (glue),
 *     never fabricated as `true` here.
 *   - Action slot receives per-row eligibility flag
 *     (canCancelFromState) derived by the VM — the view does NOT
 *     recompute.
 *   - View is a dependency leaf (only presentational imports).
 *
 * Per LINE F (P1-SECONDARY-VISUAL-RESPONSIVE-A11Y-01):
 *   - Visual-only additions: section aria-labelledby, row
 *     aria-label, status aria-label, empty-text improvement,
 *     flex-wrap for narrow viewports. NO controller, NO
 *     contract change.
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { ConsoleRows, QueryBody } from './page-kit'
import type { ReminderRowView } from './page-reminders.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props (per §P8)
// ---------------------------------------------------------------------------

export interface ReminderRowActionsSlotProps {
  reminderId: string
  canCancelFromState: boolean
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface RemindersViewProps {
  available: boolean
  reminders: ReminderRowView[]
  remindersIsPending: boolean
  remindersError: unknown
  reminderRowActionsSlot: (props: ReminderRowActionsSlotProps) => ReactNode
  createSlot: ReactNode
}

export function RemindersView({
  available,
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

      <ConsolePanel
        divided
        title={
          <span
            className="text-sm font-medium"
            id="console-reminders-schedule-heading"
          >
            Schedule
          </span>
        }
      >
        <QueryBody
          emptyText="no reminders — schedule one with the new-reminder control above"
          isEmpty={(data: { available: boolean; reminders: unknown[] }) =>
            !data.available || data.reminders.length === 0
          }
          query={{
            data: { available, reminders },
            error: remindersError,
            isPending: remindersIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-reminders">
              {reminders.map((reminder) => (
                <li
                  aria-label={`reminder ${reminder.title}, scheduled ${reminder.scheduledForDisplay} ${reminder.timezone}, state ${reminder.state}`}
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
                    <span
                      aria-label={`state ${reminder.state}`}
                      className="inline-flex items-center gap-1 text-xs"
                    >
                      <StatusDot tone={reminder.tone} />
                      {reminder.state}
                    </span>
                    {reminderRowActionsSlot({
                      reminderId: reminder.reminderId,
                      canCancelFromState: reminder.canCancelFromState,
                    })}
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
