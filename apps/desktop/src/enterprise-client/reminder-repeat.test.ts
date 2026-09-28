import { describe, expect, it } from 'vitest'
import { REMINDER_REPEAT_MS, ReminderRepeatTracker } from './reminder-repeat'

const cue = { id: 'r', occurrence: 'r:1', status: 'active', title: 'Follow up', body: 'Follow up' }
describe('presentation-only reminder repetition', () => {
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
