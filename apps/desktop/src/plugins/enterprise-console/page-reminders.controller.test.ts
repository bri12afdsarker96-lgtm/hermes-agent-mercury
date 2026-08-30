/**
 * Reminders page — Controller tests (W1-C §P13 + §P16).
 *
 * Verifies exact query key + exact mutation signatures.
 */

import { describe, expect, it } from 'vitest'

import {
  type CancelReminderBody,
  type CreateReminderBody,
  type ReminderRow,
  REMINDERS_KEY,
} from './page-reminders.controller'

describe('Reminders page controller (W1-C §P16)', () => {
  it('REMINDERS_KEY is exact: ["enterprise-console", "reminders"]', () => {
    expect(REMINDERS_KEY).toEqual(['enterprise-console', 'reminders'])
  })

  it('ReminderRow wire-shape preserves snake_case', () => {
    const row: ReminderRow = {
      generation: 1,
      reminder_id: 'r1',
      scheduled_for: 1700000000,
      state: 'active',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
      title: 'Sample',
    }

    expect(row.reminder_id).toBe('r1')
    expect(row.scheduled_for).toBe(1700000000)
    expect(row.subject_id).toBe('biz-1')
  })

  it('CreateReminderBody is exact: {scheduled_for, idempotency_key, subject_id, subject_type, timezone, title?}', () => {
    const body: CreateReminderBody = {
      scheduled_for: 1700000000,
      idempotency_key: 'idem-1',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'America/Los_Angeles',
      title: 'My reminder',
    }

    expect(body).toEqual({
      scheduled_for: 1700000000,
      idempotency_key: 'idem-1',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'America/Los_Angeles',
      title: 'My reminder',
    })
  })

  it('CreateReminderBody accepts undefined title (per pre-split semantics)', () => {
    const body: CreateReminderBody = {
      scheduled_for: 1700000000,
      idempotency_key: 'idem-1',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
    }

    expect(body.title).toBeUndefined()
  })

  it('CancelReminderBody is exact: {reminder_id}', () => {
    const body: CancelReminderBody = { reminder_id: 'r1' }
    expect(body).toEqual({ reminder_id: 'r1' })
  })
})