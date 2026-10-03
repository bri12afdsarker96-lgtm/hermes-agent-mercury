import { describe, expect, it } from 'vitest'
import { FollowupPendingActions } from './followup-pending-action'

describe('uncertain follow-up actions', () => {
  it('retries the same facts and rejects a changed date until confirmed', () => {
    const pending = new FollowupPendingActions()
    const first = pending.request('a', 'reschedule', '2026-10-05')
    expect(pending.request('a', 'reschedule', '2026-10-05')).toEqual(first)
    expect(() => pending.request('a', 'reschedule', '2026-10-06')).toThrow()
    pending.confirm('a', 'reschedule')
    expect(pending.request('a', 'reschedule', '2026-10-06').idempotency_key).not.toBe(first.idempotency_key)
  })
  it('isolates records and prevents callers from mutating the saved payload', () => {
    const pending = new FollowupPendingActions()
    const first = pending.request('a', 'close')
    const key = first.idempotency_key
    first.idempotency_key = 'mutated'
    expect(pending.request('a', 'close').idempotency_key).toBe(key)
    expect(pending.request('b', 'close').idempotency_key).not.toBe(key)
  })
})
