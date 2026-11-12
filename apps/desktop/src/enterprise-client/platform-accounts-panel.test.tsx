import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PlatformAccountsPanel } from './platform-accounts-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('PlatformAccountsPanel', () => {
  it('requires confirmation, sends a tenant-scoped reset and preserves credentials if the audit read fails', async () => {
    let failActivity = false
    const get = vi.fn(async (path: string) => {
      if (path === '/api/platform-activity') {
        if (failActivity) { throw new Error('audit unavailable') }
        return { events: [] }
      }
      return { principals: [{ principal_id: 'admin-a', name: '管理员', login_name: 'a.admin' }] }
    })
    const post = vi.fn(async () => {
      failActivity = true
      return { principal_id: 'admin-a', login_name: 'a.admin', temporary_password: 'test-once-password' }
    })
    const runtime = { get, post, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<PlatformAccountsPanel runtime={runtime} tenants={[{ tenant_id: 'a', name: '企业 A' }]} />)
    fireEvent.change(screen.getByLabelText('管理企业'), { target: { value: 'a' } })
    fireEvent.click(await screen.findByRole('button', { name: '重置密码' }))
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重置密码' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/platform-administrator-reset', { tenant_id: 'a', principal_id: 'admin-a', confirmed: true }))
    expect(await screen.findByText('初始密码：test-once-password')).toBeTruthy()
    expect(await screen.findByText('密码已重置，操作记录暂时无法刷新。请先保存一次性密码。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已安全保存，隐藏凭据' }))
    expect(screen.queryByText('初始密码：test-once-password')).toBeNull()
  })

  it('discards administrator results from a previously selected tenant', async () => {
    let resolveOld!: (value: unknown) => void
    const get = vi.fn((path: string) => {
      if (path === '/api/platform-activity') { return Promise.resolve({ events: [] }) }
      if (path.endsWith('=a')) { return new Promise(resolve => { resolveOld = resolve }) }
      return Promise.resolve({ principals: [{ principal_id: 'b', login_name: 'b.admin' }] })
    })
    const runtime = { get, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<PlatformAccountsPanel runtime={runtime} tenants={[{ tenant_id: 'a', name: 'A' }, { tenant_id: 'b', name: 'B' }]} />)
    fireEvent.change(screen.getByLabelText('管理企业'), { target: { value: 'a' } })
    fireEvent.change(screen.getByLabelText('管理企业'), { target: { value: 'b' } })
    expect(await screen.findByText('b.admin')).toBeTruthy()
    resolveOld({ principals: [{ principal_id: 'a', login_name: 'a.admin' }] })
    await waitFor(() => expect(screen.queryByText('a.admin')).toBeNull())
  })
})
