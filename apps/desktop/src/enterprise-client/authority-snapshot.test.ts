import { describe, expect, it } from 'vitest'

import { currentAuthoritySnapshot } from './authority-snapshot'

describe('currentAuthoritySnapshot', () => {
  it('renders a server projection only after a successful authority probe', () => {
    const snapshot = { tenantId: 'tenant-a' }

    expect(currentAuthoritySnapshot(snapshot, 'ready')).toBe(snapshot)
  })

  it.each(['error', 'loading', 'unavailable'] as const)(
    'does not present a retained snapshot while the authority is %s',
    connectionState => {
      expect(currentAuthoritySnapshot({ tenantId: 'tenant-a' }, connectionState)).toBeNull()
    }
  )
})
