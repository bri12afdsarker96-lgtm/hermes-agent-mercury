import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GovernancePage } from './governance-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('GovernancePage', () => {
  it('uses identity and audit read contracts without client-side authorization decisions', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {
        return {
          name: '管理员',
          principal_id: 'p-1',
          role: 'tenant_admin',
          tenant_id: 'tenant-1',
          product_capabilities: { audit: { enabled: true, status: 'LIVE' } }
        }
      }

      if (path === '/api/audit-list') {
        return {
          events: [
            {
              action: 'binding.revoked',
              actor: 'p-1',
              event_id: 'event-1',
              resource_ref: 'binding-1',
              ts: '2026-09-01T10:00:00Z'
            }
          ]
        }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<GovernancePage runtime={runtime} />)

    expect(await screen.findByText('管理员')).toBeTruthy()
    expect(await screen.findByText('binding.revoked')).toBeTruthy()
    expect(screen.getByText('已启用')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/whoami')
    expect(get).toHaveBeenCalledWith('/api/audit-list')
  })
})
