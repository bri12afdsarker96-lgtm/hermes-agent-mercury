/**
 * Reminders page — Controller layer.
 *
 * Holds the HermesTransport query for the reminders list + create /
 * cancel mutations. The create mutation includes:
 *   - scheduled_for: UTC epoch seconds (server expects this shape)
 *   - timezone: an IANA zone string (the page derives it from the
 *     browser's local Intl zone, never from free-text user input)
 *   - idempotency_key: fresh UUID v4 per attempt
 *
 * Wave 1 / Step 9 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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

export const REMINDERS_KEY = ['enterprise-console', 'reminders'] as const

export interface ReminderCreateBody {
  idempotency_key: string
  scheduled_for: number
  subject_id: string
  subject_type: string
  timezone: string
  title?: string
}

export interface ReminderCancelBody {
  reminder_id: string
}

export function useRemindersData() {
  const transport = useTransport()

  return useConsoleQuery<RemindersResp>(REMINDERS_KEY, '/api/reminders')
}

/** Resolve the browser's IANA timezone, with UTC as a deterministic
 *  fallback when the runtime doesn't expose one. */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Convert a `datetime-local` string ("YYYY-MM-DDTHH:MM") to UTC epoch
 *  seconds. Returns NaN when input is empty (caller decides whether
 *  that's submit-disable). */
export function datetimeLocalToEpochSeconds(value: string): number {
  if (!value) {
    return Number.NaN
  }

  const ms = new Date(value).getTime()

  return Number.isNaN(ms) ? Number.NaN : Math.floor(ms / 1000)
}

export function makeReminderMutations(transport: ReturnType<typeof useTransport>) {
  return {
    create: async (body: ReminderCreateBody) => {
      await transport.post('/api/reminder-create', body)
    },
    cancel: async (body: ReminderCancelBody) => {
      await transport.post('/api/reminder-cancel', body)
    },
  }
}

export function normalizeReminderError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'reminder.write permission required'
    }

    if (e.code === 'not_implemented') {
      return 'reminders endpoint is not wired on this server yet'
    }

    if (e.code === 'conflict') {
      return 'idempotency key collision — server already processed this create'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}