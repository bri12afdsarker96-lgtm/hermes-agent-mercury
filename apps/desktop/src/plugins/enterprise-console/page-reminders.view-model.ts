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
 *
 * Per P1-VIS-V2 (Reminders productization):
 *   - relativeOffset / relativeOffsetTone: presentation math from
 *     the server-provided scheduled_for (epoch SECONDS) vs nowSeconds.
 *     The view does NOT compute time deltas itself; it reads these
 *     derived labels and consumes them as a presentation leaf.
 *   - stateLabel: trivial STATE_LABEL lookup so the View can render
 *     a stable text even if server adds new states.
 *   - detail: a denormalized, presentation-only copy of the row used
 *     by future detail surfaces; values are server-derived, no
 *     client invention.
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
// V2 productization — state label + relative-offset derivation
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = {
  active: 'active',
  cancelled: 'cancelled',
  exhausted: 'exhausted',
}

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state
}

/**
 * Present a "in Xs / Xm / Xh / Xd" or "Xs ago / Xm ago / …" label from the
 * server-provided epoch SECONDS vs the client now. Pure: no fetch, no
 * authority. NaN inputs return muted + empty so the View can omit the badge.
 */
export function relativeOffsetFor(
  scheduledForSeconds: number,
  nowSeconds: number
): { label: string; tone: StatusTone } {
  if (!Number.isFinite(scheduledForSeconds) || !Number.isFinite(nowSeconds)) {
    return { label: '', tone: 'muted' }
  }

  const delta = scheduledForSeconds - nowSeconds
  const abs = Math.abs(delta)
  const future = delta >= 0
  const minutes = Math.floor(abs / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  let core: string

  if (days >= 1) {
    core = `${days}d`
  } else if (hours >= 1) {
    core = `${hours}h`
  } else if (minutes >= 1) {
    core = `${minutes}m`
  } else {
    core = `${Math.floor(abs)}s`
  }

  const label = future ? `in ${core}` : `${core} ago`

  // Tone: not just colors — only the relative urgency is colored.
  let tone: StatusTone = 'muted'

  if (future) {
    if (minutes < 5) {
      tone = 'warn'
    } else {
      tone = 'good'
    }
  } else {
    tone = 'muted'
  }

  return { label, tone }
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
  // V2 productization — presentation-only metadata for the row layout.
  // Server timestamp + IANA timezone are the source of truth; these labels
  // are derived in the VM so the view stays a presentation leaf.
  relativeOffset: string
  relativeOffsetTone: StatusTone
  stateLabel: string
  detail: ReminderDetailView
}

export interface ReminderDetailView {
  title: string
  stateLabel: string
  stateTone: StatusTone
  subjectDisplay: string
  scheduledForDisplay: string
  timezone: string
  // The current ReminderRow wire type carries no owner field; the
  // VM does not invent one. The placeholder em-dash is a PRESENTATION
  // symbol meaning "not provided by the server", never a value.
  ownerDisplay: string
  generationLabel: string
  reminderId: string
}

export function deriveReminder(
  row: ReminderRow,
  fmtEpoch: (seconds: null | number | undefined) => string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): ReminderRowView {
  const state = row.state
  const relative = relativeOffsetFor(row.scheduled_for, nowSeconds)

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
    relativeOffset: relative.label,
    relativeOffsetTone: relative.tone,
    stateLabel: stateLabel(state),
    detail: {
      title: row.title || 'Untitled reminder',
      stateLabel: stateLabel(state),
      stateTone: reminderTone(state),
      subjectDisplay: `${row.subject_type}:${row.subject_id}`,
      scheduledForDisplay: fmtEpoch(row.scheduled_for),
      timezone: row.timezone,
      ownerDisplay: '—',
      generationLabel: `generation ${row.generation}`,
      reminderId: row.reminder_id,
    },
  }
}

export function deriveReminders(
  rows: ReminderRow[] | null | undefined,
  fmtEpoch: (seconds: null | number | undefined) => string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): ReminderRowView[] {
  if (!rows) {
    return []
  }

  return rows.map((row) => deriveReminder(row, fmtEpoch, nowSeconds))
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
