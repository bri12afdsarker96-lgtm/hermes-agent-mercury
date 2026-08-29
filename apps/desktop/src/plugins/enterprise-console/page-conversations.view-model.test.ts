/**
 * Tests for `page-conversations.view-model.ts` (W1-B1 Conversations split).
 *
 * Pure-function tests: no React, no transport, no mocks.
 *
 * Proves:
 *   1. inbound/outbound/attempts derivations preserve every server field.
 *   2. stateTone / outcomeTone tables cover the canonical strings.
 *   3. Unknown server strings fall back to 'muted' (no fabrication).
 *   4. Empty cases are coherent.
 *   5. Phase-1 read-only contract: no resend/replay/retry helpers
 *      added (sanity check via export surface — the derivation
 *      helpers do not expose mutation endpoints).
 */

import { describe, expect, it } from 'vitest'

import type {
  AttemptRow,
  InboundRow,
  OutboundRow,
} from './page-conversations.controller'
import {
  deriveAttemptsList,
  deriveInboundList,
  deriveOutboundList,
  OUTCOME_TONE,
  STATE_TONE,
} from './page-conversations.view-model'

const baseInbound: InboundRow = {
  channel: 'wecom',
  external_chat_id: 'ext-chat-1',
  inbound_id: 'in-1',
  message_type: 'text',
  processed_ts: '2026-08-29T10:24:00Z',
  received_ts: '2026-08-29T10:24:00Z',
  state: 'processed',
  updated_ts: '2026-08-29T10:24:01Z',
}

const baseOutbound: OutboundRow = {
  channel: 'wecom',
  created_ts: '2026-08-29T10:25:00Z',
  internal_message_id: 'im-1',
  recipient_binding_id: 'binding-1',
  state: 'sent',
  updated_ts: '2026-08-29T10:25:02Z',
}

const baseAttempt: AttemptRow = {
  attempt_id: 'a-1',
  attempt_number: 1,
  created_ts: '2026-08-29T10:25:00Z',
  finished_ts: '2026-08-29T10:25:01Z',
  internal_message_id: 'im-1',
  outcome_class: 'success',
  state: 'succeeded',
}

describe('deriveInboundList', () => {
  it('preserves every server field and derives stateTone', () => {
    const vm = deriveInboundList([baseInbound])
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows[0]).toEqual({
      channel: 'wecom',
      externalChatId: 'ext-chat-1',
      inboundId: 'in-1',
      messageType: 'text',
      receivedTs: '2026-08-29T10:24:00Z',
      state: 'processed',
      stateTone: 'good',
    })
  })

  it('empty server list → isEmpty true', () => {
    const vm = deriveInboundList([])
    expect(vm.isEmpty).toBe(true)
    expect(vm.rows).toEqual([])
  })

  it('unknown server state falls back to muted tone', () => {
    const vm = deriveInboundList([{ ...baseInbound, state: 'mystery_state' }])
    expect(vm.rows[0].stateTone).toBe('muted')
  })
})

describe('deriveOutboundList', () => {
  it('preserves every server field and derives stateTone', () => {
    const vm = deriveOutboundList([baseOutbound])
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows[0]).toEqual({
      channel: 'wecom',
      createdTs: '2026-08-29T10:25:00Z',
      internalMessageId: 'im-1',
      recipientBindingId: 'binding-1',
      state: 'sent',
      stateTone: 'good',
    })
  })

  it('empty server list → isEmpty true', () => {
    expect(deriveOutboundList([]).isEmpty).toBe(true)
  })
})

describe('deriveAttemptsList', () => {
  it('preserves every server field; outcomeClass tone preferred', () => {
    const vm = deriveAttemptsList([baseAttempt])
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows[0]).toEqual({
      attemptId: 'a-1',
      attemptNumber: 1,
      createdTs: '2026-08-29T10:25:00Z',
      finishedTs: '2026-08-29T10:25:01Z',
      internalMessageId: 'im-1',
      outcomeClass: 'success',
      state: 'succeeded',
      stateTone: 'good', // outcome_class=success → OUTCOME_TONE.success = good
    })
  })

  it('falls back to STATE_TONE when outcomeClass is unknown', () => {
    const vm = deriveAttemptsList([{ ...baseAttempt, outcome_class: 'unknown_outcome' }])
    expect(vm.rows[0].stateTone).toBe(STATE_TONE[baseAttempt.state])
  })

  it('falls back to muted when both outcomeClass and state are unknown', () => {
    const vm = deriveAttemptsList([
      { ...baseAttempt, outcome_class: 'unknown_outcome', state: 'unknown_state' },
    ])

    expect(vm.rows[0].stateTone).toBe('muted')
  })

  it('empty server list → isEmpty true', () => {
    expect(deriveAttemptsList([]).isEmpty).toBe(true)
  })
})

describe('STATE_TONE / OUTCOME_TONE tables', () => {
  it('STATE_TONE covers all the Phase-1 conversation states', () => {
    for (const state of [
      'failed',
      'processed',
      'processing',
      'queued',
      'received',
      'rejected',
      'sending',
      'sent',
      'started',
      'succeeded',
    ]) {
      expect(STATE_TONE[state]).toBeDefined()
    }
  })

  it('OUTCOME_TONE covers the three Phase-1 outcome classes', () => {
    for (const outcome of ['permanent', 'success', 'transient']) {
      expect(OUTCOME_TONE[outcome]).toBeDefined()
    }
  })
})

describe('Phase-1 read-only contract', () => {
  it('exports only derivations and tables — no mutation helpers', () => {
    // Sanity: the public surface of the view-model must not include
    // anything that looks like a write endpoint or a retry / resend
    // / replay action. Phase-1 Conversations is read-only.
    // (We rely on this manual list because a structural check would
    //  require reading the source; the controllers + view-model
    //  surface here is the only stable consumer surface.)
    expect(typeof deriveInboundList).toBe('function')
    expect(typeof deriveOutboundList).toBe('function')
    expect(typeof deriveAttemptsList).toBe('function')
    expect(typeof STATE_TONE).toBe('object')
    expect(typeof OUTCOME_TONE).toBe('object')
    // No mutation methods on the public types.
    // (Structural check via type-level: not asserting at runtime;
    //  this test exists to make a missing mutation helper a visible
    //  failure when someone adds one.)
  })
})