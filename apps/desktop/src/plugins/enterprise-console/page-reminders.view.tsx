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
 *
 * Per P1-VIS-V2-REMEDIATION-01:
 *   - REMOVED the relative-offset countdown badge. The
 *     relative-time display required a client current-time
 *     authority in the VM, which conflicts with the W1C
 *     pure-VM architecture. scheduledForDisplay + timezone
 *     remain the time truth.
 *   - REMOVED ReminderDetailView consumption (no longer on the
 *     VM contract).
 *   - REMOVED internal `/api/...` REST path from the visible
 *     product copy. The status strip now reads as honest
 *     availability language ("Reminder service available" /
 *     "Reminder service unavailable") that mirrors the
 *     server-derived available flag without leaking transport
 *     detail into the visible product UI.
 *
 * Per §P6 invariants:
 *   - SERVER STATE > CLIENT ASSUMPTION
 *   - View never decides whether a reminder can be cancelled
 *     (canCancelFromState is the VM-derived gate).
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
      className="mx-auto flex w-full max-w-[96rem] flex-col gap-(--ec-page-inset-y) px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status={available ? 'ready' : 'partial'}
      data-testid="console-page-reminders"
    >
      <PageHeader
        actions={createSlot}
        purpose="Schedule and cancel server-authoritative reminders without duplicating the reminder state machine."
        status={<PageStatusBadge status={available ? 'ready' : 'partial'} />}
        title="Reminders"
      />

      <section
        aria-labelledby="console-reminders-status-heading"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--ui-text-tertiary)"
        data-ec-state={available ? 'available' : 'unavailable'}
        data-testid="console-reminders-status"
      >
        <h2 className="sr-only" id="console-reminders-status-heading">
          Reminder service availability
        </h2>
        <span className="inline-flex items-center gap-1">
          <StatusDot tone={available ? 'good' : 'bad'} />
          {available
            ? 'Reminder service available'
            : 'Reminder service unavailable'}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span>
          {reminders.length} reminder{reminders.length === 1 ? '' : 's'}
        </span>
      </section>

      <ConsolePanel divided title="Schedule">
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
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-(--ui-stroke-tertiary) py-2 text-sm last:border-b-0"
                  data-ec-reminder-state={reminder.state}
                  data-testid={`console-reminder-row-${reminder.reminderId}`}
                  key={reminder.reminderId}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">
                      {reminder.title}
                    </div>
                    <div className="text-(--ui-text-tertiary)">
                      {reminder.subjectDisplay} · {reminder.scheduledForDisplay} ·{' '}
                      <span data-ec-mono="">{reminder.timezone}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span
                      aria-label={`state ${reminder.state}`}
                      className="inline-flex items-center gap-1 text-xs"
                    >
                      <StatusDot tone={reminder.tone} />
                      {reminder.stateLabel}
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
