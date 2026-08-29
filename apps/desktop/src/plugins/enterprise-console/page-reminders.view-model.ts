/**
 * Reminders page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Centralizes the server-state → StatusTone mapping (active → good,
 * cancelled → muted, exhausted → warn) and exposes per-row
 * canCancel (only when state === 'active').
 *
 * Wave 1 / Step 9 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { ReminderRow } from './page-reminders.controller'

export interface ReminderViewRow {
  canCancel: boolean
  displayTitle: string
  generation: number
  reminderId: string
  scheduledFor: number
  state: string
  subjectId: string
  subjectType: string
  timezone: string
  title: null | string
  tone: StatusTone
}

export interface RemindersViewModel extends CommonViewModelFields {
  rows: readonly ReminderViewRow[]
  isAvailable: boolean
  isEmpty: boolean
}

const REMINDER_TONE: Record<string, StatusTone> = {
  active: 'good',
  cancelled: 'muted',
  exhausted: 'warn',
}

function deriveRow(reminder: ReminderRow): ReminderViewRow {
  return {
    reminderId: reminder.reminder_id,
    displayTitle: reminder.title || 'Untitled reminder',
    title: reminder.title,
    subjectType: reminder.subject_type,
    subjectId: reminder.subject_id,
    scheduledFor: reminder.scheduled_for,
    timezone: reminder.timezone,
    generation: reminder.generation,
    canCancel: reminder.state === 'active',
    state: reminder.state,
    tone: REMINDER_TONE[reminder.state] ?? 'muted',
  }
}

export function deriveRemindersViewModel(args: {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  data: { available: boolean; reminders: ReminderRow[] } | undefined
}): RemindersViewModel {
  const { page, whoami, data } = args
  const common = deriveCommonViewModel({ page, whoami })

  const rows = (data?.reminders ?? []).map(deriveRow)
  const isAvailable = data?.available ?? false
  const isEmpty = !isAvailable || rows.length === 0

  return {
    ...common,
    rows,
    isAvailable,
    isEmpty,
  }
}