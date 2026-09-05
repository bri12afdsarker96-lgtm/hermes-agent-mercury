/**
 * Handoff page — Controller tests (W1-C §P18 + §P21).
 *
 * Verifies exact query key, refetch interval, and mutation
 * signatures.
 */

import { describe, expect, it } from 'vitest'

import {
  type ClaimHandoffBody,
  type HandoffRow,
  HANDOFFS_KEY,
  HANDOFFS_REFETCH_MS,
  type ReplyHandoffBody,
  type RequeueHandoffBody,
} from './page-handoff.controller'

describe('Handoff page controller (W1-C §P21)', () => {
  it('HANDOFFS_KEY is exact: ["enterprise-console", "handoffs"]', () => {
    expect(HANDOFFS_KEY).toEqual(['enterprise-console', 'handoffs'])
  })

  it('HANDOFFS_REFETCH_MS is 15000', () => {
    expect(HANDOFFS_REFETCH_MS).toBe(15_000)
  })

  it('HandoffRow wire-shape preserves snake_case', () => {
    const row: HandoffRow = {
      agent_id: null,
      claim_age_s: 12,
      expires_in_s: 300,
      msg_id: 'm1',
      state: 'parked',
      status: null,
      text: 'Sample handoff',
      thread_id: 't1',
    }

    expect(row.agent_id).toBeNull()
    expect(row.claim_age_s).toBe(12)
    expect(row.msg_id).toBe('m1')
    expect(row.state).toBe('parked')
  })

  it('ClaimHandoffBody is exact: {msg_id}', () => {
    const body: ClaimHandoffBody = { msg_id: 'm1' }
    expect(body).toEqual({ msg_id: 'm1' })
  })

  it('ReplyHandoffBody is exact: {msg_id, text}', () => {
    const body: ReplyHandoffBody = { msg_id: 'm1', text: 'hello' }
    expect(body).toEqual({ msg_id: 'm1', text: 'hello' })
  })

  it('RequeueHandoffBody is exact: {msg_id}', () => {
    const body: RequeueHandoffBody = { msg_id: 'm1' }
    expect(body).toEqual({ msg_id: 'm1' })
  })
})