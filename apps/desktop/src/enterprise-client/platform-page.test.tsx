import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PlatformPage } from './platform-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('PlatformPage', () => {
  it('shows authoritative seat use, unknown counts, filtering and a refreshed capacity', async () => {
    let occupied = 24
    const get = vi.fn(async (path: string) => path === '/api/platform-activity' ? { events: [] } : ({ tenants: [
      { name: '早鸟科技', tenant_id: 'early', status: 'active', active_operator_count: occupied, operator_seat_limit: 40 },
      { name: '空企业', tenant_id: 'empty', status: 'paused', active_operator_count: 0, operator_seat_limit: 10 },
      { name: '旧接口企业', tenant_id: 'legacy', status: 'active', operator_seat_limit: 10 }
    ] }))
    const runtime = { get, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<PlatformPage runtime={runtime} />)
    expect(await screen.findByText('24 / 40')).toBeTruthy()
    expect(screen.getByText('0 / 10')).toBeTruthy()
    expect(screen.getByText('统计不可用 / 10')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByText('16')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜索企业'), { target: { value: 'early' } })
    expect(within(table).queryByText('空企业')).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索企业'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('企业状态'), { target: { value: 'paused' } })
    expect(within(table).queryByText('早鸟科技')).toBeNull()
    fireEvent.change(screen.getByLabelText('企业状态'), { target: { value: 'all' } })
    occupied = 25
    fireEvent.click(screen.getByRole('button', { name: '刷新企业统计' }))
    expect(await screen.findByText('25 / 40')).toBeTruthy()
    get.mockRejectedValueOnce(new Error('服务暂不可用'))
    fireEvent.click(screen.getByRole('button', { name: '刷新企业统计' }))
    expect(await screen.findByText('服务暂不可用')).toBeTruthy()
    expect(screen.getByText('读取失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(screen.queryByText('读取失败')).toBeNull())
  })

  it('uses only the super-admin tenant endpoint and creates a tenant through the fenced runtime', async () => {
    const get = vi.fn(async <T,>(path: string) => (
      (path === '/api/platform-activity' ? { events: [] } : { tenants: [{ name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }] }) as T
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
    const get = vi.fn(async <T,>(path: string) => (
      (path === '/api/platform-activity' ? { events: [] } : { tenants: [{ name: '早鸟科技', status: 'active', tenant_id: 'tenant-earlybird' }] }) as T
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
