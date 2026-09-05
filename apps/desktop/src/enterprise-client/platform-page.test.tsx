import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PlatformPage } from './platform-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('PlatformPage', () => {
  it('uses only the super-admin tenant endpoint and creates a tenant through the fenced runtime', async () => {
    const get = vi.fn(async <T,>() => (
      { tenants: [{ name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }] } as T
    ))

    const post = vi.fn(async <T,>() => (
      { name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' } as T
    ))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PlatformPage runtime={runtime} />)

    expect(await screen.findAllByText('早鸟科技')).toHaveLength(2)
    expect(get).toHaveBeenCalledWith('/api/tenants')
    expect(get.mock.calls.flat()).not.toContain('/api/audit-list')
    expect(get.mock.calls.flat()).not.toContain('/api/conversations-inbound')

    fireEvent.change(screen.getByLabelText('企业名称'), { target: { value: '星云科技' } })
    fireEvent.click(screen.getByRole('button', { name: '开通企业' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenants', { name: '星云科技' }))
  })

  it('appoints a first tenant administrator without treating it as a completed login', async () => {
    const get = vi.fn(async <T,>() => (
      { tenants: [{ name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }] } as T
    ))

    const post = vi.fn(async <T,>(path: string) => (
      (path === '/api/principals'
        ? {
            name: '林乔',
            onboarding_state: 'awaiting_federated_identity_binding',
            principal_id: 'principal-admin-1',
            tenant_id: 'tenant-earlybird'
          }
        : { name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }) as T
    ))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PlatformPage runtime={runtime} />)
    await screen.findAllByText('早鸟科技')

    fireEvent.change(screen.getByLabelText('目标企业'), { target: { value: 'tenant-earlybird' } })
    fireEvent.change(screen.getByLabelText('企业管理员姓名'), { target: { value: '林乔' } })
    fireEvent.click(screen.getByRole('button', { name: '任命企业管理员' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/principals', {
      name: '林乔',
      role: 'tenant_admin',
      tenant_id: 'tenant-earlybird'
    }))
    expect(await screen.findByText(/完成前不能登录客户端/)).toBeTruthy()
  })
})
