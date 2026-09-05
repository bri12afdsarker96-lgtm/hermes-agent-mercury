/**
 * Reminders page — ViewModel tests (W1-C §P15).
 *
 * Pure-function tests for the page-reminders.view-model derivations.
 *
 * Per P1-VIS-V2-REMEDIATION-01:
 *   - The VM is now a pure derivation of server facts: no Date.now,
 *     no nowSeconds parameter, no relativeOffset / relativeOffsetTone.
 *   - deriveReminder and deriveReminders accept only the original
 *     (row, fmtEpoch) / (rows, fmtEpoch) signatures.
 *   - ReminderDetailView / detail / ownerDisplay are gone; the VM
 *     never invented an owner value in the first place.
 *   - The "unknown server state falls back to server string" test
 *     survives, verifying the VM does not invent transition labels.
 */

import { describe, expect, it } from 'vitest'

import type { ReminderRow } from './page-reminders.controller'
import {
  deriveReminder,
  deriveReminders,
  isRemindersEmpty,
  REMINDER_TONE,
  type ReminderRowView,
  reminderTone,
} from './page-reminders.view-model'

const fmtEpoch = (s: number | null | undefined) => `ts:${s ?? 'null'}`

const R1: ReminderRow = {
  generation: 1,
  reminder_id: 'r1',
  scheduled_for: 1700000000,
  state: 'active',
  subject_id: 'biz-1',
  subject_type: 'biz_task',
  timezone: 'UTC',
  title: 'My reminder',
}

const R2: ReminderRow = {
  ...R1,
  reminder_id: 'r2',
  state: 'cancelled',
}

const R3: ReminderRow = {
  ...R1,
  reminder_id: 'r3',
  state: 'exhausted',
  title: '', // empty title
}

describe('reminderTone (per P15 tone truth)', () => {
  it('active → good', () => {
    expect(reminderTone('active')).toBe('good')
  })
  it('cancelled → muted', () => {
    expect(reminderTone('cancelled')).toBe('muted')
  })
  it('exhausted → warn', () => {
    expect(reminderTone('exhausted')).toBe('warn')
  })
  it('unknown → muted', () => {
    expect(reminderTone('weird-state')).toBe('muted')
  })
  it('REMINDER_TONE table matches pre-split', () => {
    expect(REMINDER_TONE).toEqual({
      active: 'good',
      cancelled: 'muted',
      exhausted: 'warn',
    })
  })
})

describe('deriveReminder (wire → presentation)', () => {
  it('maps snake_case → camelCase and title fallback', () => {
    const v: ReminderRowView = deriveReminder(R1, fmtEpoch)
    expect(v.reminderId).toBe('r1')
    expect(v.title).toBe('My reminder')
    expect(v.subjectType).toBe('biz_task')
    expect(v.subjectId).toBe('biz-1')
    expect(v.timezone).toBe('UTC')
    expect(v.state).toBe('active')
    expect(v.tone).toBe('good')
    expect(v.canCancelFromState).toBe(true)
    expect(v.scheduledForDisplay).toBe('ts:1700000000')
    expect(v.scheduledFor).toBe(1700000000)
    expect(v.generation).toBe(1)
    expect(v.subjectDisplay).toBe('biz_task:biz-1')
    // V2-R1: no relativeOffset / relativeOffsetTone in the type
    expect((v as unknown as Record<string, unknown>).relativeOffset).toBeUndefined()
    expect((v as unknown as Record<string, unknown>).relativeOffsetTone).toBeUndefined()
    // V2-R2: no detail / ownerDisplay in the type
    expect((v as unknown as Record<string, unknown>).detail).toBeUndefined()
  })

  it('empty title → "Untitled reminder" fallback (per pre-split)', () => {
    const v = deriveReminder(R3, fmtEpoch)
    expect(v.title).toBe('Untitled reminder')
  })

  it('cancelled: canCancelFromState = false', () => {
    const v = deriveReminder(R2, fmtEpoch)
    expect(v.canCancelFromState).toBe(false)
    expect(v.tone).toBe('muted')
  })

  it('exhausted: canCancelFromState = false', () => {
    const v = deriveReminder(R3, fmtEpoch)
    expect(v.canCancelFromState).toBe(false)
    expect(v.tone).toBe('warn')
  })

  it('unknown server state → stateLabel falls back to the server string itself', () => {
    const row: ReminderRow = {
      ...R1,
      reminder_id: 'rY',
      state: 'pending-approval',
    }

    const v = deriveReminder(row, fmtEpoch)
    expect(v.stateLabel).toBe('pending-approval')
    expect(v.tone).toBe('muted') // unknown → muted default
  })

  it('is deterministic: same input produces same output across calls', () => {
    const a = deriveReminder(R1, fmtEpoch)
    const b = deriveReminder(R1, fmtEpoch)
    expect(a).toEqual(b)
  })
})

describe('deriveReminders (multi-row)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveReminders(null, fmtEpoch)).toEqual([])
    expect(deriveReminders(undefined, fmtEpoch)).toEqual([])
  })
  it('maps each row', () => {
    const out = deriveReminders([R1, R2, R3], fmtEpoch)
    expect(out).toHaveLength(3)
    expect(out[0]?.reminderId).toBe('r1')
    expect(out[1]?.reminderId).toBe('r2')
    expect(out[2]?.reminderId).toBe('r3')
  })
})

describe('isRemindersEmpty (per P13 empty semantics)', () => {
  it('returns true for null', () => {
    expect(isRemindersEmpty(null)).toBe(true)
  })
  it('returns true when available=false', () => {
    expect(isRemindersEmpty({ available: false, reminders: [{}] })).toBe(true)
  })
  it('returns true when reminders empty', () => {
    expect(isRemindersEmpty({ available: true, reminders: [] })).toBe(true)
  })
  it('returns false when available=true and reminders non-empty', () => {
    expect(isRemindersEmpty({ available: true, reminders: [{}] })).toBe(false)
  })
})
