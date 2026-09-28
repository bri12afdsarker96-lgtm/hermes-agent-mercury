import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GovernancePage } from './governance-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('GovernancePage', () => {
  it('keeps platform diagnostics and audit evidence out of the tenant-admin page', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {
        return {name: '管理员', principal_id: 'p-1', role: 'tenant_admin', tenant_id: 'tenant-1'}
      }
      throw new Error(`unexpected path: ${path}`)
    })
    const runtime: EnterpriseClientRuntime = {disconnect: vi.fn(async () => undefined), get: get as unknown as EnterpriseClientRuntime['get']}

    render(<GovernancePage runtime={runtime} />)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/whoami'))

    for (const title of ['租户能力策略', '当前授权主体', '能力状态', '审计证据', '证据详情', '同资源证据链']) {
      expect(screen.queryByText(title)).toBeNull()
    }
    expect(get).not.toHaveBeenCalledWith('/api/audit-list')
    expect(get).not.toHaveBeenCalledWith('/api/tenant-capability-policy')
  })

  it('retains service-policy and audit diagnostics for a platform administrator', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {
        return {
          name: '平台管理员', principal_id: 'p-platform', role: 'super_admin', tenant_id: '',
          product_capabilities: {audit: {enabled: true, status: 'LIVE'}}
        }
      }
      if (path === '/api/audit-list') {
        return {events: [{action: 'binding.revoked', actor: 'p-platform', event_id: 'audit-1', resource_ref: 'binding-1', ts: '2026-09-01T10:00:00Z'}]}
      }
      if (path === '/api/audit-detail?event_id=audit-1') {
        return {event: {event_id: 'audit-1', resource_ref: 'binding-1'}}
      }
      if (path === '/api/audit-correlate?resource_ref=binding-1') {
        return {events: [{action: 'binding.created', event_id: 'audit-0'}]}
      }
      if (path === '/api/tenant-capability-policy') {
        return {capabilities: {}}
      }
      throw new Error(`unexpected path: ${path}`)
    })
    const runtime: EnterpriseClientRuntime = {disconnect: vi.fn(async () => undefined), get: get as unknown as EnterpriseClientRuntime['get']}

    render(<GovernancePage runtime={runtime} />)

    expect(await screen.findByText('审计证据')).toBeTruthy()
    expect(screen.getByText('当前授权主体')).toBeTruthy()
    expect(screen.getByText('能力状态')).toBeTruthy()
    expect(await screen.findByText('同资源证据链')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/audit-list')
  })
})
