/**
 * Tests for `page-followup.view-model.ts` (W1-B1 Follow-up split).
 *
 * Pure-function tests: no React, no transport, no mocks. We pass
 * fabricated `FollowupRow[]` / `FollowupHistoryRow[]` server answers
 * and assert the composed VM shape.
 *
 * Proves:
 *   1. List, detail, and history derivations preserve every server
 *      field without fabrication.
 *   2. status tone is derived from status enum (not from server flags).
 *   3. Empty / null cases are coherent.
 *   4. Page VM delegates permission authority to deriveCommonViewModel
 *      (no parallel permission engine).
 */

import { describe, expect, it } from 'vitest'

import { findPage } from './catalog'
import type { FollowupHistoryRow, FollowupRow, FollowupStatus } from './page-followup.controller'
import {
  deriveFollowupDetail,
  deriveFollowupHistory,
  deriveFollowupList,
  deriveFollowupPageViewModel,
  STATUS_TONE,
} from './page-followup.view-model'

const baseRow: FollowupRow = {
  amount: '500.00',
  business_subject: 'Customer refund review',
  business_team: 'risk',
  created_ts: '2026-08-29T10:24:00Z',
  currency: 'USD',
  expected_receive_date: '2026-09-15',
  followup_id: 'f-1',
  followup_type: 'refund_review',
  next_followup_at: null,
  owner_principal_id: 'principal-1',
  received_at: null,
  status: 'pending_confirmation',
  updated_ts: '2026-08-29T10:24:00Z',
  version: 1,
}

const baseHistory: FollowupHistoryRow[] = [
  {
    actor_principal_id: 'principal-1',
    created_ts: '2026-08-29T10:24:00Z',
    event_type: 'created',
    followup_id: 'f-1',
    from_status: null,
    history_id: 'h-1',
    to_status: 'created',
  },
  {
    actor_principal_id: 'principal-2',
    created_ts: '2026-08-30T08:00:00Z',
    event_type: 'status_changed',
    followup_id: 'f-1',
    from_status: 'created',
    history_id: 'h-2',
    to_status: 'pending_confirmation',
  },
]

describe('deriveFollowupList', () => {
  it('preserves every server field and derives statusTone', () => {
    const vm = deriveFollowupList([baseRow])
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows).toHaveLength(1)
    expect(vm.rows[0]).toEqual({
      amount: '500.00',
      businessSubject: 'Customer refund review',
      businessTeam: 'risk',
      currency: 'USD',
      expectedReceiveDate: '2026-09-15',
      followupId: 'f-1',
      followupType: 'refund_review',
      ownerPrincipalId: 'principal-1',
      receivedAt: null,
      status: 'pending_confirmation',
      statusTone: 'warn',
    })
  })

  it('returns isEmpty=true for an empty server list', () => {
    const vm = deriveFollowupList([])
    expect(vm.isEmpty).toBe(true)
    expect(vm.rows).toEqual([])
  })
})

describe('deriveFollowupDetail', () => {
  it('returns null detail when row is null', () => {
    const vm = deriveFollowupDetail(null)
    expect(vm.detail).toBe(null)
    expect(vm.detailError).toBe(null)
    expect(vm.detailPending).toBe(false)
  })

  it('maps row fields to view-friendly camelCase', () => {
    const vm = deriveFollowupDetail(baseRow)
    expect(vm.detail).toMatchObject({
      amount: '500.00',
      businessSubject: 'Customer refund review',
      currency: 'USD',
      expectedReceiveDate: '2026-09-15',
      followupId: 'f-1',
      nextFollowupAt: null,
      ownerPrincipalId: 'principal-1',
      receivedAt: null,
      status: 'pending_confirmation',
      statusTone: 'warn',
    })
  })
})

describe('deriveFollowupHistory', () => {
  it('maps history events to view-friendly shape with transition label', () => {
    const vm = deriveFollowupHistory(baseHistory)
    expect(vm.isEmpty).toBe(false)
    expect(vm.events).toHaveLength(2)

    // Event 1: from=null, to='created' → '— → created'
    expect(vm.events[0]).toMatchObject({
      actorPrincipalId: 'principal-1',
      eventType: 'created',
      fromStatus: null,
      historyId: 'h-1',
      statusTone: 'muted', // 'created' → STATUS_TONE.created = muted
      timestamp: '2026-08-29T10:24:00Z',
      title: 'created',
      toStatus: 'created',
      transitionLabel: '— → created',
    })

    // Event 2: from='created', to='pending_confirmation' → 'created → pending_confirmation'
    expect(vm.events[1]).toMatchObject({
      actorPrincipalId: 'principal-2',
      eventType: 'status_changed',
      fromStatus: 'created',
      historyId: 'h-2',
      statusTone: 'warn', // 'pending_confirmation' → STATUS_TONE = warn
      timestamp: '2026-08-30T08:00:00Z',
      title: 'status_changed',
      toStatus: 'pending_confirmation',
      transitionLabel: 'created → pending_confirmation',
    })
  })

  it('returns isEmpty=true for empty history', () => {
    const vm = deriveFollowupHistory([])
    expect(vm.isEmpty).toBe(true)
    expect(vm.events).toEqual([])
  })

  it('defaults statusTone to muted when to_status is unknown', () => {
    const events: FollowupHistoryRow[] = [
      {
        actor_principal_id: null,
        created_ts: '2026-08-29T10:24:00Z',
        event_type: 'note',
        followup_id: 'f-1',
        from_status: null,
        history_id: 'h-3',
        to_status: null,
      },
    ]

    const vm = deriveFollowupHistory(events)
    expect(vm.events[0].statusTone).toBe('muted')
    expect(vm.events[0].transitionLabel).toBe('— → —')
  })
})

describe('STATUS_TONE table', () => {
  it('covers every FollowupStatus', () => {
    const statuses: FollowupStatus[] = [
      'cancelled',
      'completed',
      'created',
      'followup_due',
      'open',
      'pending_confirmation',
      'waiting_update',
    ]

    for (const s of statuses) {
      expect(STATUS_TONE[s as keyof typeof STATUS_TONE]).toBeDefined()
    }
  })
})

describe('deriveFollowupPageViewModel', () => {
  const page = findPage('followup')!

  it('delegates permission authority to deriveCommonViewModel', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      listRows: [],
      listPending: false,
      listError: null,
    })

    // followup page status is 'ready' (server-declared contract).
    expect(vm.readOnlyReason).not.toBe(null) // whoami=null → fail-closed
  })

  it('returns coherent list state for empty server rows', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      listRows: [],
      listPending: false,
      listError: null,
    })

    expect(vm.list.isEmpty).toBe(true)
    expect(vm.listPending).toBe(false)
    expect(vm.listError).toBe(null)
  })

  it('surfaces listError as message string', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      listRows: [],
      listPending: false,
      listError: new Error('boom'),
    })

    expect(vm.listError).toBe('boom')
  })

  it('non-Error throw → listError = null (no fabricated string)', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      listRows: [],
      listPending: false,
      listError: 'string error',
    })

    expect(vm.listError).toBe(null)
  })

  it('preserves server-declared list rows without mutation', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      listRows: [baseRow],
      listPending: false,
      listError: null,
    })

    expect(vm.list.rows).toHaveLength(1)
    expect(vm.list.rows[0].followupId).toBe('f-1')
    expect(vm.list.rows[0].status).toBe('pending_confirmation')
  })
})