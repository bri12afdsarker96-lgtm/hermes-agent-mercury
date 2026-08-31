/**
 * Reminders page — ViewModel tests (W1-C §P15).
 *
 * Pure-function tests for the page-reminders.view-model derivations.
 *
 * Per P1-VIS-V2 (Reminders productization):
 *   - Existing tone + derive + isEmpty tests are the W1-C contract.
 *   - New relativeOffsetFor + V2-field tests cover the presentation
 *     additions (relativeOffset, relativeOffsetTone, stateLabel, detail).
 *     Each new test is hermetic — passes explicit `nowSeconds` so the
 *     wall clock is never a flake source.
 */

import { describe, expect, it } from 'vitest'

import type { ReminderRow } from './page-reminders.controller'
import {
  deriveReminder,
  deriveReminders,
  isRemindersEmpty,
  relativeOffsetFor,
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
    const v: ReminderRowView = deriveReminder(R1, fmtEpoch, 1_700_000_000)
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
  })

  it('empty title → "Untitled reminder" fallback (per pre-split)', () => {
    const v = deriveReminder(R3, fmtEpoch, 1_700_000_000)
    expect(v.title).toBe('Untitled reminder')
  })

  it('cancelled: canCancelFromState = false', () => {
    const v = deriveReminder(R2, fmtEpoch, 1_700_000_000)
    expect(v.canCancelFromState).toBe(false)
    expect(v.tone).toBe('muted')
  })

  it('exhausted: canCancelFromState = false', () => {
    const v = deriveReminder(R3, fmtEpoch, 1_700_000_000)
    expect(v.canCancelFromState).toBe(false)
    expect(v.tone).toBe('warn')
  })
})

describe('deriveReminders (multi-row)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveReminders(null, fmtEpoch)).toEqual([])
    expect(deriveReminders(undefined, fmtEpoch)).toEqual([])
  })
  it('maps each row', () => {
    const out = deriveReminders([R1, R2, R3], fmtEpoch, 1_700_000_000)
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

// =============================================================================
// V2 PRODUCTIZATION — relative-offset label & detail derivation
// =============================================================================

describe('relativeOffsetFor (V2 productization)', () => {
  it('returns muted+empty for non-finite scheduledFor', () => {
    expect(relativeOffsetFor(Number.NaN, 0)).toEqual({ label: '', tone: 'muted' })
  })

  it('returns muted+empty for non-finite nowSeconds', () => {
    expect(relativeOffsetFor(0, Number.NaN)).toEqual({ label: '', tone: 'muted' })
  })

  it('seconds in the future (<5m): warn tone, "in Xs" label', () => {
    const r = relativeOffsetFor(1000, 990)
    expect(r.label).toBe('in 10s')
    expect(r.tone).toBe('warn')
  })

  it('minutes in the future (>=5m): good tone, "in Xm" label', () => {
    const r = relativeOffsetFor(1000, 1000 - 60 * 10)
    expect(r.label).toBe('in 10m')
    expect(r.tone).toBe('good')
  })

  it('hours: good tone', () => {
    const r = relativeOffsetFor(4 * 3600, 0)
    expect(r.label).toBe('in 4h')
    expect(r.tone).toBe('good')
  })

  it('days: good tone', () => {
    const r = relativeOffsetFor(3 * 86400, 0)
    expect(r.label).toBe('in 3d')
    expect(r.tone).toBe('good')
  })

  it('past: muted tone, "X ago" label', () => {
    const r = relativeOffsetFor(1000, 1060)
    expect(r.label).toBe('1m ago')
    expect(r.tone).toBe('muted')
  })

  it('exact-now boundary: delta=0 is future, label "in 0s"', () => {
    // future = delta >= 0, so delta=0 → "in 0s" with warn tone (<5m)
    const r = relativeOffsetFor(1000, 1000)
    expect(r.label).toBe('in 0s')
    expect(r.tone).toBe('warn')
  })
})

describe('deriveReminder V2 fields (relativeOffset / stateLabel / detail)', () => {
  it('populates relativeOffset + stateLabel + detail with server-fact values only', () => {
    const row: ReminderRow = {
      generation: 3,
      reminder_id: 'r1',
      // 10 minutes past the reference nowSeconds below — confirms the
      // "minutes >= 5" boundary in relativeOffsetFor (tone 'good',
      // label 'in 10m').
      scheduled_for: 1_000_600,
      state: 'active',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'Asia/Shanghai',
      title: 'My reminder',
    }

    const v = deriveReminder(row, (s) => `ts:${s}`, 1_000_000)
    expect(v.relativeOffset).toBe('in 10m')
    expect(v.relativeOffsetTone).toBe('good')
    expect(v.stateLabel).toBe('active')
    expect(v.detail.title).toBe('My reminder')
    expect(v.detail.stateLabel).toBe('active')
    expect(v.detail.stateTone).toBe('good')
    expect(v.detail.subjectDisplay).toBe('biz_task:biz-1')
    expect(v.detail.scheduledForDisplay).toBe('ts:1000600')
    expect(v.detail.timezone).toBe('Asia/Shanghai')
    expect(v.detail.reminderId).toBe('r1')
    expect(v.detail.generationLabel).toBe('generation 3')
    // ownerDisplay is a presentation placeholder; server has no owner field.
    expect(v.detail.ownerDisplay).toBe('—')
  })

  it('cancelled row: stateLabel passthrough, canCancelFromState=false preserved', () => {
    const row: ReminderRow = {
      generation: 1,
      reminder_id: 'r2',
      scheduled_for: 1_000_600,
      state: 'cancelled',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
      title: 'done',
    }

    const v = deriveReminder(row, (s) => String(s), 1_000_000)
    expect(v.stateLabel).toBe('cancelled')
    expect(v.canCancelFromState).toBe(false)
    expect(v.tone).toBe('muted')
    expect(v.detail.stateTone).toBe('muted')
  })

  it('exhausted row: stateLabel passthrough', () => {
    const row: ReminderRow = {
      generation: 1,
      reminder_id: 'r3',
      scheduled_for: 1_000_600,
      state: 'exhausted',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
      title: '',
    }

    const v = deriveReminder(row, (s) => String(s), 1_000_000)
    expect(v.stateLabel).toBe('exhausted')
    expect(v.tone).toBe('warn')
    expect(v.title).toBe('Untitled reminder')
  })

  it('default nowSeconds falls back to Date.now()/1000 (forward-compatible)', () => {
    const row: ReminderRow = {
      generation: 1,
      reminder_id: 'rX',
      scheduled_for: Math.floor(Date.now() / 1000) + 600, // 10 min in the future
      state: 'active',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
      title: 'future',
    }

    const v = deriveReminder(row, (s) => String(s))
    expect(v.relativeOffset).toMatch(/in 1\dm/)
  })

  it('unknown server state → stateLabel falls back to the server string itself', () => {
    const row: ReminderRow = {
      generation: 1,
      reminder_id: 'rY',
      scheduled_for: 1_000_600,
      state: 'pending-approval',
      subject_id: 'biz-1',
      subject_type: 'biz_task',
      timezone: 'UTC',
      title: 't',
    }

    const v = deriveReminder(row, (s) => String(s), 1_000_000)
    expect(v.stateLabel).toBe('pending-approval')
    expect(v.tone).toBe('muted') // unknown → muted default
  })
})
