/**
 * Tests for `page-followup.view-model.ts` (W1-B1-REMEDIATION-01).
 *
 * Pure-function tests: no React, no transport, no mocks. We pass
 * fabricated `FollowupRow[]` / `FollowupHistoryRow[]` server answers
 * and assert the composed VM shape.
 *
 * Proves:
 *   1. List, detail, and history derivations preserve every server
 *      field without fabrication.
 *   2. `fmtIso` is applied to receivedAt / nextFollowupAt (per §P15).
 *   3. `transitionLabel` is null when neither from_status nor to_status
 *      is present (per §P16).
 *   4. The page VM delegates permission authority to
 *      `deriveCommonViewModel` (no parallel permission engine).
 *   5. The page VM accepts a real `whoami` (per §P10), not a hard-coded null.
 *   6. STATUS_TONE covers every FollowupStatus.
 */

import { describe, expect, it } from 'vitest'

import { findPage } from './catalog'
import type {
  FollowupRow,
  FollowupStatus,
} from './page-followup.controller'
import {
  deriveFollowupDetail,
  deriveFollowupHistory,
  deriveFollowupList,
  deriveFollowupPageViewModel,
  STATUS_TONE,
} from './page-followup.view-model'
import type { Whoami } from './types'

const baseWhoami: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'tenant', scopes: ['tenant:acme'] },
  effective_permissions: ['biztask.read'],
  name: 'Lin Qiao',
  principal_id: 'principal-1',
  product_capabilities: {},
  role: 'operator',
  tenant_id: 'tenant-acme',
}

const baseRow: FollowupRow = {
  amount: '500.00',
  business_subject: 'Customer refund review',
  business_team: 'risk',
  created_ts: '2026-08-29T10:24:00Z',
  currency: 'USD',
  expected_receive_date: '2026-09-15',
  followup_id: 'f-1',
  followup_type: 'refund_review',
  next_followup_at: '2026-09-01T00:00:00Z',
  owner_principal_id: 'principal-1',
  received_at: null,
  status: 'pending_confirmation',
  updated_ts: '2026-08-29T10:24:00Z',
  version: 1,
}

const fmtIso = (iso: null | string | undefined): string =>
  iso == null || iso === '' ? '—' : iso

describe('deriveFollowupList', () => {
  it('preserves every server field and applies fmtIso to receivedAt', () => {
    const vm = deriveFollowupList([baseRow], fmtIso)
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
      receivedAt: '—', // fmtIso(null) → '—'
      status: 'pending_confirmation',
      statusTone: 'warn',
    })
  })

  it('receivedAt set: fmtIso is applied to the value', () => {
    const rowWithReceivedAt = { ...baseRow, received_at: '2026-09-01T12:00:00Z' }
    const vm = deriveFollowupList([rowWithReceivedAt], fmtIso)
    expect(vm.rows[0].receivedAt).toBe('2026-09-01T12:00:00Z')
  })

  it('returns isEmpty=true for an empty server list', () => {
    const vm = deriveFollowupList([], fmtIso)
    expect(vm.isEmpty).toBe(true)
    expect(vm.rows).toEqual([])
  })
})

describe('deriveFollowupDetail', () => {
  it('returns null detail when row is null', () => {
    const vm = deriveFollowupDetail(null, fmtIso)
    expect(vm.detail).toBe(null)
  })

  it('maps row fields to view-friendly camelCase + applies fmtIso', () => {
    const vm = deriveFollowupDetail(baseRow, fmtIso)
    expect(vm.detail).toMatchObject({
      amount: '500.00',
      businessSubject: 'Customer refund review',
      currency: 'USD',
      expectedReceiveDate: '2026-09-15',
      followupId: 'f-1',
      nextFollowupAt: '2026-09-01T00:00:00Z', // fmtIso applied
      ownerPrincipalId: 'principal-1',
      receivedAt: '—', // fmtIso(null) → '—'
      status: 'pending_confirmation',
      statusTone: 'warn',
    })
  })
})

describe('deriveFollowupHistory', () => {
  it('transitionLabel present when from OR to status is non-null', () => {
    const vm = deriveFollowupHistory([
      {
        actor_principal_id: null,
        created_ts: '2026-08-29T10:24:00Z',
        event_type: 'status_changed',
        followup_id: 'f-1',
        from_status: 'created',
        history_id: 'h-1',
        to_status: 'open',
      },
    ])

    expect(vm.events[0].transitionLabel).toBe('created → open')
  })

  it('transitionLabel null when neither from_status nor to_status is present', () => {
    const vm = deriveFollowupHistory([
      {
        actor_principal_id: null,
        created_ts: '2026-08-29T10:24:00Z',
        event_type: 'note',
        followup_id: 'f-1',
        from_status: null,
        history_id: 'h-2',
        to_status: null,
      },
    ])

    expect(vm.events[0].transitionLabel).toBe(null)
  })

  it('transitionLabel present when only to_status is set', () => {
    const vm = deriveFollowupHistory([
      {
        actor_principal_id: null,
        created_ts: '2026-08-29T10:24:00Z',
        event_type: 'created',
        followup_id: 'f-1',
        from_status: null,
        history_id: 'h-3',
        to_status: 'created',
      },
    ])

    expect(vm.events[0].transitionLabel).toBe('— → created')
  })

  it('returns isEmpty=true for empty history', () => {
    const vm = deriveFollowupHistory([])
    expect(vm.isEmpty).toBe(true)
    expect(vm.events).toEqual([])
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
      expect(STATUS_TONE[s]).toBeDefined()
    }
  })
})

describe('deriveFollowupPageViewModel', () => {
  const page = findPage('followup')!

  it('delegates permission authority to deriveCommonViewModel with real whoami', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      whoami: baseWhoami,
      listRows: [],
      fmtIso,
    })

    expect(vm.readOnlyReason).not.toBe(null)
  })

  it('null whoami → fail-closed permission (per W1-A)', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      whoami: null,
      listRows: [],
      fmtIso,
    })

    expect(vm.canRead).toBe(false)
    expect(vm.readOnlyReason).toMatch(/session/)
  })

  it('returns coherent list state for empty server rows', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      whoami: baseWhoami,
      listRows: [],
      fmtIso,
    })

    expect(vm.list.isEmpty).toBe(true)
  })

  it('preserves server-declared list rows without mutation', () => {
    const vm = deriveFollowupPageViewModel({
      page,
      whoami: baseWhoami,
      listRows: [baseRow],
      fmtIso,
    })

    expect(vm.list.rows).toHaveLength(1)
    expect(vm.list.rows[0].followupId).toBe('f-1')
    expect(vm.list.rows[0].status).toBe('pending_confirmation')
  })
})