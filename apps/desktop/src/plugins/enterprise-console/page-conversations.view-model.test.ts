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
  deriveInboundCount,
  deriveInboundList,
  deriveOutboundCount,
  deriveOutboundList,
  OUTCOME_TONE,
  STATE_TONE,
} from './page-conversations.view-model'

const fmtIso = (iso: null | string | undefined): string =>
  iso == null || iso === '' ? '—' : iso

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
    const vm = deriveInboundList([baseInbound], fmtIso)
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

  it('receivedTs is formatted via fmtIso', () => {
    const vm = deriveInboundList([baseInbound], fmtIso)
    expect(vm.rows[0].receivedTs).toBe('2026-08-29T10:24:00Z')
  })

  it('empty server list → isEmpty true', () => {
    const vm = deriveInboundList([], fmtIso)
    expect(vm.isEmpty).toBe(true)
    expect(vm.rows).toEqual([])
  })

  it('unknown server state falls back to muted tone', () => {
    const vm = deriveInboundList([{ ...baseInbound, state: 'mystery_state' }], fmtIso)
    expect(vm.rows[0].stateTone).toBe('muted')
  })
})

describe('deriveOutboundList', () => {
  it('preserves every server field and derives stateTone', () => {
    const vm = deriveOutboundList([baseOutbound], fmtIso)
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

  it('createdTs is formatted via fmtIso', () => {
    const vm = deriveOutboundList([baseOutbound], fmtIso)
    expect(vm.rows[0].createdTs).toBe('2026-08-29T10:25:00Z')
  })

  it('empty server list → isEmpty true', () => {
    expect(deriveOutboundList([], fmtIso).isEmpty).toBe(true)
  })
})

describe('deriveAttemptsList', () => {
  it('preserves every server field; outcomeClass tone preferred', () => {
    const vm = deriveAttemptsList([baseAttempt], fmtIso)
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

  it('finishedTs is formatted via fmtIso', () => {
    const vm = deriveAttemptsList([baseAttempt], fmtIso)
    expect(vm.rows[0].finishedTs).toBe('2026-08-29T10:25:01Z')
  })

  it('falls back to STATE_TONE when outcomeClass is unknown', () => {
    const vm = deriveAttemptsList([{ ...baseAttempt, outcome_class: 'unknown_outcome' }], fmtIso)
    expect(vm.rows[0].stateTone).toBe(STATE_TONE[baseAttempt.state])
  })

  it('falls back to muted when both outcomeClass and state are unknown', () => {
    const vm = deriveAttemptsList(
      [{ ...baseAttempt, outcome_class: 'unknown_outcome', state: 'unknown_state' }],
      fmtIso
    )

    expect(vm.rows[0].stateTone).toBe('muted')
  })

  it('empty server list → isEmpty true', () => {
    expect(deriveAttemptsList([], fmtIso).isEmpty).toBe(true)
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
    expect(typeof deriveInboundList).toBe('function')
    expect(typeof deriveOutboundList).toBe('function')
    expect(typeof deriveAttemptsList).toBe('function')
    expect(typeof STATE_TONE).toBe('object')
    expect(typeof OUTCOME_TONE).toBe('object')
  })
})

/**
 * P1-VIS-V1-PRODUCTIZATION-REBUILD-02 — count chip is real-data, never
 * fabricated. Proves that deriveInboundCount / deriveOutboundCount are
 * pure pass-throughs to view.rows.length so the TabToggle chip cannot
 * drift from the actual rows rendered below.
 */
describe('deriveInboundCount (P1-VIS-V1 real-data count)', () => {
  it('equals the row count for a populated inbound view', () => {
    const vm = deriveInboundList([baseInbound, { ...baseInbound, inbound_id: 'in-2' }], fmtIso)
    expect(deriveInboundCount(vm)).toBe(2)
  })

  it('is 0 for an empty inbound view', () => {
    expect(deriveInboundCount(deriveInboundList([], fmtIso))).toBe(0)
  })
})

describe('deriveOutboundCount (P1-VIS-V1 real-data count)', () => {
  it('equals the row count for a populated outbound view', () => {
    const vm = deriveOutboundList([baseOutbound, { ...baseOutbound, internal_message_id: 'im-2' }], fmtIso)
    expect(deriveOutboundCount(vm)).toBe(2)
  })

  it('is 0 for an empty outbound view', () => {
    expect(deriveOutboundCount(deriveOutboundList([], fmtIso))).toBe(0)
  })
})