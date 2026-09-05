import { describe, expect, it } from 'vitest'

import { capabilityEnabled, capabilityStatus, hasPermission, isSuperAdmin } from './capabilities'
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

describe('hasPermission', () => {
  it('matches exact, superuser, and dotted-prefix grants', () => {
    expect(hasPermission(who({ effective_permissions: ['metrics.view'] }), 'metrics.view')).toBe(true)
    expect(hasPermission(who({ effective_permissions: ['*'] }), 'anything')).toBe(true)
    expect(hasPermission(who({ effective_permissions: ['kb.*'] }), 'kb.commit')).toBe(true)
    expect(hasPermission(who({ effective_permissions: ['kb.*'] }), 'biztask.read')).toBe(false)
  })

  it('falls back to perms_effective and denies on null session', () => {
    expect(hasPermission(who({ perms_effective: ['reminder.read'] }), 'reminder.read')).toBe(true)
    expect(hasPermission(null, 'metrics.view')).toBe(false)
  })
})

describe('capability truth', () => {
  const session = who({
    product_capabilities: {
      biz_tasks: { enabled: true, status: 'LIVE' },
      knowledge_rag: { enabled: false, status: 'DEV' }
    }
  })

  it('reports the server status verbatim', () => {
    expect(capabilityStatus(session, 'knowledge_rag')).toBe('DEV')
    expect(capabilityStatus(session, 'biz_tasks')).toBe('LIVE')
    expect(capabilityStatus(session, 'unknown')).toBeNull()
  })

  it('never treats a DEV capability as enabled', () => {
    expect(capabilityEnabled(session, 'knowledge_rag')).toBe(false)
    expect(capabilityEnabled(session, 'biz_tasks')).toBe(true)
  })
})

describe('isSuperAdmin', () => {
  it('reflects the server role', () => {
    expect(isSuperAdmin(who({ role: 'super_admin' }))).toBe(true)
    expect(isSuperAdmin(who({ role: 'tenant_admin' }))).toBe(false)
  })
})
