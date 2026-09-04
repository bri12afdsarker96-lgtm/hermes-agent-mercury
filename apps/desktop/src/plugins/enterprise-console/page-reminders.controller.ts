/**
 * Reminders page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Reminders page (per W1-C §P22):
 *
 *   Queries:
 *     - GET /api/reminders
 *       queryKey: ['enterprise-console', 'reminders']
 *
 *   Mutations:
 *     - POST /api/reminder-create  permission reminder.write
 *       body {scheduled_for, idempotency_key, subject_id,
 *             subject_type, timezone, title?}
 *     - POST /api/reminder-cancel   permission reminder.write
 *       body {reminder_id} (destructive)
 *
 * The controller does NOT own timezone logic (that's glue), and
 * does NOT own the idempotency key lifecycle (also glue).
 */

import { useCallback } from 'react'

import { useTransport } from './transport'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const REMINDERS_KEY = ['enterprise-console', 'reminders'] as const

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface ReminderRow {
  generation: number
  reminder_id: string
  scheduled_for: number
  state: string
  subject_id: string
  subject_type: string
  timezone: string
  title: string
}

export interface RemindersResp {
  available: boolean
  reminders: ReminderRow[]
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

import { useConsoleQuery } from './page-kit'

export function useKbReminders() {
  return useConsoleQuery<RemindersResp>(REMINDERS_KEY, '/api/reminders')
}

// ---------------------------------------------------------------------------
// Mutation callbacks
// ---------------------------------------------------------------------------

export interface CreateReminderBody {
  scheduled_for: number
  idempotency_key: string
  subject_id: string
  subject_type: string
  timezone: string
  title?: string
}

export interface CancelReminderBody {
  reminder_id: string
}

export function useRemindersMutations() {
  const transport = useTransport()

  const createReminder = useCallback(
    (body: CreateReminderBody) =>
      transport.post('/api/reminder-create', body),
    [transport]
  )

  const cancelReminder = useCallback(
    (reminder_id: string) =>
      transport.post('/api/reminder-cancel', { reminder_id }),
    [transport]
  )

  return {
    createReminder,
    cancelReminder,
  }
}