import { describe, expect, it } from 'vitest'
import { REMINDER_REPEAT_MS, ReminderRepeatTracker } from './reminder-repeat'

const cue = { id: 'r', occurrence: 'r:1', status: 'active', title: 'Follow up', body: 'Follow up' }
describe('presentation-only reminder repetition', () => {
  it('preserves the original thirty-minute clock through reloads without storing message content', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value)} }
    new ReminderRepeatTracker(storage, 'tenant:user').reconcile([cue], 100)
    expect(values.get('tenant:user')).not.toContain(cue.title)
    expect(new ReminderRepeatTracker(storage, 'tenant:user').reconcile([cue], 1000)).toEqual([])
    expect(new ReminderRepeatTracker(storage, 'tenant:user').reconcile([cue], 100 + REMINDER_REPEAT_MS)).toEqual([{...cue, repeated: true}])
    expect(new ReminderRepeatTracker(storage, 'tenant:user').reconcile([cue], 100 + REMINDER_REPEAT_MS * 2)).toEqual([])
    expect(new ReminderRepeatTracker(storage, 'other:user').reconcile([cue], 1000)[0].repeated).toBe(false)
  })
  it('keeps reminders available when persistence is corrupt or denied', () => {
    const corrupt = { getItem: () => '{broken', setItem: () => {throw new Error('denied')} }
    expect(new ReminderRepeatTracker(corrupt, 'key').reconcile([cue], 100)).toEqual([{...cue, repeated: false}])
  })
  it('announces immediately and exactly once after thirty minutes, not every poll', () => {
    const tracker = new ReminderRepeatTracker()
    expect(tracker.reconcile([cue], 100)).toEqual([{...cue, repeated: false}])
    expect(tracker.reconcile([cue], 100 + REMINDER_REPEAT_MS - 1)).toEqual([])
    expect(tracker.reconcile([cue], 100 + REMINDER_REPEAT_MS)).toEqual([{...cue, repeated: true}])
    expect(tracker.reconcile([cue], 100 + REMINDER_REPEAT_MS * 2)).toEqual([])
  })
  it('cancels the repeat when state changes, even if it later changes back', () => {
    const tracker = new ReminderRepeatTracker()
    tracker.reconcile([cue], 0)
    expect(tracker.reconcile([{...cue, status:'updated'}], 500)).toEqual([])
    expect(tracker.reconcile([cue], REMINDER_REPEAT_MS)).toEqual([])
  })
  it('removes completed work and starts a separate clock for a rescheduled occurrence', () => {
    const tracker = new ReminderRepeatTracker()
    tracker.reconcile([cue], 0)
    expect(tracker.reconcile([], REMINDER_REPEAT_MS)).toEqual([])
    expect(tracker.reconcile([{...cue, occurrence:'r:2'}], REMINDER_REPEAT_MS + 10)[0].repeated).toBe(false)
  })
  it('coalesces catch-up into one repeat and isolates each scope in a fresh tracker', () => {
    const tracker = new ReminderRepeatTracker()
    tracker.reconcile([cue], 0)
    expect(tracker.reconcile([cue], REMINDER_REPEAT_MS * 10)).toHaveLength(1)
    expect(tracker.reconcile([cue], REMINDER_REPEAT_MS * 11)).toHaveLength(0)
    expect(new ReminderRepeatTracker().reconcile([cue], REMINDER_REPEAT_MS)[0].repeated).toBe(false)
  })
})
