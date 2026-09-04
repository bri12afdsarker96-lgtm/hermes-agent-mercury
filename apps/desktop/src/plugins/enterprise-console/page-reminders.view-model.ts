/**
 * Reminders page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no session
 * atom, no permission authority, no mutation authority, no timezone
 * computation, NO clock access (no Date.now / performance.now).
 *
 * Per W1-C §P15:
 *   - Wire row → presentation row mapping
 *   - State → StatusTone mapping (matches pre-split exactly)
 *   - Title fallback to "Untitled reminder"
 *   - canCancelFromState derived from state === 'active'
 *   - Display formatting via injected fmtEpoch
 *
 * Per P1-VIS-V2-REMEDIATION-01:
 *   - REMOVED `relativeOffsetFor` + relativeOffset runtime feature.
 *     The VM is a pure derivation of server facts; the relative-time
 *     countdown required a client-side current-time authority, which
 *     is forbidden by the W1C architecture. scheduledForDisplay +
 *     timezone continue to be the P1 source of truth for time.
 *   - REMOVED `ReminderDetailView` + `detail` + `ownerDisplay`. There
 *     is no current Reminder product surface that consumes a detail
 *     schema, and the VM must not pre-build a presentation contract
 *     for future pages.
 *   - KEPT `stateLabel` (trivial STATE_LABEL lookup; the View already
 *     uses it as a stable presentation text independent of any
 *     future surface).
 *
 * Per §P6 invariants:
 *   - SERVER STATE > CLIENT ASSUMPTION
 *   - VIEW CANNOT INVENT canCancel / canClaim / canReply / canRequeue
 *   - FAILED CREATE != SUCCESS (controller concern, not VM)
 *   - NO OPTIMISTIC REMINDER
 *   - AVAILABLE FLAG = SERVER TRUTH (propagated via glue)
 *   - 501 MUST REMAIN HONEST (controller concern, not VM)
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { ReminderRow } from './page-reminders.controller'

// ---------------------------------------------------------------------------
// Tone table (matches pre-split exactly)
// ---------------------------------------------------------------------------

export const REMINDER_TONE: Record<string, StatusTone> = {
  active: 'good',
  cancelled: 'muted',
  exhausted: 'warn',
}

export function reminderTone(state: string): StatusTone {
  return REMINDER_TONE[state] ?? 'muted'
}

// ---------------------------------------------------------------------------
// V2 productization — state label (pure lookup)
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = {
  active: 'active',
  cancelled: 'cancelled',
  exhausted: 'exhausted',
}

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state
}

// ---------------------------------------------------------------------------
// Presentation shape
// ---------------------------------------------------------------------------

export interface ReminderRowView {
  reminderId: string
  title: string
  subjectType: string
  subjectId: string
  timezone: string
  state: string
  tone: StatusTone
  canCancelFromState: boolean
  scheduledForDisplay: string
  scheduledFor: number
  generation: number
  // Display
  subjectDisplay: string
  // V2 productization — stable text for the state badge.
  stateLabel: string
}

export function deriveReminder(
  row: ReminderRow,
  fmtEpoch: (seconds: null | number | undefined) => string
): ReminderRowView {
  const state = row.state

  return {
    reminderId: row.reminder_id,
    title: row.title || 'Untitled reminder',
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    timezone: row.timezone,
    state,
    tone: reminderTone(state),
    canCancelFromState: state === 'active',
    scheduledForDisplay: fmtEpoch(row.scheduled_for),
    scheduledFor: row.scheduled_for,
    generation: row.generation,
    subjectDisplay: `${row.subject_type}:${row.subject_id}`,
    stateLabel: stateLabel(state),
  }
}

export function deriveReminders(
  rows: ReminderRow[] | null | undefined,
  fmtEpoch: (seconds: null | number | undefined) => string
): ReminderRowView[] {
  if (!rows) {
    return []
  }

  return rows.map((row) => deriveReminder(row, fmtEpoch))
}

// Empty semantics (matches pre-split)
export function isRemindersEmpty(
  data: { available: boolean; reminders: unknown[] } | null | undefined
): boolean {
  if (!data) {
    return true
  }

  return !data.available || data.reminders.length === 0
}
