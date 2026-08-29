/**
 * Tests for `lib/view-model.ts`.
 *
 * Pure-function tests: no React, no transport, no mocks. Input is a
 * fixed `whoami` + page; output is the VM; assertions are exact.
 *
 * These tests prove:
 *   1. `deriveCommonViewModel` delegates permission checks to
 *      `capabilities.ts::hasPermission` (we do NOT re-implement the
 *      wildcard logic here).
 *   2. The VM is a faithful mirror of server truth — no fabricated
 *      capabilities, no invented roles.
 *   3. Edge cases (null whoami, missing product_capabilities entry,
 *      page-level status vs server-declared capability status) are
 *      handled coherently.
 */

import { describe, expect, it } from 'vitest'

import { hasPermission } from '../capabilities'
import { type ConsolePage, findPage } from '../catalog'
import type { Whoami } from '../types'

import { deriveCommonViewModel } from './view-model'

const whoamiSuper: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'tenant', scopes: ['tenant:acme'] },
  effective_permissions: ['*'],
  name: 'Lin Qiao',
  principal_id: 'principal-1',
  product_capabilities: {},
  role: 'operator',
  tenant_id: 'tenant-acme',
}

const whoamiOperator: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'tenant', scopes: ['tenant:acme'] },
  effective_permissions: ['followup.read', 'biztask.read'],
  name: 'Lin Qiao',
  principal_id: 'principal-1',
  product_capabilities: {},
  role: 'operator',
  tenant_id: 'tenant-acme',
}

const whoamiNoKb: Whoami = {
  ...whoamiOperator,
  effective_permissions: ['followup.read', 'biztask.read'],
}

const whoamiKbAuthor: Whoami = {
  ...whoamiOperator,
  effective_permissions: ['followup.read', 'biztask.read', 'kb.author'],
}

describe('deriveCommonViewModel', () => {
  it('exposes canRead=true and canWrite=true for superuser on a ready page', () => {
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    expect(vm.canRead).toBe(true)
    expect(vm.canWrite).toBe(true)
    expect(vm.isReady).toBe(true)
    expect(vm.readOnlyReason).toBe(null)
    expect(vm.capabilityStatus).toBe('LIVE')
  })

  it('denies canRead when the page requires a permission the viewer lacks', () => {
    const page = findPage('identity') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiOperator })

    // identity requires 'principal.crud', viewer has only followup.read + biztask.read
    expect(vm.canRead).toBe(false)
    expect(vm.canWrite).toBe(false)
    expect(vm.readOnlyReason).toContain('principal.crud')
  })

  it('allows canRead but denies canWrite on a partially-wired page (write surface missing)', () => {
    // followup has controlStatus: 'missing' (Phase-1 read-only)
    const page = findPage('followup') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    expect(vm.canRead).toBe(true)
    expect(vm.canWrite).toBe(false) // controlStatus is 'missing' not 'ready'
    expect(vm.readOnlyReason).toContain('write')
  })

  it('returns a coherent VM when whoami is null (session still loading)', () => {
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: null })

    expect(vm.canRead).toBe(false) // unknown viewer = no read
    expect(vm.canWrite).toBe(false)
    // capabilityStatus mirrors the page.status even when whoami is null —
    // the page is 'ready', so the chip should reflect that. The view
    // decides whether to render the chip based on readOnlyReason + canRead.
    expect(vm.capabilityStatus).toBe('LIVE')
    expect(vm.readOnlyReason).toContain('metrics.view')
  })

  it('uses whoami.product_capabilities when capabilityName is provided and present', () => {
    const page = findPage('dashboard') as ConsolePage

    const whoamiWithMetrics: Whoami = {
      ...whoamiSuper,
      product_capabilities: {
        metrics: { enabled: true, status: 'CONTRACT' },
      },
    }

    const vm = deriveCommonViewModel({
      page,
      whoami: whoamiWithMetrics,
      capabilityName: 'metrics',
    })

    expect(vm.capabilityStatus).toBe('CONTRACT') // server truth wins
  })

  it('uses product_capabilities status when capabilityName matches a known product capability', () => {
    const page = findPage('knowledge') as ConsolePage

    const whoamiWithKb: Whoami = {
      ...whoamiKbAuthor,
      product_capabilities: {
        knowledge_rag: { enabled: true, status: 'LIVE' },
      },
    }

    const vm = deriveCommonViewModel({
      page,
      whoami: whoamiWithKb,
      capabilityName: 'knowledge_rag',
    })

    expect(vm.capabilityStatus).toBe('LIVE')
    expect(vm.isReadyDev).toBe(true) // knowledge page status is 'ready-dev'
  })

  it('falls back to page.status when capability is not in whoami.product_capabilities', () => {
    const page = findPage('knowledge') as ConsolePage

    // whoami has no knowledge_rag entry
    const vm = deriveCommonViewModel({
      page,
      whoami: whoamiNoKb,
      capabilityName: 'knowledge_rag',
    })

    // page.status = 'ready-dev' → capabilityStatus = 'DEV'
    expect(vm.capabilityStatus).toBe('DEV')
  })

  it('exposes isPartial / isBlocked for the corresponding page.status', () => {
    const usagePage = findPage('usage') as ConsolePage
    const auditPage = findPage('audit') as ConsolePage

    expect(
      deriveCommonViewModel({ page: usagePage, whoami: whoamiSuper }).isPartial
    ).toBe(true)

    // audit page has status 'ready' (not 'blocked'); super user with '*'
    // matches audit.read via the wildcard, so canRead is true. The
    // `hideWhenUnpermitted` flag on the catalog entry is a UI-side nav
    // decision (handled by console.tsx), not part of the VM derivation.
    const auditVm = deriveCommonViewModel({ page: auditPage, whoami: whoamiSuper })
    expect(auditVm.isBlocked).toBe(false)
    expect(auditVm.canRead).toBe(true)
  })
})

describe('deriveCommonViewModel delegates to capabilities.hasPermission', () => {
  it('super user with "*" matches any permission (parity with hasPermission)', () => {
    const page = findPage('identity') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    // direct call to hasPermission agrees
    expect(hasPermission(whoamiSuper, page.permission!)).toBe(vm.canRead)
  })

  it('operator without the perm is denied (parity with hasPermission)', () => {
    const page = findPage('identity') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiOperator })

    expect(hasPermission(whoamiOperator, page.permission!)).toBe(vm.canRead)
    expect(vm.canRead).toBe(false)
  })

  it('operator with the perm is allowed (parity with hasPermission)', () => {
    const page = findPage('tasks') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiOperator })

    expect(hasPermission(whoamiOperator, page.permission!)).toBe(vm.canRead)
    expect(vm.canRead).toBe(true)
  })

  it('null whoami denies every perm (parity with hasPermission)', () => {
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: null })

    expect(hasPermission(null, page.permission!)).toBe(vm.canRead)
    expect(vm.canRead).toBe(false)
  })
})