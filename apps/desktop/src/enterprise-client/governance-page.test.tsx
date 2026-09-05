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
              event_id: '1ad15d1f-b0c7-4b72-8c90-e81565bc9dd1',
              resource_ref: 'binding-1',
              ts: '2026-09-01T10:00:00Z'
            }
          ]
        }
      }

      if (path === '/api/tenant-ai-config') {
        return {
          configured: false,
          encryption_ready: true,
          models: [],
          providers: [{ default_model: 'deepseek-chat', key: 'deepseek', label: 'DeepSeek' }]
        }
      }

      if (path === '/api/audit-detail?event_id=1ad15d1f-b0c7-4b72-8c90-e81565bc9dd1') {
        return {
          event: {
            action: 'binding.revoked',
            event_id: '1ad15d1f-b0c7-4b72-8c90-e81565bc9dd1',
            payload_ref: { reason: 'operator_request' },
            resource_ref: 'binding-1'
          }
        }
      }

      if (path === '/api/audit-correlate?resource_ref=binding-1') {
        return { events: [{ action: 'binding.created', event_id: 'event-0' }] }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<GovernancePage runtime={runtime} />)

    expect(await screen.findByText('管理员')).toBeTruthy()
    expect(await screen.findByText('企业管理员')).toBeTruthy()
    expect(await screen.findByText('binding.revoked')).toBeTruthy()
    expect(await screen.findByText('binding.created')).toBeTruthy()
    expect(screen.getByText('已启用')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/whoami')
    expect(get).toHaveBeenCalledWith('/api/audit-list')
    expect(get).toHaveBeenCalledWith('/api/tenant-ai-config')
    expect(get).toHaveBeenCalledWith('/api/audit-detail?event_id=1ad15d1f-b0c7-4b72-8c90-e81565bc9dd1')
    expect(get).toHaveBeenCalledWith('/api/audit-correlate?resource_ref=binding-1')
  })
})
