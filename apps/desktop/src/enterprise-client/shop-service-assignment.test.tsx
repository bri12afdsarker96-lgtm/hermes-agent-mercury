import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shopServiceAssignmentCopy } from '@/i18n/shop-service-assignment'
import type { Locale } from '@/i18n/types'

import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'
import { ShopServiceAssignment } from './shop-service-assignment'

const language = vi.hoisted(() => ({ locale: 'zh' as Locale }))
vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: language.locale }) }))

afterEach(() => { cleanup(); language.locale = 'zh' })

const profileId = 'cd3e0ab1-72a6-43db-8ace-dfbbecdf0f20'
const admin: EnterpriseIdentity = { role: 'tenant_admin', tenant_id: 'tenant-a', principal_id: 'admin-a' }
const members = [
  { principal_id: 'creator', name: '创建员工', status: 'inactive', role: 'operator' },
  { principal_id: 'old', name: '原服务员工', status: 'active', role: 'operator' },
  { principal_id: 'new', name: '新服务员工', status: 'active', role: 'operator' },
  { principal_id: 'disabled', name: '停用员工', status: 'disabled', role: 'operator' },
  { principal_id: 'foreign', name: '其他企业员工', status: 'active', role: 'operator', tenant_id: 'tenant-b' }
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture(identity: EnterpriseIdentity = admin) {
  const store = {
    identity,
    record: { profile_id: profileId, revision: 7, deleted: false, updated_at: '2026-11-16T00:00:00Z',
      created_by: 'creator', servicing_principal_id: 'old' }
  }
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === '/api/whoami') { return store.identity }
    if (path === '/api/shop-login-profiles') { return { profiles: [{ ...store.record }] } }
    if (path === '/api/principals') { return { principals: members } }
    throw new Error(`Unexpected metadata request ${path}`)
  })
  const post = vi.fn(async (path: string, body: unknown) => {
    if (path !== '/api/shop-login-profiles-transfer') { throw new Error('Unexpected mutation') }
    const request = body as { principal_id: string }
    store.record = { ...store.record, revision: store.record.revision + 1, servicing_principal_id: request.principal_id }
    return { profile: { ...store.record } }
  })
  const runtime: EnterpriseClientRuntime = {
    get: get as EnterpriseClientRuntime['get'],
    post: post as NonNullable<EnterpriseClientRuntime['post']>,
    disconnect: vi.fn(async () => undefined)
  }
  const onTransferred = vi.fn(async () => undefined)
  return { store, get, post, runtime, onTransferred }
}

async function chooseNewMember() {
  await screen.findByRole('option', { name: '新服务员工' })
  fireEvent.change(screen.getByRole('combobox', { name: '转移给' }), { target: { value: 'new' } })
}

function shownService() {
  return screen.getByText('当前服务员工').nextElementSibling?.textContent
}

describe('ShopServiceAssignment', () => {
  it.each(['operator', 'supervisor', 'super_admin', '', undefined])('hides every entry for role %s after fresh whoami', async role => {
    const test = fixture({ ...admin, role })
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await waitFor(() => expect(test.get).toHaveBeenCalledWith('/api/whoami'))
    await act(async () => undefined)
    expect(view.container.innerHTML).toBe('')
    expect(test.get.mock.calls).toEqual([['/api/whoami']])
    expect(test.post).not.toHaveBeenCalled()
  })

  it('waits for fresh administrator identity before requesting profiles or members', async () => {
    const test = fixture()
    const identity = deferred<EnterpriseIdentity>()
    test.get.mockImplementationOnce(() => identity.promise)
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    expect(view.container.innerHTML).toBe('')
    expect(test.get.mock.calls).toEqual([['/api/whoami']])
    await act(async () => identity.resolve(admin))
    await screen.findByRole('option', { name: '新服务员工' })
    expect(test.get.mock.calls.map(call => call[0])).toEqual([
      '/api/whoami', '/api/shop-login-profiles', '/api/principals'
    ])
    expect(screen.getByText('创建者').nextElementSibling?.textContent).toBe('创建员工')
    expect(shownService()).toBe('原服务员工')
    expect(screen.getByText('店铺档案属于本企业')).toBeTruthy()
    expect(screen.getByText('转移成功后，原服务员工将失去该店铺的查看与操作权限；仅接手员工和企业管理员可查看与操作。')).toBeTruthy()
  })

  it.each([
    { role: 'tenant_admin', principal_id: 'admin-a' },
    { role: 'tenant_admin', tenant_id: 'tenant-a' }
  ])('requires both tenant and principal identity before showing the entry', async identity => {
    const test = fixture(identity)
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await act(async () => undefined)
    expect(view.container.innerHTML).toBe('')
    expect(test.get.mock.calls).toEqual([['/api/whoami']])
  })

  it('keeps the entry hidden when fresh identity cannot be confirmed', async () => {
    const test = fixture()
    test.get.mockRejectedValueOnce(new Error('session expired'))
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await act(async () => undefined)
    expect(view.container.innerHTML).toBe('')
    expect(test.get.mock.calls).toEqual([['/api/whoami']])
    expect(test.post).not.toHaveBeenCalled()
  })

  it('offers active same-tenant members while retaining inactive creator attribution', async () => {
    const test = fixture()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await screen.findByRole('option', { name: '新服务员工' })
    expect(screen.queryByRole('option', { name: '创建员工' })).toBeNull()
    expect(screen.queryByRole('option', { name: '停用员工' })).toBeNull()
    expect(screen.queryByRole('option', { name: '其他企业员工' })).toBeNull()
    expect(screen.getByRole('button', { name: '转移服务店铺' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old' } })
    expect(screen.getByRole('button', { name: '转移服务店铺' }).hasAttribute('disabled')).toBe(true)
  })

  it('posts the exact ID and fresh revision, refreshes metadata and invokes the parent callback', async () => {
    const test = fixture()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    await screen.findByText('服务店铺已转移。')
    expect(test.post.mock.calls).toEqual([['/api/shop-login-profiles-transfer', {
      profile_id: profileId, principal_id: 'new', expected_revision: 7
    }]])
    expect(test.get.mock.calls.filter(([path]) => path === '/api/shop-login-profiles')).toHaveLength(2)
    expect(test.get.mock.calls.filter(([path]) => path === '/api/principals')).toHaveLength(2)
    expect(test.onTransferred).toHaveBeenCalledTimes(1)
    expect(shownService()).toBe('新服务员工')
    expect(screen.getByText('创建者').nextElementSibling?.textContent).toBe('创建员工')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
  })

  it('uses the refreshed revision for the next transfer and keeps the original creator', async () => {
    const test = fixture()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    await screen.findByText('服务店铺已转移。')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old' } })
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    await waitFor(() => expect(test.onTransferred).toHaveBeenCalledTimes(2))
    expect(test.post.mock.calls[1]).toEqual(['/api/shop-login-profiles-transfer', {
      profile_id: profileId, principal_id: 'old', expected_revision: 8
    }])
    expect(shownService()).toBe('原服务员工')
    expect(screen.getByText('创建者').nextElementSibling?.textContent).toBe('创建员工')
  })

  it('keeps the current service member until authoritative metadata refresh finishes', async () => {
    const test = fixture()
    const refreshed = deferred<unknown>()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    test.get.mockImplementationOnce(() => refreshed.promise)
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    await waitFor(() => expect(test.post).toHaveBeenCalledTimes(1))
    expect(shownService()).toBe('原服务员工')
    expect(test.onTransferred).not.toHaveBeenCalled()
    await act(async () => refreshed.resolve({ profiles: [{ ...test.store.record }] }))
    await screen.findByText('服务店铺已转移。')
    expect(shownService()).toBe('新服务员工')
  })

  it('reports an unconfirmed transfer while retaining the preceding service member and selection', async () => {
    const test = fixture()
    test.post.mockRejectedValueOnce(new Error('revision conflict'))
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('转移结果未确认，请重新加载档案核对服务员工。')
    expect(alert.textContent).toContain('未确认')
    expect(shownService()).toBe('原服务员工')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('new')
    expect(test.onTransferred).not.toHaveBeenCalled()
    expect(screen.queryByText('服务店铺已转移。')).toBeNull()
  })

  it('reloads authoritative ownership after the server commits but the transfer response is lost', async () => {
    const test = fixture()
    test.post.mockImplementationOnce(async () => {
      test.store.record = { ...test.store.record, revision: 8, servicing_principal_id: 'new' }
      throw new Error('response lost after commit')
    })
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    expect((await screen.findByRole('alert')).textContent).toContain('未确认')
    expect(shownService()).toBe('原服务员工')
    expect(screen.queryByText('服务店铺已转移。')).toBeNull()
    expect(test.onTransferred).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(shownService()).toBe('新服务员工'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(test.post).toHaveBeenCalledTimes(1)
  })

  it('preserves displayed metadata and reports a committed transfer whose refresh failed', async () => {
    const test = fixture()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    test.get.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    expect((await screen.findByRole('alert')).textContent).toBe(shopServiceAssignmentCopy.zh.refreshFailed)
    expect(shownService()).toBe('原服务员工')
    expect(test.onTransferred).not.toHaveBeenCalled()
    expect(screen.queryByText('服务店铺已转移。')).toBeNull()
  })

  it('keeps the current record when a transfer returns a different profile', async () => {
    const test = fixture()
    test.post.mockResolvedValueOnce({ profile: {
      ...test.store.record, profile_id: 'different-profile', revision: 8, servicing_principal_id: 'new'
    } })
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    expect((await screen.findByRole('alert')).textContent).toBe(shopServiceAssignmentCopy.zh.refreshFailed)
    expect(shownService()).toBe('原服务员工')
    expect(test.onTransferred).not.toHaveBeenCalled()
  })

  it('rejects a refreshed list older than the accepted transfer revision', async () => {
    const test = fixture()
    const precedingRecord = { ...test.store.record }
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    test.get.mockResolvedValueOnce({ profiles: [precedingRecord] })
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    expect((await screen.findByRole('alert')).textContent).toBe(shopServiceAssignmentCopy.zh.refreshFailed)
    expect(shownService()).toBe('原服务员工')
    expect(test.onTransferred).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(shownService()).toBe('新服务员工'))
    expect(test.get.mock.calls.filter(([path]) => path === '/api/whoami')).toHaveLength(2)
  })

  it('blocks duplicate submissions while a transfer is pending', async () => {
    const test = fixture()
    const pending = deferred<{ profile: typeof test.store.record }>()
    test.post.mockReturnValueOnce(pending.promise)
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    fireEvent.click(screen.getByRole('button', { name: '正在转移' }))
    expect(test.post).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => pending.resolve({ profile: { ...test.store.record, revision: 8, servicing_principal_id: 'new' } }))
    expect(test.onTransferred).not.toHaveBeenCalled()
  })

  it('clears the old tenant immediately and ignores its delayed roster', async () => {
    const first = fixture()
    const oldRoster = deferred<unknown>()
    first.get.mockImplementation(async path => {
      if (path === '/api/whoami') { return admin }
      if (path === '/api/shop-login-profiles') { return { profiles: [{ ...first.store.record }] } }
      return oldRoster.promise
    })
    const second = fixture({ ...admin, role: 'supervisor', tenant_id: 'tenant-b' })
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={first.runtime} onTransferred={first.onTransferred} />)
    await waitFor(() => expect(first.get).toHaveBeenCalledWith('/api/principals'))
    view.rerender(<ShopServiceAssignment profileId={profileId} runtime={second.runtime} onTransferred={second.onTransferred} />)
    expect(view.container.innerHTML).toBe('')
    await act(async () => oldRoster.resolve({ principals: members }))
    expect(view.container.innerHTML).toBe('')
    expect(second.get.mock.calls).toEqual([['/api/whoami']])
  })

  it('discards a delayed old identity before it can read tenant metadata', async () => {
    const first = fixture()
    const oldIdentity = deferred<EnterpriseIdentity>()
    first.get.mockImplementationOnce(() => oldIdentity.promise)
    const second = fixture({ ...admin, role: 'operator', tenant_id: 'tenant-b' })
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={first.runtime} onTransferred={first.onTransferred} />)
    view.rerender(<ShopServiceAssignment profileId={profileId} runtime={second.runtime} onTransferred={second.onTransferred} />)
    await act(async () => oldIdentity.resolve(admin))
    expect(first.get.mock.calls).toEqual([['/api/whoami']])
    expect(view.container.innerHTML).toBe('')
  })

  it('ignores a previous runtime transfer response after switching to an unauthorized tenant', async () => {
    const first = fixture()
    const pending = deferred<{ profile: typeof first.store.record }>()
    first.post.mockReturnValueOnce(pending.promise)
    const second = fixture({ ...admin, tenant_id: 'tenant-b', principal_id: 'operator-b', role: 'operator' })
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={first.runtime} onTransferred={first.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    view.rerender(<ShopServiceAssignment profileId={profileId} runtime={second.runtime} onTransferred={second.onTransferred} />)
    await act(async () => pending.resolve({ profile: {
      ...first.store.record, revision: 8, servicing_principal_id: 'new'
    } }))
    expect(view.container.innerHTML).toBe('')
    expect(first.get.mock.calls).toHaveLength(3)
    expect(second.get.mock.calls).toEqual([['/api/whoami']])
    expect(first.onTransferred).not.toHaveBeenCalled()
    expect(second.onTransferred).not.toHaveBeenCalled()
    expect(second.post).not.toHaveBeenCalled()
  })

  it('keeps a new administrator tenant roster when the previous tenant list arrives late', async () => {
    const first = fixture()
    const oldList = deferred<unknown>()
    first.get.mockImplementation(async path => {
      if (path === '/api/whoami') { return admin }
      if (path === '/api/shop-login-profiles') { return oldList.promise }
      return { principals: members }
    })
    const second = fixture({ ...admin, tenant_id: 'tenant-b', principal_id: 'admin-b' })
    second.get.mockImplementation(async path => {
      if (path === '/api/whoami') { return second.store.identity }
      if (path === '/api/shop-login-profiles') { return { profiles: [{ ...second.store.record }] } }
      return { principals: [
        { principal_id: 'old', name: '新企业当前员工', status: 'active' },
        { principal_id: 'new-b', name: '新企业候选员工', status: 'active' }
      ] }
    })
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={first.runtime} onTransferred={first.onTransferred} />)
    await waitFor(() => expect(first.get).toHaveBeenCalledWith('/api/shop-login-profiles'))
    view.rerender(<ShopServiceAssignment profileId={profileId} runtime={second.runtime} onTransferred={second.onTransferred} />)
    await screen.findByRole('option', { name: '新企业候选员工' })
    await act(async () => oldList.resolve({ profiles: [{ ...first.store.record }] }))
    expect(shownService()).toBe('新企业当前员工')
    expect(screen.queryByRole('option', { name: '新服务员工' })).toBeNull()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
  })

  it('clears a selected member on profile change and ignores the previous transfer result', async () => {
    const test = fixture()
    const pending = deferred<{ profile: typeof test.store.record }>()
    test.post.mockReturnValueOnce(pending.promise)
    const view = render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await chooseNewMember()
    fireEvent.click(screen.getByRole('button', { name: '转移服务店铺' }))
    const otherId = '4e54c581-cd0d-4edb-a03d-408a3e70d0ab'
    test.store.record = { ...test.store.record, profile_id: otherId }
    view.rerender(<ShopServiceAssignment profileId={otherId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await screen.findByRole('option', { name: '新服务员工' })
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    await act(async () => pending.resolve({ profile: { ...test.store.record, profile_id: profileId, revision: 8, servicing_principal_id: 'new' } }))
    expect(shownService()).toBe('原服务员工')
    expect(test.onTransferred).not.toHaveBeenCalled()
  })

  it('shows a safe load failure for deleted profiles and retries with fresh whoami', async () => {
    const test = fixture()
    test.store.record.deleted = true
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '转移服务店铺' }).hasAttribute('disabled')).toBe(true)
    test.store.record.deleted = false
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('option', { name: '新服务员工' })
    expect(test.get.mock.calls.filter(([path]) => path === '/api/whoami')).toHaveLength(2)
  })

  it('disables mutations when the runtime has no post bridge', async () => {
    const test = fixture()
    delete test.runtime.post
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    await screen.findByRole('option', { name: '新服务员工' })
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '转移服务店铺' }).hasAttribute('disabled')).toBe(true)
  })

  it.each(['zh', 'zh-hant', 'en', 'ja', 'ar'] as Locale[])('renders assignment copy in %s', async locale => {
    language.locale = locale
    const test = fixture()
    render(<ShopServiceAssignment profileId={profileId} runtime={test.runtime} onTransferred={test.onTransferred} />)
    const copy = shopServiceAssignmentCopy[locale]
    const section = await screen.findByRole('region', { name: copy.title })
    expect(within(section).getByText(copy.ownership)).toBeTruthy()
    expect(within(section).getByText(copy.accessChange)).toBeTruthy()
    expect(within(section).getByRole('button', { name: copy.transfer })).toBeTruthy()
    expect(section.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : null)
  })
})
