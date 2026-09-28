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

    await screen.findAllByText('早鸟科技')
    expect(get).toHaveBeenCalledWith('/api/tenants')
    expect(get.mock.calls.flat()).not.toContain('/api/principals')
    expect(screen.queryByText('平台账号目录')).toBeNull()
    expect(get.mock.calls.flat()).not.toContain('/api/audit-list')
    expect(get.mock.calls.flat()).not.toContain('/api/conversations-inbound')

    fireEvent.change(screen.getByLabelText('企业名称'), { target: { value: '星云科技' } })
    fireEvent.change(screen.getByLabelText('可用坐席上限'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '开通企业并设置容量' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenants', {
      name: '星云科技', operator_seat_limit: '5'
    }))
  })

  it('issues a tenant administrator login and lets the operator hide the one-time password', async () => {
    const get = vi.fn(async <T,>() => (
      { tenants: [{ name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }] } as T
    ))

    const post = vi.fn(async <T,>(path: string) => (
      (path === '/api/principals'
        ? {
            name: '林乔',
            login_name: 'earlybird.admin',
            temporary_password: 'synthetic-test-password',
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
    fireEvent.change(screen.getByLabelText('企业登录账号'), { target: { value: 'earlybird.admin' } })
    fireEvent.click(screen.getByRole('button', { name: '签发企业管理员账号' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/principals', {
      name: '林乔',
      login_name: 'earlybird.admin',
      role: 'tenant_admin',
      tenant_id: 'tenant-earlybird'
    }))
    expect(await screen.findByText('初始密码：synthetic-test-password')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已安全保存，隐藏凭据' }))
    expect(screen.queryByText('初始密码：synthetic-test-password')).toBeNull()
  })
})
