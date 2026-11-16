import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GovernancePage } from './governance-page'
import type { EnterpriseClientRuntime } from './runtime'
import { TenantMembersPanel } from './tenant-members-panel'

describe('GovernancePage', () => {
  it('discards an older reset readback that arrives after a newer status readback', async () => {
    let finishOld!: (value: unknown) => void
    const oldReadback = new Promise<unknown>(resolve => {finishOld = resolve})
    const identity = {name:'管理员', principal_id:'admin', role:'tenant_admin', tenant_id:'tenant-a'} as const
    const member = (status: string) => ({principals:[{principal_id:'seat', name:'员工甲', login_name:'seat-a', role:'operator', status}]})
    let rosterReads = 0

    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {return identity}

      if (path === '/api/principals') { rosterReads++;

 return rosterReads === 2 ? oldReadback : member(rosterReads === 1 ? 'active' : 'disabled') }

      throw new Error('unexpected')
    })

    const post = vi.fn(async (path: string) => path === '/api/principals-status' ? {principal:{principal_id:'seat',status:'disabled'}} : {principal:{principal_id:'seat',must_change_password:true}})
    const runtime = {get, post, disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<TenantMembersPanel identity={identity} runtime={runtime} />)
    let row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name:/重置密码|Reset password/}))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/密码|Password/), {target:{value:'123456'}})
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name:/确定|Confirm/}))
    await waitFor(() => expect(rosterReads).toBe(2))
    row = screen.getByText('seat-a').closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name:/停用|Disable/}))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name:/确定|Confirm/}))
    await waitFor(() => expect(rosterReads).toBe(3))
    expect(await within(screen.getByText('seat-a').closest('tr')!).findByRole('button', {name:/启用|Enable/})).toBeTruthy()
    await act(async () => {finishOld(member('active')); await oldReadback})
    expect(within(screen.getByText('seat-a').closest('tr')!).getByRole('button', {name:/启用|Enable/})).toBeTruthy()
    expect(post).toHaveBeenCalledTimes(2)
  })
  it('hides stale status while readback is pending or failed and allows retry', async () => {
    let failReadback!: (reason: Error) => void
    const readback = new Promise<unknown>((_, reject) => {failReadback = reject})
    const identity = {name:'管理员', principal_id:'admin', role:'tenant_admin', tenant_id:'tenant-a'} as const
    let rosterReads = 0

    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {return identity}

      if (path === '/api/principals') {
        rosterReads++

        if (rosterReads === 2) {return readback}

        return {principals:[{principal_id:'seat', name:'员工甲', login_name:'seat-a', role:'operator', status:rosterReads === 1 ? 'active' : 'disabled'}]}
      }

      throw new Error('unexpected')
    })

    const runtime = {get, post: vi.fn(async () => ({principal:{principal_id:'seat',status:'disabled'}})), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<TenantMembersPanel identity={identity} runtime={runtime} />)
    const row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name:/停用|Disable/}))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name:/确定|Confirm/}))
    await waitFor(() => expect(rosterReads).toBe(2))
    expect(screen.queryByText('seat-a')).toBeNull()
    await act(async () => {failReadback(new Error('readback failed')); await readback.catch(() => undefined)})
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('seat-a')).toBeNull()
    fireEvent.click(screen.getByRole('button', {name:'刷新员工列表'}))
    const refreshed = (await screen.findByText('seat-a')).closest('tr')!
    expect(within(refreshed).getByRole('button', {name:/启用|Enable/})).toBeTruthy()
    expect(runtime.post).toHaveBeenCalledTimes(1)
  })
  it('clears credentials, drafts and delete confirmation on a tenant switch', async () => {
    const get = vi.fn(async () => ({principals: [{principal_id:'seat', name:'员工甲', login_name:'seat-a', role:'operator', status:'active'}]}))
    const runtime = {get, post: vi.fn(async () => ({login_name:'created-a', temporary_password:'synthetic-temp-123'})), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const identity = {name:'管理员', principal_id:'admin-a', role:'tenant_admin', tenant_id:'tenant-a'} as const
    const {rerender} = render(<TenantMembersPanel identity={identity} runtime={runtime} />)
    await screen.findByText('seat-a')
    fireEvent.change(screen.getByLabelText('员工姓名'), {target:{value:'员工甲'}})
    fireEvent.change(screen.getByLabelText('员工登录账号'), {target:{value:'created-a'}})
    fireEvent.click(screen.getByRole('button', {name:'开通员工账号'}))
    expect(await screen.findByText(/synthetic-temp-123/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('员工姓名'), {target:{value:'旧租户草稿'}})
    fireEvent.click(screen.getByRole('button', {name:'删除账号'}))
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<TenantMembersPanel identity={{...identity, principal_id:'admin-b', tenant_id:'tenant-b'}} runtime={runtime} />)
    expect(screen.queryByText(/synthetic-temp-123/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByLabelText('员工姓名') as HTMLInputElement).value).toBe('')
  })
  it('keeps provisioning disabled across tenant switches until the old request settles', async () => {
    let finish!: (value: unknown) => void
    const pending = new Promise<unknown>(resolve => {finish = resolve})
    const runtime = {get: vi.fn(async () => ({principals: []})), post: vi.fn(() => pending), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const identity = {name:'管理员', principal_id:'admin-a', role:'tenant_admin', tenant_id:'tenant-a'} as const
    const {rerender} = render(<TenantMembersPanel identity={identity} runtime={runtime} />)
    fireEvent.change(screen.getByLabelText('员工姓名'), {target:{value:'员工甲'}})
    fireEvent.change(screen.getByLabelText('员工登录账号'), {target:{value:'created-a'}})
    fireEvent.click(screen.getByRole('button', {name:'开通员工账号'}))
    expect(runtime.post).toHaveBeenCalledTimes(1)
    rerender(<TenantMembersPanel identity={{...identity, principal_id:'admin-b', tenant_id:'tenant-b'}} runtime={runtime} />)
    expect((screen.getByRole('button', {name:'正在处理…'}) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {finish({login_name:'created-a', temporary_password:'synthetic-temp-123'}); await pending; await new Promise(resolve=>setTimeout(resolve,0))})
    expect(screen.queryByText(/synthetic-temp-123/)).toBeNull()
    expect((screen.getByRole('button', {name:'开通员工账号'}) as HTMLButtonElement).disabled).toBe(false)
  })
  it('removes employee action dialogs when the current role loses administrative authority', async () => {
    const runtime = {get: vi.fn(async () => ({principals: [{principal_id:'seat', name:'员工甲', login_name:'seat-a', role:'operator', status:'active'}]})), post: vi.fn(), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const identity = {name:'管理员', principal_id:'admin', role:'tenant_admin', tenant_id:'tenant-a'} as const
    const {rerender} = render(<TenantMembersPanel identity={identity} runtime={runtime} />)
    const row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name:/重置密码|Reset password/}))
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<TenantMembersPanel identity={{...identity, role:'operator'}} runtime={runtime} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', {name:/重置密码|Reset password/})).toBeNull()
    expect(runtime.post).not.toHaveBeenCalled()
  })
  it('ignores a late roster failure after the tenant and runtime change', async () => {
    let failOld!: (reason: Error) => void
    const oldList = new Promise<unknown>((_, reject) => { failOld = reject })
    const oldRuntime = {get: vi.fn(() => oldList), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const newRuntime = {get: vi.fn(async () => ({principals: [{principal_id:'seat-b', name:'新租户员工', login_name:'seat-b', role:'operator', status:'active'}]})), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const identity = {name:'管理员', principal_id:'admin-a', role:'tenant_admin', tenant_id:'tenant-a'} as const
    const {rerender} = render(<TenantMembersPanel identity={identity} runtime={oldRuntime} />)
    await waitFor(() => expect(oldRuntime.get).toHaveBeenCalledWith('/api/principals'))
    rerender(<TenantMembersPanel identity={{...identity, principal_id:'admin-b', tenant_id:'tenant-b'}} runtime={newRuntime} />)
    expect(await screen.findByText('seat-b')).toBeTruthy()
    await act(async () => {failOld(new Error('旧租户失败')); await oldList.catch(() => undefined)})
    expect(screen.queryByText('旧租户失败')).toBeNull()
    expect(screen.getByText('seat-b')).toBeTruthy()
  })
  it('offers employee reset and status controls without a shop capability or shop profiles', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/whoami') {return { name: '管理员', principal_id: 'admin', role: 'tenant_admin', tenant_id: 'tenant-1', product_capabilities: {} }}

      if (path === '/api/principals') {return { principals: [{ principal_id: 'seat', name: '员工甲', login_name: 'seat-a', role: 'operator', status: 'active' }] }}
      throw new Error('unavailable')
    })

    const runtime = { get, post: vi.fn(), disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<GovernancePage runtime={runtime} />)
    const row = (await screen.findByText('seat-a')).closest('tr')!
    expect(within(row).getByRole('button', { name: /重置密码|Reset password/ })).toBeTruthy()
    expect(within(row).getByRole('button', { name: /停用|Disable/ })).toBeTruthy()
    expect(get).not.toHaveBeenCalledWith('/api/shop-login-profiles')
  })
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
