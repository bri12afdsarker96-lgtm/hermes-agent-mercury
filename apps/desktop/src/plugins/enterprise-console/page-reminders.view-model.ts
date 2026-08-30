/**
 * Reminders page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no session
 * atom, no permission authority, no mutation authority, no timezone
 * computation.
 *
 * Per W1-C §P15:
 *   - Wire row → presentation row mapping
 *   - State → StatusTone mapping (matches pre-split exactly)
 *   - Title fallback to "Untitled reminder"
 *   - canCancelFromState derived from state === 'active'
 *   - Display formatting via injected fmtEpoch
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