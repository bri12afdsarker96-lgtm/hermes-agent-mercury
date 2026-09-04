/**
 * Tests for `view-model.ts`.
 *
 * Pure-function tests: no React, no transport, no mocks. Input is a
 * fixed `whoami` + page; output is the VM; assertions are exact.
 *
 * These tests prove (per W1-A-REMEDIATION-01 §12):
 *
 *   1. `deriveCommonViewModel` delegates permission checks to
 *      `capabilities.ts::hasPermission` (we do NOT re-implement the
 *      wildcard logic here).
 *   2. The VM is a faithful mirror of server truth — no fabricated
 *      capabilities, no invented roles.
 *   3. The shared layer DOES NOT declare generic write authority
 *      (`canWrite` is gone).
 *   4. `capabilityStatus` only reflects server runtime capability
 *      truth (NEVER falls back to page.status).
 *   5. Null session fails CLOSED for canRead (Enterprise Console is
 *      not a public surface).
 */

import { describe, expect, it } from 'vitest'

import { capabilityStatus, hasPermission } from './capabilities'
import { type ConsolePage, findPage } from './catalog'
import type { CapabilityStatus, Whoami } from './types'
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

const whoamiKbAuthor: Whoami = {
  ...whoamiOperator,
  effective_permissions: ['followup.read', 'biztask.read', 'kb.author'],
}

describe('deriveCommonViewModel · canRead / page status', () => {
  it('super user on a ready page can read', () => {
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    expect(vm.canRead).toBe(true)
    expect(vm.isReady).toBe(true)
    expect(vm.readOnlyReason).toBe(null)
  })

  it('denies canRead when the page requires a permission the viewer lacks', () => {
    const page = findPage('identity') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiOperator })

    // identity requires 'principal.crud'; viewer has only followup.read + biztask.read
    expect(vm.canRead).toBe(false)
    expect(vm.readOnlyReason).toContain('principal.crud')
  })

  it('fails closed on null session (whoami == null → canRead == false)', () => {
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: null })

    expect(vm.canRead).toBe(false)
    expect(vm.readOnlyReason).toBe('session not authenticated')
  })

  it('fails closed on null session even when page has no permission gate', () => {
    // The catalog has at least one page without an explicit permission
    // (placeholder / contract-only). Per W1-A-REMEDIATION-01 §9, the
    // Enterprise Console has no public surface — canRead must still be
    // false on a null session.
    //
    // If no such page exists in the current catalog, this test asserts
    // the rule by passing a synthetic page with permission: undefined.
    const syntheticPage: ConsolePage = {
      controlStatus: 'ready',
      id: 'synthetic-public',
      labelKey: 'test.synthetic',
      status: 'ready',
    }

    const vm = deriveCommonViewModel({ page: syntheticPage, whoami: null })

    expect(vm.canRead).toBe(false)
    expect(vm.readOnlyReason).toBe('session not authenticated')
  })

  it('reports page interface gap as readOnlyReason even when canRead=true', () => {
    // followup has controlStatus: 'missing' (Phase-1 read-only)
    const page = findPage('followup') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    expect(vm.canRead).toBe(true)
    expect(vm.readOnlyReason).toContain('Phase-1')
  })

  it('exposes page interface status fields from the catalog', () => {
    const usagePage = findPage('usage') as ConsolePage
    const auditPage = findPage('audit') as ConsolePage

    expect(
      deriveCommonViewModel({ page: usagePage, whoami: whoamiSuper }).isPartial
    ).toBe(true)

    const auditVm = deriveCommonViewModel({ page: auditPage, whoami: whoamiSuper })
    expect(auditVm.isBlocked).toBe(false)
    expect(auditVm.canRead).toBe(true)
  })
})

describe('deriveCommonViewModel · does NOT declare generic write authority', () => {
  it('CommonViewModelFields does NOT contain canWrite / canControl / canMutate', () => {
    // Per W1-A-REMEDIATION-01 §7 + §8: shared layer cannot know if a
    // user's read permission also implies write. Per-action write truth
    // is the per-page Controller / per-action ViewModel's job.
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    const vmKeys = Object.keys(vm).sort()
    expect(vmKeys).not.toContain('canWrite')
    expect(vmKeys).not.toContain('canControl')
    expect(vmKeys).not.toContain('canMutate')
    expect(vmKeys).not.toContain('writeAllowed')
  })

  it('Task read ≠ Task write — viewer with only biztask.read does NOT get a write verdict', () => {
    // Per W1-A-REMEDIATION-01 §7: a user with biztask.read must NOT
    // obtain a generic canWrite=true just because controlStatus is ready.
    const page = findPage('tasks') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiOperator })

    // canRead IS true (biztask.read is held), but the VM does not
    // expose any write verdict. Per-action truth (canCreate, canRetry,
    // canEscalate, canClose) must be derived in the per-page Controller.
    expect(vm.canRead).toBe(true)
    expect('canWrite' in vm).toBe(false)
    expect('canCreate' in vm).toBe(false)
    expect('canRetry' in vm).toBe(false)
    expect('canEscalate' in vm).toBe(false)
  })
})

describe('deriveCommonViewModel · capabilityStatus is server-only', () => {
  it('page.status === ready but no server capability → capabilityStatus is null (no fallback)', () => {
    // dashboard page.status='ready'. Without `capabilityName`, no
    // server lookup happens; capabilityStatus stays null.
    const page = findPage('dashboard') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

    expect(vm.capabilityStatus).toBe(null)
    expect(vm.isReady).toBe(true)
  })

  it('page.status === ready-dev with server capability → server wins', () => {
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

    // capabilityStatus comes from server's product_capabilities
    expect(vm.capabilityStatus).toBe('LIVE')
    // page interface status is preserved separately
    expect(vm.isReadyDev).toBe(true)
  })

  it('server capability CONTRACT wins even when page.status === ready', () => {
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

    expect(vm.capabilityStatus).toBe('CONTRACT')
    expect(vm.isReady).toBe(true)
  })

  it('null whoami + capabilityName requested → capabilityStatus null (no client-side fabrication)', () => {
    const page = findPage('knowledge') as ConsolePage

    const vm = deriveCommonViewModel({
      page,
      whoami: null,
      capabilityName: 'knowledge_rag',
    })

    expect(vm.capabilityStatus).toBe(null)
  })
})

describe('deriveCommonViewModel · hasPermission parity (no duplicate wildcard)', () => {
  it('super user with "*" matches any permission (parity with hasPermission)', () => {
    const page = findPage('identity') as ConsolePage
    const vm = deriveCommonViewModel({ page, whoami: whoamiSuper })

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

describe('deriveCommonViewModel · capabilityStatus helper parity', () => {
  // The shared layer delegates to capabilities.ts::capabilityStatus
  // rather than reimplementing the product_capabilities lookup. This
  // suite proves parity: the VM's `capabilityStatus` field is the
  // helper's return value, never anything else.
  const cases: Array<{
    label: string
    whoami: null | Whoami
    capability: string
    expected: CapabilityStatus | null
  }> = [
    { label: 'super user, capability missing', whoami: whoamiSuper, capability: 'nope', expected: null },
    { label: 'null whoami, any capability', whoami: null, capability: 'anything', expected: null },
    { label: 'super user, server CONTRACT', whoami: { ...whoamiSuper, product_capabilities: { foo: { enabled: true, status: 'CONTRACT' } } }, capability: 'foo', expected: 'CONTRACT' },
  ]

  for (const c of cases) {
    it(`VM matches capabilityStatus() for: ${c.label}`, () => {
      const page = findPage('dashboard') as ConsolePage

      const vm = deriveCommonViewModel({
        page,
        whoami: c.whoami,
        capabilityName: c.capability,
      })

      expect(vm.capabilityStatus).toBe(capabilityStatus(c.whoami, c.capability))
      expect(vm.capabilityStatus).toBe(c.expected)
    })
  }
})