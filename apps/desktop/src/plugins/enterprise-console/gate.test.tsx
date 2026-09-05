import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CapabilityGate, PermissionGate } from './gate'
import { $whoami } from './session'
import type { Whoami } from './types'

function who(partial: Partial<Whoami>): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    name: 'alice',
    principal_id: 'p1',
    product_capabilities: {},
    role: 'tenant_admin',
    tenant_id: 't1',
    ...partial
  }
}

afterEach(() => {
  cleanup()
  $whoami.set(null)
})

describe('PermissionGate', () => {
  it('renders children only when the session carries the permission', () => {
    $whoami.set(who({ effective_permissions: ['metrics.view'] }))

    render(
      <PermissionGate permission="metrics.view">
        <span>allowed</span>
      </PermissionGate>
    )
    expect(screen.queryByText('allowed')).not.toBeNull()
  })

  it('renders the fallback when the permission is absent', () => {
    $whoami.set(who({ effective_permissions: ['metrics.view'] }))

    render(
      <PermissionGate fallback={<span>denied</span>} permission="provider.set">
        <span>allowed</span>
      </PermissionGate>
    )
    expect(screen.queryByText('allowed')).toBeNull()
    expect(screen.queryByText('denied')).not.toBeNull()
  })
})

describe('CapabilityGate', () => {
  const session = who({
    product_capabilities: {
      biz_tasks: { enabled: true, status: 'LIVE' },
      knowledge_rag: { enabled: false, status: 'DEV' }
    }
  })

  it('keeps a DEV capability out of the live surface (Capability Truth)', () => {
    $whoami.set(session)

    render(
      <CapabilityGate capability="knowledge_rag" fallback={<span>hidden</span>}>
        <span>live</span>
      </CapabilityGate>
    )
    expect(screen.queryByText('live')).toBeNull()
    expect(screen.queryByText('hidden')).not.toBeNull()
  })

  it('renders children for a LIVE capability', () => {
    $whoami.set(session)

    render(
      <CapabilityGate capability="biz_tasks">
        <span>live</span>
      </CapabilityGate>
    )
    expect(screen.queryByText('live')).not.toBeNull()
  })
})
