
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'
import { shopBrowserCopy } from '@/i18n/shop-browser'

import type { ShopBrowserProfile, ShopBrowserRequest } from '../../electron/shop-browser-types'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))
afterEach(() => vi.unstubAllGlobals())

function fixture(initialProfiles: ShopBrowserProfile[] = []) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  let profiles: ShopBrowserProfile[] = [...initialProfiles]
  let openProfileId: string | null = null

  const send = vi.fn(async (request: Omit<ShopBrowserRequest, 'sessionId'>) => {
    if (request.action === 'list') {return { ok: true, profiles, openProfileId }}

    if (request.action === 'create') {
      const profile: ShopBrowserProfile = {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant',
        principalId: 'employee',
        displayName: '店铺登录',
        createdAt: '2026-11-15T00:00:00Z',
        checkedAt: null,
        loginState: 'unverified',
        shopId: null,
        shopName: null
      }

      profiles.push(profile)

      return { ok: true, profile }
    }

    if (request.action === 'open') {openProfileId = request.profileId!}

    if (request.action === 'close') {openProfileId = null}

    if (request.action === 'identify')
      {profiles = profiles.map(profile => ({
        ...profile,
        shopId: '123',
        shopName: '识别店铺',
        displayName: '识别店铺',
        loginState: 'verified'
      }))}

    if (request.action === 'relogin')
      {profiles = profiles.map(profile => ({ ...profile, shopId: null, shopName: null, loginState: 'unverified' }))}

    if (request.action === 'delete') {
      const profile = profiles.find(item => item.id === request.profileId)
      profiles = profiles.filter(item => item.id !== request.profileId)

      return { ok: true, profile, openProfileId }
    }

    return { ok: true, openProfileId }
  })

  const runtime = { shopBrowser: send } as unknown as EnterpriseClientRuntime

  return { send, runtime }
}

function twoShops(): ShopBrowserProfile[] {
  return ['A', 'B'].map((name, index) => ({
    id: `11111111-1111-1111-1111-11111111111${index}`,
    tenantId: 'tenant', principalId: 'employee', displayName: `店铺${name}`,
    shopName: `店铺${name}`, shopId: `shop-${name}`, createdAt: '2026-11-15T00:00:00Z',
    checkedAt: null, loginState: 'verified' as const
  }))
}

it.each(['mouse', 'Enter', 'Space'] as const)('keeps the controlled shop when opening another shop assignment via %s', async activation => {
  const shops = twoShops()
  const f = fixture(shops)
  const records = shops.map((shop, index) => ({ profile_id: shop.id, revision: 7, deleted: false,
    servicing_principal_ids: index ? ['staff'] : [], profile: { shop_name: shop.shopName } }))
  const get = vi.fn(async (url: string) => {
    if (url === '/api/whoami') { return { role: 'tenant_admin', tenant_id: 'tenant', principal_id: 'admin' } }
    if (url === '/api/shop-login-profiles') { return { profiles: records } }
    if (url === '/api/principals') { return { principals: [
      { principal_id: 'staff', tenant_id: 'tenant', role: 'operator', status: 'active', name: '模拟员工' },
      { principal_id: 'staff2', tenant_id: 'tenant', role: 'operator', status: 'active', name: '模拟员工二' }
    ] } }
    throw new Error(`unexpected endpoint ${url}`)
  })
  const post = vi.fn(async (_url: string, body: { profile_id: string; principal_ids: string[]; expected_revision: number }) => {
    const record = records.find(item => item.profile_id === body.profile_id)!
    if (record.revision !== body.expected_revision) { throw new Error('409') }
    record.revision++
    record.servicing_principal_ids = [...body.principal_ids]
    return { profile: record }
  })
  Object.assign(f.runtime, { get, post })
  const selections = vi.fn()
  function Parent() {
    const [selected, setSelected] = useState(shops[0].id)
    return <ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} selectedProfileId={selected}
      onSelectedProfile={id => { selections(id); setSelected(id) }} />
  }
  render(<Parent />)
  const rowA = (await screen.findByText('店铺A')).closest('tr')!
  const rowB = (await screen.findByText('店铺B')).closest('tr')!
  const button = await within(rowB).findByRole('button', { name: '员工分配' })
  expect(rowA.getAttribute('data-selected')).toBe('true')
  if (activation !== 'mouse') {
    const key = activation === 'Space' ? ' ' : 'Enter'
    button.focus()
    fireEvent.keyDown(button, { key, code: activation })
    fireEvent.click(button, { detail: 0 })
    fireEvent.keyUp(button, { key, code: activation })
  } else { fireEvent.click(button) }
  expect(rowA.getAttribute('data-selected')).toBe('true')
  expect(rowB.getAttribute('data-selected')).toBe('false')
  expect(selections).not.toHaveBeenCalledWith(shops[1].id)
  const dialog = await screen.findByRole('dialog', { name: '员工分配 · 店铺B' })
  const staff2 = await within(dialog).findByRole('checkbox', { name: '模拟员工二' })
  await waitFor(() => expect((staff2 as HTMLInputElement).disabled).toBe(false))
  fireEvent.click(staff2)
  fireEvent.click(within(dialog).getByRole('button', { name: nativeBusinessAdminCopy.zh.save }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/shop-login-profiles-assign', expect.objectContaining({
    profile_id: shops[1].id, principal_ids: ['staff', 'staff2'], expected_revision: 7
  })))
  expect(post).toHaveBeenCalledTimes(1)
  expect(records[0]).toMatchObject({ revision: 7, servicing_principal_ids: [] })
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(rowA.getAttribute('data-selected')).toBe('true')
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.merchant))
  await waitFor(() => expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ action: 'open', profileId: shops[0].id })))
})

it('does not display a stale local amount as confirmed when cloud settings are missing', async () => {
  const [profile] = twoShops()
  profile.cloudRevision = 1
  profile.cloudPayoutSettingsState = 'missing'
  profile.payoutSettings = { remitAmount: '37', payoutReviewDays: 15, payoutRequireReviewWithinDays: false,
    payoutGoodReviewMode: 1, payoutRefundChannel: 'small_remit' }
  const f = fixture([profile])
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  expect(within(row).getByText('店铺身份已保存，业务配置待完成。')).toBeTruthy()
  expect(within(row).queryByText('37')).toBeNull()
})

it('opens employee assignments for the selected row in a dialog without changing the selected shop', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const roster = [{principal_id:'staff', tenant_id:'tenant', role:'operator', status:'active', name:'模拟员工'}]

  const records = shops.map((shop, index) => ({profile_id:shop.id, revision:1, deleted:false,
    servicing_principal_ids:index ? ['staff'] : [], profile:{shop_name:shop.shopName}}))

  const get = vi.fn(async (url: string) => {
    if (url === '/api/whoami') {return {role:'tenant_admin', tenant_id:'tenant', principal_id:'admin'}}

    if (url === '/api/shop-login-profiles') {return {profiles:records}}

    if (url === '/api/principals') {return {principals:roster}}

    throw new Error('unexpected endpoint')
  })

  Object.assign(f.runtime, {get, post:vi.fn()})
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const rowB = (await screen.findByText('店铺B')).closest('tr')!
  const button = await within(rowB).findByRole('button', {name:'员工分配'})
  expect(within(rowB).getByRole('button', {name:'选择'}).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('region', {name:'员工分配'})).toBeNull()
  fireEvent.click(button)
  const dialog = await screen.findByRole('dialog', {name:'员工分配 · 店铺B'})
  expect((await within(dialog).findByRole('checkbox', {name:'模拟员工'}) as HTMLInputElement).checked).toBe(true)
  expect(within(dialog).getByText('分组信息尚未提供，以下按员工列表显示。')).toBeTruthy()
  expect(get.mock.calls.some(([url]) => url === '/api/operations-groups')).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', {name:'关闭'}))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.send.mock.calls.every(([request]) => request.action === 'list')).toBe(true)
})

it.each(['operator', 'supervisor'])('hides shop assignment entry from %s', async role => {
  const f = fixture(twoShops())
  const get = vi.fn(async () => ({role, tenant_id:'tenant', principal_id:'staff'}))
  Object.assign(f.runtime, {get})
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  await screen.findByText('店铺B')
  await waitFor(() => expect(get).toHaveBeenCalled())
  expect(screen.queryByRole('button', {name:'员工分配'})).toBeNull()
})

it.each(['during-B', 'after-B', 'before-B', 'stale-auth', 'current-auth', 'stale-reject', 'current-reject', 'during-B-auth'] as const)(
  'does not let assignment refresh overwrite the current switch intent %s', async timing => {
    const shops = twoShops()
    const f = fixture(shops)
    const original = f.send.getMockImplementation()!
    let holdNextList = false
    let releaseList!: () => void
    let releaseOpen!: () => void

    const assignments = shops.map(shop => ({ profile_id: shop.id, revision: 1, deleted: false,
      servicing_principal_ids: ['staff-b'], profile: { shop_id: shop.shopId, shop_name: shop.shopName } }))

    const staff = [
      { principal_id: 'employee', tenant_id: 'tenant', role: 'tenant_admin', status: 'active', name: 'Admin' },
      { principal_id: 'staff-b', tenant_id: 'tenant', role: 'operator', status: 'active', name: 'Staff B' },
      { principal_id: 'staff-c', tenant_id: 'tenant', role: 'operator', status: 'active', name: 'Staff C' }
    ]

    Object.assign(f.runtime, {
      get: async (url: string) => {
        if (url === '/api/whoami') {return { principal_id: 'employee', tenant_id: 'tenant', role: 'tenant_admin' }}

        if (url === '/api/shop-login-profiles') {return { profiles: assignments }}

        if (url === '/api/principals') {return { principals: staff }}
        throw new Error('unexpected synthetic get')
      },
      post: async (_url: string, body: { profile_id: string; principal_ids: string[] }) => {
        const item = assignments.find(record => record.profile_id === body.profile_id)!
        item.revision++
        item.servicing_principal_ids = [...body.principal_ids]

        return { profile: { ...item } }
      }
    })
    f.send.mockImplementation(async request => {
      if (request.action === 'list' && holdNextList) {
        holdNextList = false
        const reply = await original(request)

        return new Promise((resolve, reject) => { releaseList = () => timing.endsWith('reject')
          ? reject(new Error('SHOP_PROFILE_FORBIDDEN'))
          : resolve(timing.endsWith('auth') ? { ok: false, error: 'SHOP_PROFILE_FORBIDDEN' } as never : reply) })
      }

      if (request.action === 'open' && request.profileId === shops[1].id && (timing === 'during-B' || timing === 'during-B-auth')) {
        return new Promise(resolve => { releaseOpen = () => { void original(request).then(resolve) } })
      }

      return original(request)
    })
    const onProfilesChange = vi.fn()
    const onSelectedProfile = vi.fn()
    render(<ShopBrowserProfilesPanel nativeLayout onProfilesChange={onProfilesChange} onSelectedProfile={onSelectedProfile} runtime={f.runtime} />)
    const rowA = (await screen.findByText('店铺A')).closest('tr')!
    fireEvent.click(within(rowA).getByRole('button', { name: /选择/ }))
    fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
    const switcher = await screen.findByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement
    await waitFor(() => expect(switcher.disabled).toBe(false))
    fireEvent.click(within(rowA).getByRole('button', {name:'员工分配'}))
    const region = await screen.findByRole('region', { name: nativeBusinessAdminCopy.zh.assignments })
    const staffC = await within(region).findByRole('checkbox', { name: 'Staff C' })
    await waitFor(() => expect((staffC as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(staffC)
    holdNextList = true
    fireEvent.click(within(region).getByRole('button', { name: nativeBusinessAdminCopy.zh.save }))
    await waitFor(() => expect(releaseList).toBeTypeOf('function'))

    if (timing === 'current-auth' || timing === 'current-reject') {
      await act(async () => { releaseList() })
      await waitFor(() => expect(onProfilesChange).toHaveBeenLastCalledWith([]))
      expect(onSelectedProfile).toHaveBeenLastCalledWith('')

      return
    }

    if (timing === 'before-B') {await act(async () => { releaseList() })}
    fireEvent.change(switcher, { target: { value: shops[1].id } })

    if (timing === 'during-B' || timing === 'during-B-auth') {
      await waitFor(() => expect(releaseOpen).toBeTypeOf('function'))
      await act(async () => { releaseList() })

      if (timing === 'during-B-auth') {
        await waitFor(() => expect(onProfilesChange).toHaveBeenLastCalledWith([]))
        await act(async () => { releaseOpen() })
        expect(onSelectedProfile).toHaveBeenLastCalledWith('')
        expect(screen.queryByText('店铺B')).toBeNull()

        return
      }

      const before = f.send.mock.calls.filter(([r]) => r.action === 'bounds' && r.profileId === shops[0].id).length
      fireEvent(window, new Event('resize'))
      expect(f.send.mock.calls.filter(([r]) => r.action === 'bounds' && r.profileId === shops[0].id)).toHaveLength(before)
      await act(async () => { releaseOpen() })
    }

    await waitFor(() => expect(switcher.value).toBe(shops[1].id))

    if (timing === 'stale-auth' || timing === 'stale-reject') {
      await act(async () => { releaseList() })
      await waitFor(() => expect(onProfilesChange).toHaveBeenLastCalledWith([]))
      expect(onSelectedProfile).toHaveBeenLastCalledWith('')

      return
    }

    if (timing === 'after-B') {await act(async () => { releaseList() })}
    expect(switcher.value).toBe(shops[1].id)
    expect(screen.queryByText(/SHOP_PROFILE_NOT_OPEN/)).toBeNull()
  }
)

it.each(['failure', 'rejection', 'success'] as const)('ignores obsolete A bounds %s after switching to B', async outcome => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  let reject!: (error: Error) => void
  let captured = false
  f.send.mockImplementation(request => {
    if (request.action === 'bounds' && request.profileId === shops[0].id && !captured) {
      captured = true

      return new Promise((resolve, fail) => { release = resolve; reject = fail })
    }

    return original(request)
  })
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const rowA = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(rowA).getByRole('button', { name: /选择/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
  const switcher = await screen.findByRole('combobox', { name: '切换店铺浏览器' })
  await waitFor(() => expect(captured).toBe(true))
  fireEvent.change(switcher, { target: { value: shops[1].id } })
  await waitFor(() => expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[1].id))
  await act(async () => {
    if (outcome === 'failure') {release({ ok: false, error: 'SHOP_PROFILE_NOT_OPEN' } as never)}
    else if (outcome === 'rejection') {reject(new Error('synthetic stale failure'))}
    else {release({ ok: true } as never)}
  })
  expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[1].id)
  expect(screen.queryByText(/SHOP_PROFILE_NOT_OPEN/)).toBeNull()
})

it('immediately reapplies A bounds when a recoverable B open fails', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  f.send.mockImplementation(request => request.action === 'open' && request.profileId === shops[1].id
    ? Promise.resolve({ ok: false, error: 'SHOP_PROFILE_PAGE_NOT_READY' } as never) : original(request))
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  fireEvent.click(within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', { name: /选择/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
  const switcher = await screen.findByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement
  await waitFor(() => expect(switcher.disabled).toBe(false))
  const initial = f.send.mock.calls.filter(([request]) => request.action === 'bounds' && request.profileId === shops[0].id).length
  fireEvent.change(switcher, { target: { value: shops[1].id } })
  expect((await screen.findAllByText(/SHOP_PROFILE_PAGE_NOT_READY/)).length).toBeGreaterThan(0)
  expect(switcher.value).toBe(shops[0].id)
  expect(f.send.mock.calls.filter(([request]) => request.action === 'bounds' && request.profileId === shops[0].id).length).toBeGreaterThan(initial)
})

it('ignores old bounds while the requested B switch is still pending', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  let releaseBounds!: (value: Awaited<ReturnType<typeof original>>) => void
  let releaseOpen!: () => void
  let captured = false
  f.send.mockImplementation(request => {
    if (request.action === 'bounds' && request.profileId === shops[0].id && !captured) {
      captured = true

      return new Promise(resolve => { releaseBounds = resolve })
    }

    if (request.action === 'open' && request.profileId === shops[1].id) {
      return new Promise(resolve => { releaseOpen = () => { void original(request).then(resolve) } })
    }

    return original(request)
  })
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  fireEvent.click(within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', { name: /选择/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
  const switcher = await screen.findByRole('combobox', { name: '切换店铺浏览器' })
  await waitFor(() => expect(captured).toBe(true))
  fireEvent.change(switcher, { target: { value: shops[1].id } })
  await waitFor(() => expect(releaseOpen).toBeTypeOf('function'))
  await act(async () => { releaseBounds({ ok: false, error: 'SHOP_PROFILE_NOT_OPEN' } as never) })
  expect(screen.queryByText(/SHOP_PROFILE_NOT_OPEN/)).toBeNull()
  expect(screen.getByRole('combobox', { name: '切换店铺浏览器' })).toBeTruthy()
  await act(async () => { releaseOpen() })
  await waitFor(() => expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[1].id))
})

it('ignores an old A response after switching A to B and back to A', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  let captured = false
  f.send.mockImplementation(request => {
    if (request.action === 'bounds' && request.profileId === shops[0].id && !captured) {
      captured = true

      return new Promise(resolve => { release = resolve })
    }

    return original(request)
  })
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  fireEvent.click(within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', { name: /选择/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
  await screen.findByRole('combobox', { name: '切换店铺浏览器' })
  await waitFor(() => expect(captured).toBe(true))
  fireEvent.change(screen.getByRole('combobox', { name: '切换店铺浏览器' }), { target: { value: shops[1].id } })
  await waitFor(() => expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[1].id))
  await waitFor(() => expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).disabled).toBe(false))
  fireEvent.change(screen.getByRole('combobox', { name: '切换店铺浏览器' }), { target: { value: shops[0].id } })
  await waitFor(() => expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[0].id))
  await act(async () => { release({ ok: false, error: 'SHOP_PROFILE_NOT_OPEN' } as never) })
  expect((screen.getByRole('combobox', { name: '切换店铺浏览器' }) as HTMLSelectElement).value).toBe(shops[0].id)
  expect(screen.queryByText(/SHOP_PROFILE_NOT_OPEN/)).toBeNull()
})

it.each(['SHOP_PROFILE_NOT_OPEN', 'SHOP_PROFILE_FORBIDDEN', 'SHOP_PROFILE_ACCESS_UNAVAILABLE', 'SHOP_PROFILE_OWNER_CHANGED'])(
  'keeps current B bounds failure %s visible and applies authorization invalidation', async failure => {
    const shops = twoShops()
    const f = fixture(shops)
    const original = f.send.getMockImplementation()!
    let release!: (value: Awaited<ReturnType<typeof original>>) => void
    let captured = false
    f.send.mockImplementation(request => {
      if (request.action === 'bounds' && request.profileId === shops[1].id && !captured) {
        captured = true

        return new Promise(resolve => { release = resolve })
      }

      return original(request)
    })
    render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
    fireEvent.click(within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', { name: /选择/ }))
    fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
    fireEvent.change(await screen.findByRole('combobox', { name: '切换店铺浏览器' }), { target: { value: shops[1].id } })
    await waitFor(() => expect(captured).toBe(true))
    await act(async () => { release({ ok: false, error: failure } as never) })
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes(failure))).toBe(true))

    if (/FORBIDDEN|ACCESS_UNAVAILABLE|OWNER_CHANGED/.test(failure)) {
      expect(screen.queryByText('店铺A')).toBeNull()
      expect(screen.queryByText('店铺B')).toBeNull()
    }
  })

it('does not apply a bounds response after component unmount', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  f.send.mockImplementation(request => request.action === 'bounds'
    ? new Promise(resolve => { release = resolve }) : original(request))
  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  fireEvent.click(within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', { name: /选择/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.merchant))
  await waitFor(() => expect(release).toBeTypeOf('function'))
  view.unmount()
  await act(async () => { release({ ok: false, error: 'SHOP_PROFILE_NOT_OPEN' } as never) })
  expect(screen.queryByText(/SHOP_PROFILE_NOT_OPEN/)).toBeNull()
})

it('requests a bounded CSV export and reports saved only after the main-process reply', async () => {
  const f = fixture(twoShops())
  const original = f.send.getMockImplementation()!
  let complete!: (reply: unknown) => void
  f.send.mockImplementation(request => request.action === 'exportCsv'
    ? new Promise(resolve => {complete = resolve as (reply: unknown) => void})
    : original(request))
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  await screen.findByText('店铺A')
  fireEvent.click(screen.getByRole('button', {name:'一键导出'}))
  await waitFor(() => expect(f.send).toHaveBeenCalledWith({action:'exportCsv', locale:'zh'}))
  expect(screen.queryByText(/导出成功/)).toBeNull()
  await act(async () => {complete({ok:true, exportResult:{status:'saved', count:2}})})
  expect(await screen.findByText(/导出成功.*2/)).toBeTruthy()
})

it.each([
  ['canceled', '已取消导出'],
  ['empty', '没有可导出的店铺'],
  ['busy', '导出正在进行'],
  ['cloud_unavailable', '云端店铺列表不可用，未导出'],
  ['write_failed', '文件保存失败']
] as const)('shows the truthful export result for %s', async (status, message) => {
  const f = fixture(twoShops())
  const original = f.send.getMockImplementation()!
  f.send.mockImplementation(async request => request.action === 'exportCsv'
    ? {ok:true, exportResult:{status}} as never
    : original(request))
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  await screen.findByText('店铺A')
  fireEvent.click(screen.getByRole('button', {name:'一键导出'}))
  expect(await screen.findByText(message)).toBeTruthy()
  expect(screen.queryByText(/导出成功/)).toBeNull()
})

it('drops an old export reply after the runtime is replaced', async () => {
  const first = fixture(twoShops())
  const second = fixture(twoShops())
  const original = first.send.getMockImplementation()!
  let complete!: (value: unknown) => void
  first.send.mockImplementation(request => request.action === 'exportCsv'
    ? new Promise(resolve => {complete = resolve as (value:unknown) => void})
    : original(request))
  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={first.runtime} />)
  await screen.findByText('店铺A')
  fireEvent.click(screen.getByRole('button', {name:'一键导出'}))
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  view.rerender(<ShopBrowserProfilesPanel nativeLayout runtime={second.runtime} />)
  await act(async () => {complete({ok:true, exportResult:{status:'saved', count:2}})})
  expect(screen.queryByText(/导出成功/)).toBeNull()
})

it('opens a focused personal removal dialog for the exact row and cancels on Escape', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  const trigger = within(row).getByRole('button', { name: shopBrowserCopy.zh.remove })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.textContent).toContain('店铺A')
  expect(dialog.textContent).toContain('shop-A')
  expect(dialog.textContent).toContain(shopBrowserCopy.zh.deleteWarning)
  await waitFor(() => expect(dialog.contains(globalThis.document.activeElement)).toBe(true))
  f.send.mockClear()
  fireEvent.keyDown(globalThis.window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.send.mock.calls.some(([request]) => request.action === 'delete' || request.action === 'close')).toBe(false)
  expect(globalThis.document.activeElement).toBe(trigger)
})

it('identifies an unverified shop by its stable profile ID when the shop ID is missing', async () => {
  const shops = twoShops().map(shop => ({...shop, displayName:'店铺登录', shopName:null, shopId:null, loginState:'unverified' as const}))
  const f = fixture(shops)
  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  await screen.findAllByText('店铺登录')
  const target = view.container.querySelector(`[data-profile-id="${shops[1].id}"]`) as HTMLElement
  fireEvent.click(within(target).getByRole('button', {name:shopBrowserCopy.zh.remove}))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain('店铺登录')
  expect(dialog.textContent).toContain(shops[1].id)
  expect(dialog.textContent).not.toContain(shops[0].id)
})

it('contains Tab focus and restores focus on Cancel', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  const trigger = within(row).getByRole('button', { name: shopBrowserCopy.zh.remove })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  const confirm = within(dialog).getByRole('button', {name: shopBrowserCopy.zh.confirmDelete})
  const cancel = within(dialog).getByRole('button', {name: shopBrowserCopy.zh.cancel})
  await waitFor(() => expect(globalThis.document.activeElement).toBe(confirm))
  fireEvent.keyDown(globalThis.window, {key:'Tab', shiftKey:true})
  expect(globalThis.document.activeElement).toBe(cancel)
  fireEvent.keyDown(globalThis.window, {key:'Tab'})
  expect(globalThis.document.activeElement).toBe(confirm)
  f.send.mockClear()
  fireEvent.click(cancel)
  await waitFor(() => expect(globalThis.document.activeElement).toBe(trigger))
  expect(f.send.mock.calls.some(([request]) => request.action === 'delete' || request.action === 'close')).toBe(false)
})

it('focuses the shop region if the original row disappears before cancellation', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  const trigger = within(row).getByRole('button', {name:shopBrowserCopy.zh.remove})
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(screen.getByRole('textbox', {name:'搜索店铺名 / 店铺 ID'}), {target:{value:'店铺B'}})
  expect(trigger.isConnected).toBe(false)
  f.send.mockClear()
  fireEvent.click(within(dialog).getByRole('button', {name:shopBrowserCopy.zh.cancel}))
  await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByRole('region', {name:'店铺管理'})))
  expect(f.send.mock.calls.some(([request]) => request.action === 'delete' || request.action === 'close')).toBe(false)
})

it('returns focus to the safe shop region when removal is rejected by global authorization', async () => {
  const f = fixture(twoShops())
  const original = f.send.getMockImplementation()!
  f.send.mockImplementation(request => request.action === 'delete' ? Promise.resolve({ok:false, error:'SHOP_PROFILE_FORBIDDEN'} as never) : original(request))
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  const trigger = within(row).getByRole('button', {name:shopBrowserCopy.zh.remove})
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name:shopBrowserCopy.zh.confirmDelete}))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(trigger.isConnected).toBe(false))
  await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByRole('region', {name:'店铺管理'})))
  expect(f.send.mock.calls.filter(([request]) => request.action === 'delete')).toHaveLength(1)
})

it('does not steal user focus when a pending removal loses authorization', async () => {
  const f = fixture(twoShops())
  const original = f.send.getMockImplementation()!
  let release!: () => void
  f.send.mockImplementation(request => request.action === 'delete'
    ? new Promise(resolve => {release = () => resolve({ok:false, error:'SHOP_PROFILE_FORBIDDEN'} as never)})
    : original(request))
  render(<><button>其他位置</button><ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} /></>)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', {name:shopBrowserCopy.zh.remove}))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name:shopBrowserCopy.zh.confirmDelete}))
  await waitFor(() => expect(release).toBeTypeOf('function'))
  const destination = screen.getByRole('button', {name:'其他位置'})
  destination.focus()
  await act(async () => {release(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))})
  expect(globalThis.document.activeElement).toBe(destination)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('ignores a late authorization failure from the previous runtime', async () => {
  const first = fixture(twoShops())
  const second = fixture(twoShops())
  const original = first.send.getMockImplementation()!
  let release!: () => void
  first.send.mockImplementation(request => request.action === 'delete'
    ? new Promise(resolve => {release = () => resolve({ok:false, error:'SHOP_PROFILE_FORBIDDEN'} as never)})
    : original(request))
  const view = render(<><button>其他位置</button><ShopBrowserProfilesPanel nativeLayout runtime={first.runtime} /></>)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', {name:shopBrowserCopy.zh.remove}))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name:shopBrowserCopy.zh.confirmDelete}))
  await waitFor(() => expect(release).toBeTypeOf('function'))
  view.rerender(<><button>其他位置</button><ShopBrowserProfilesPanel nativeLayout runtime={second.runtime} /></>)
  await screen.findByText('店铺A')
  const destination = screen.getByRole('button', {name:'其他位置'})
  destination.focus()
  await act(async () => {release(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))})
  expect(globalThis.document.activeElement).toBe(destination)
  expect(screen.getByText('店铺A')).toBeTruthy()
  expect(second.send.mock.calls.some(([request]) => request.action === 'delete')).toBe(false)
})

it('restores the original trigger after a normal post-removal network rejection', async () => {
  const f = fixture(twoShops())
  const original = f.send.getMockImplementation()!
  let accepted = false
  f.send.mockImplementation(async request => {
    if (request.action === 'list' && accepted) {throw new Error('NETWORK_FAILED')}
    const response = await original(request)

    if (request.action === 'delete') {accepted = true}

    return response
  })
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const trigger = within((await screen.findByText('店铺A')).closest('tr')!).getByRole('button', {name:shopBrowserCopy.zh.remove})
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name:shopBrowserCopy.zh.confirmDelete}))
  await screen.findByText(/NETWORK_FAILED/)
  expect(trigger.isConnected).toBe(true)
  await waitFor(() => expect(globalThis.document.activeElement).toBe(trigger))
})

it('focuses the shop region after a successful removal unmounts its trigger', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  const trigger = within(row).getByRole('button', {name:shopBrowserCopy.zh.remove})
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name:shopBrowserCopy.zh.confirmDelete}))
  await waitFor(() => expect(trigger.isConnected).toBe(false))
  await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByRole('region', {name:'店铺管理'})))
})

it('closes the old removal dialog synchronously when the runtime changes', async () => {
  const first = fixture(twoShops())
  const second = fixture(twoShops().map(shop => ({...shop, tenantId:'other-tenant', principalId:'other-actor'})))
  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={first.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', {name:shopBrowserCopy.zh.remove}))
  await screen.findByRole('dialog')
  view.rerender(<ShopBrowserProfilesPanel nativeLayout runtime={second.runtime} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(second.send.mock.calls.some(([request]) => request.action === 'delete')).toBe(false)
})

it('removes the originally confirmed row while preserving the newly selected shop', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const rowA = (await screen.findByText('店铺A')).closest('tr')!
  const rowB = screen.getByText('店铺B').closest('tr')!
  fireEvent.click(within(rowA).getByRole('button', { name: shopBrowserCopy.zh.remove }))
  await screen.findByText(shopBrowserCopy.zh.deleteWarning)
  fireEvent.click(within(rowB).getByRole('button', { name: /选择/ }))
  f.send.mockClear()
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.confirmDelete))
  await waitFor(() => expect(f.send).toHaveBeenCalledWith({ action: 'delete', profileId: shops[0].id }))
  await waitFor(() => expect(screen.getByText('店铺B').closest('tr')?.getAttribute('data-selected')).toBe('true'))
  expect(f.send.mock.calls.some(([r]) => r.action === 'close' || (r.action === 'delete' && r.profileId === shops[1].id))).toBe(false)
})

it('cancels row removal without invoking delete or close', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: shopBrowserCopy.zh.remove }))
  await screen.findByText(shopBrowserCopy.zh.deleteWarning)
  f.send.mockClear()
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.cancel))
  expect(f.send.mock.calls.some(([r]) => r.action === 'delete' || r.action === 'close')).toBe(false)
})

it.each(['SHOP_PROFILE_IN_USE', 'SHOP_PROFILE_FORBIDDEN', 'SHOP_PROFILE_NOT_FOUND', 'SHOP_CLOUD_CONFLICT', 'SHOP_PROFILE_ACCESS_UNAVAILABLE'])(
  'keeps the other selected shop when row removal fails with %s', async failure => {
    const shops = twoShops()
    const f = fixture(shops)
    const original = f.send.getMockImplementation()!
    f.send.mockImplementation(async request => request.action === 'delete' ? { ok: false, error: failure } as never : original(request))
    render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
    const rowA = (await screen.findByText('店铺A')).closest('tr')!
    const rowB = screen.getByText('店铺B').closest('tr')!
    fireEvent.click(within(rowA).getByRole('button', { name: shopBrowserCopy.zh.remove }))
    await screen.findByText(shopBrowserCopy.zh.deleteWarning)
    fireEvent.click(within(rowB).getByRole('button', { name: /选择/ }))
    f.send.mockClear()
    fireEvent.click(screen.getByText(shopBrowserCopy.zh.confirmDelete))
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes(failure))).toBe(true))
    expect(f.send.mock.calls.some(([r]) => r.action === 'close' || (r.action === 'delete' && r.profileId === shops[1].id))).toBe(false)

    // Revocation intentionally clears the stale list, according to the existing security boundary.
    if (!/FORBIDDEN|ACCESS_UNAVAILABLE/.test(failure)) {expect(rowB.getAttribute('data-selected')).toBe('true')}
  })

it('does not submit the row removal twice while it is pending', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: shopBrowserCopy.zh.remove }))
  const button = await screen.findByText(shopBrowserCopy.zh.confirmDelete)
  const original = f.send.getMockImplementation()!
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  f.send.mockImplementation(request => request.action === 'delete' ? new Promise(resolve => { release = resolve }) : original(request))
  f.send.mockClear()
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(f.send.mock.calls.filter(([r]) => r.action === 'delete')).toHaveLength(1))
  fireEvent.keyDown(globalThis.window, {key:'Escape'})
  expect(screen.getByRole('dialog')).toBeTruthy()
  release({ ok: false, error: 'SHOP_PROFILE_IN_USE' } as never)
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('SHOP_PROFILE_IN_USE'))
})

it.each(['ok', '403', '404', '409', 'network', 'forbidden', 'owner', 'in-use'])('preserves shared assets through real runtime and cloud adapter on %s', async outcome => {
  const { promises: fs } = await import('node:fs')
  const { default: os } = await import('node:os')
  const { default: path } = await import('node:path')
  const { ShopBrowserRuntime } = await import('../../electron/' + 'shop-browser-runtime')
  const { createShopProfileCloud } = await import('../../electron/' + 'shop-browser-cloud')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-row-hide-'))
  const records = new Map<string, Record<string, unknown>>()
  const hidden = new Map<string, Set<string>>()
  const cleared: string[] = []
  const storagePaths: string[] = []
  const closedStorage: string[] = []
  const shopByStorage = new Map<string, string>()
  const sent: { principal: string; method: string; url: string; id?: string }[] = []
  const portable = { version: 1, cookies: [], origins: [] }

  const meta = (record: Record<string, unknown>) => { const { session: _session, ...value } = record;

 return structuredClone(value) }

  const accessible = (principal: string, record: Record<string, unknown>) =>
    principal === 'admin' || (record.servicing_principal_ids as string[]).includes(principal)

  const client = (principal: string) => createShopProfileCloud({
    assertCurrent() {},
    async request(method: string, url: string, body?: { profile_id: string; expected_revision: number; profile?: unknown; session?: unknown; payout_settings?: unknown; expected_payout_settings_revision?: number }) {
      const privateIds = hidden.get(principal) ?? new Set<string>()
      hidden.set(principal, privateIds)
      const id = body?.profile_id ?? new URL(url, 'https://enterprise.example').searchParams.get('profile_id') ?? undefined
      sent.push({ principal, method, url, id })

      if (method === 'GET' && url === '/api/shop-login-profiles') {
        return { profiles: [...records.values()].filter(record => accessible(principal, record) && !privateIds.has(record.profile_id as string)).map(meta), hidden_profile_ids: [...privateIds] }
      }

      if (method === 'GET') {
        if (!id || !records.has(id) || !accessible(principal, records.get(id)!) || privateIds.has(id)) {throw new Error('404')}

        return { profile: structuredClone(records.get(id)) }
      }

      if (!body || !id) {throw new Error('invalid synthetic request')}
      const old = records.get(id)

      if (url === '/api/shop-login-profiles-delete') {
        if (!old || old.revision !== body.expected_revision) {throw new Error('409')}
        const failure = outcome === 'network' ? 'SHOP_PROFILE_ACCESS_UNAVAILABLE' : outcome === 'forbidden' ? 'SHOP_PROFILE_FORBIDDEN' : outcome === 'owner' ? 'SHOP_PROFILE_OWNER_CHANGED' : outcome

        if (outcome !== 'ok') {throw new Error(failure)}
        privateIds.add(id)

        return { profile_id: id, hidden: true }
      }

      if (body.payout_settings) {
        if (!old || old.revision !== body.expected_revision || old.payout_settings_revision !== body.expected_payout_settings_revision) { throw new Error('409') }
        const updated = { ...old, revision: body.expected_revision + 1, payout_settings: body.payout_settings,
          payout_settings_revision: Number(body.expected_payout_settings_revision) + 1 }
        records.set(id, updated)
        return { profile: meta(updated) }
      }

      const record = { profile_id: id, revision: body.expected_revision + 1, deleted: false,
        updated_at: new Date().toISOString(), created_by: principal,
        servicing_principal_ids: ['employee-a', 'employee-b'], servicing_principal_names: ['A', 'B'],
        payout_settings: null, payout_settings_revision: 0, profile: body.profile, session: body.session }

      records.set(id, record)

      return { profile: meta(record) }
    }
  })

  let shopNumber = 0

  const runtime = new ShopBrowserRuntime({
    root, cloud: client('employee-a'),
    authorize: async () => ({ origin: 'https://enterprise.example', tenantId: 'tenant', principalId: 'employee-a' }),
    isCurrent: () => true,
    clearStorage: async (storage: string) => { cleared.push(storage); await fs.rm(storage, { recursive: true, force: true }) },
    createView: async (storage: string) => { storagePaths.push(storage); shopByStorage.set(storage, `${shopNumber}`);

 return { identify: async () => ({ shopId: `${shopNumber}`, shopName: `Synthetic ${shopNumber}` }), close: async () => { closedStorage.push(storage) }, setBounds() {} } },
    createExecution: async (storage: string) => ({ identify: async () => ({ shopId: shopByStorage.get(storage), shopName: `Synthetic ${shopByStorage.get(storage)}` }), command: async () => ({}), close: async () => {} }),
    exportSession: async () => portable, importSession: async () => {}
  })

  const call = (request: Omit<ShopBrowserRequest, 'sessionId'>) => runtime.operate({ ...request, sessionId: 'test' })

  try {
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    shopNumber = 101
    const a = (await call({ action: 'create' })).profile!
    expect((await call({ action: 'open', profileId: a.id, target: 'merchant', bounds })).ok).toBe(true)
    const pendingA = (await call({ action: 'identify', profileId: a.id })).pendingIdentity!
    const payoutSettings = { remitAmount: '5', payoutReviewDays: 15, payoutRequireReviewWithinDays: false,
      payoutGoodReviewMode: 1 as const, payoutRefundChannel: 'small_remit' as const }
    expect((await call({ action: 'confirmIdentity', profileId: a.id, pendingToken: pendingA.token, payoutSettings })).ok).toBe(true)
    await call({ action: 'close' })
    shopNumber = 102
    const b = (await call({ action: 'create' })).profile!
    expect((await call({ action: 'open', profileId: b.id, target: 'merchant', bounds })).ok).toBe(true)
    const pendingB = (await call({ action: 'identify', profileId: b.id })).pendingIdentity!
    expect((await call({ action: 'confirmIdentity', profileId: b.id, pendingToken: pendingB.token, payoutSettings })).ok).toBe(true)
    await call({ action: 'close' })
    const [storageA, storageB] = storagePaths
    await fs.writeFile(path.join(storageA, 'synthetic-marker'), 'A')
    await fs.writeFile(path.join(storageB, 'synthetic-marker'), 'B')
    const execution = outcome === 'in-use' ? await runtime.acquireExecution(a.id, 'merchant') : undefined
    const before = structuredClone(records.get(a.id))
    const ui = render(<ShopBrowserProfilesPanel nativeLayout runtime={{ shopBrowser: call } as EnterpriseClientRuntime} />)
    await waitFor(() => expect(ui.container.querySelector(`[data-profile-id="${a.id}"]`)).not.toBeNull())
    const rowA = ui.container.querySelector(`[data-profile-id="${a.id}"]`) as HTMLElement
    const rowB = ui.container.querySelector(`[data-profile-id="${b.id}"]`) as HTMLElement
    fireEvent.click(within(rowA).getByRole('button', { name: shopBrowserCopy.zh.remove }))
    fireEvent.click(within(rowB).getByRole('button', { name: /选择/ }))
    closedStorage.length = 0
    fireEvent.click(await screen.findByText(shopBrowserCopy.zh.confirmDelete))

    if (outcome === 'ok') {
      await waitFor(() => expect(hidden.get('employee-a')?.has(a.id)).toBe(true))
      await waitFor(() => expect(ui.container.querySelector(`[data-profile-id="${b.id}"]`)?.getAttribute('data-selected')).toBe('true'))
      expect(cleared).toEqual([storageA])
    } else {
      const failure = outcome === 'network' ? 'SHOP_PROFILE_ACCESS_UNAVAILABLE' : outcome === 'forbidden' ? 'SHOP_PROFILE_FORBIDDEN' : outcome === 'owner' ? 'SHOP_PROFILE_OWNER_CHANGED' : outcome === 'in-use' ? 'SHOP_PROFILE_IN_USE' : outcome
      await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes(failure))).toBe(true))
      expect(hidden.get('employee-a')?.has(a.id)).toBe(false)
      expect(cleared).toEqual([])

      if (outcome === '404' || outcome === '409' || outcome === 'in-use') {
        expect(ui.container.querySelector(`[data-profile-id="${b.id}"]`)?.getAttribute('data-selected')).toBe('true')
        expect(closedStorage).not.toContain(storageB)
      }

      if (['network', 'forbidden', 'owner'].includes(outcome)) {
        await waitFor(() => expect(ui.container.querySelector(`[data-profile-id="${b.id}"]`)).toBeNull())
        fireEvent.click(screen.getByText(shopBrowserCopy.zh.refresh))
        await waitFor(() => expect(ui.container.querySelector(`[data-profile-id="${b.id}"]`)).not.toBeNull())
      }
    }

    expect(await fs.readFile(path.join(storageB, 'synthetic-marker'), 'utf8')).toBe('B')
    expect(records.get(a.id)).toEqual(before)
    expect((await client('employee-b').list()).profiles.some((p: { profile_id: string }) => p.profile_id === a.id)).toBe(true)
    expect((await client('admin').list()).profiles.some((p: { profile_id: string }) => p.profile_id === a.id)).toBe(true)
    expect(sent.filter(x => x.url === '/api/shop-login-profiles-delete').map(x => x.id)).toEqual(outcome === 'in-use' ? [] : [a.id])
    await execution?.close()
    ui.unmount()
  } finally {
    runtime.invalidate()
    await runtime.revalidate()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('binds a row relogin confirmation to its original shop even after selecting another', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const rowA = (await screen.findByText('店铺A')).closest('tr')!
  const rowB = screen.getByText('店铺B').closest('tr')!
  fireEvent.click(within(rowA).getByRole('button', { name: /清除登录并重新登录/ }))
  await screen.findByText(shopBrowserCopy.zh.resetWarning)
  fireEvent.click(within(rowB).getByRole('button', { name: /选择/ }))
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.confirmReset))
  await waitFor(() => expect(f.send).toHaveBeenCalledWith({ action: 'relogin', profileId: shops[0].id }))
  expect(f.send.mock.calls.some(([r]) => r.action === 'relogin' && r.profileId === shops[1].id)).toBe(false)
})

it('cancels a row relogin without clearing any profile', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: /清除登录并重新登录/ }))
  await screen.findByText(shopBrowserCopy.zh.resetWarning)
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.cancel))
  expect(f.send.mock.calls.some(([r]) => r.action === 'relogin')).toBe(false)
})

it.each(['SHOP_PROFILE_IN_USE', 'SHOP_PROFILE_FORBIDDEN', 'SHOP_PROFILE_NOT_FOUND', 'SHOP_PROFILE_ACCESS_UNAVAILABLE'])(
  'surfaces %s without resetting another shop or closing a view', async failure => {
    const shops = twoShops()
    const f = fixture(shops)
    const original = f.send.getMockImplementation()!
    f.send.mockImplementation(async request => request.action === 'relogin'
      ? { ok: false, error: failure } as never
      : original(request))
    render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
    const row = (await screen.findByText('店铺A')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /清除登录并重新登录/ }))
    await screen.findByText(shopBrowserCopy.zh.resetWarning)
    f.send.mockClear()
    fireEvent.click(screen.getByText(shopBrowserCopy.zh.confirmReset))
    await waitFor(() => expect(f.send).toHaveBeenCalledWith({ action: 'relogin', profileId: shops[0].id }))
    expect(f.send.mock.calls.some(([r]) => r.action === 'close' || (r.action === 'relogin' && r.profileId === shops[1].id))).toBe(false)
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes(failure))).toBe(true))
  })

it('rejects an unexpected profile in a successful runtime response', async () => {
  const shops = twoShops()
  const f = fixture(shops)
  const original = f.send.getMockImplementation()!
  f.send.mockImplementation(async request => request.action === 'relogin'
    ? { ok: true, profile: shops[1] } as never : original(request))
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: /清除登录并重新登录/ }))
  fireEvent.click(await screen.findByText(shopBrowserCopy.zh.confirmReset))
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('SHOP_PROFILE_IDENTITY_CHANGED'))).toBe(true))
  expect(f.send.mock.calls.some(([r]) => r.action === 'open')).toBe(false)
})

it('does not submit twice while the runtime authorization is pending', async () => {
  const f = fixture(twoShops())
  render(<ShopBrowserProfilesPanel nativeLayout runtime={f.runtime} />)
  const row = (await screen.findByText('店铺A')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: /清除登录并重新登录/ }))
  const button = await screen.findByText(shopBrowserCopy.zh.confirmReset)
  const original = f.send.getMockImplementation()!
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  f.send.mockImplementation(request => request.action === 'relogin'
    ? new Promise(resolve => { release = resolve }) : original(request))
  f.send.mockClear()
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(f.send.mock.calls.filter(([r]) => r.action === 'relogin')).toHaveLength(1))
  release({ ok: false, error: 'SHOP_PROFILE_FORBIDDEN' } as never)
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('SHOP_PROFILE_FORBIDDEN'))).toBe(true))
})

it('uses the real runtime for an isolated two-shop row reset', async () => {
  const { promises: fs } = await import('node:fs')
  const { default: os } = await import('node:os')
  const { default: path } = await import('node:path')
  const { ShopBrowserRuntime } = await import('../../electron/' + 'shop-browser-runtime')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-row-relogin-'))
  const cleared: string[] = []
  const openedStorage: string[] = []

  const runtime = new ShopBrowserRuntime({
    root,
    authorize: async () => ({ origin: 'https://enterprise.example', tenantId: 'tenant', principalId: 'employee' }),
    isCurrent: () => true,
    clearStorage: async (storage: string) => {
      cleared.push(storage)
      await fs.rm(storage, { recursive: true, force: true })
    },
    createView: async (storage: string) => {
      openedStorage.push(storage)

      return { identify: async () => ({ shopId: 'synthetic-shop', shopName: 'Synthetic' }),
        close: async () => {}, setBounds: () => {} }
    }
  })

  const call = (request: Omit<ShopBrowserRequest, 'sessionId'>) => runtime.operate({ ...request, sessionId: 'test' })

  try {
    const a = (await call({ action: 'create' })).profile!
    const b = (await call({ action: 'create' })).profile!
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    expect((await call({ action: 'open', profileId: a.id, target: 'merchant', bounds })).ok).toBe(true)
    await call({ action: 'close' })
    expect((await call({ action: 'open', profileId: b.id, target: 'merchant', bounds })).ok).toBe(true)
    await call({ action: 'close' })
    const [storageA, storageB] = openedStorage
    expect(storageA).not.toBe(storageB)
    await fs.writeFile(path.join(storageA, 'synthetic-marker'), 'A')
    await fs.writeFile(path.join(storageB, 'synthetic-marker'), 'B')
    const ui = render(<ShopBrowserProfilesPanel nativeLayout runtime={{ shopBrowser: call } as EnterpriseClientRuntime} />)
    await waitFor(() => expect(ui.container.querySelector(`[data-profile-id="${a.id}"]`)).not.toBeNull())
    const row = ui.container.querySelector(`[data-profile-id="${a.id}"]`) as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /清除登录并重新登录/ }))
    fireEvent.click(await screen.findByText(shopBrowserCopy.zh.confirmReset))
    await waitFor(() => expect(cleared).toHaveLength(1))
    expect(cleared).toEqual([storageA])
    await waitFor(async () => expect(await fs.readFile(path.join(storageB, 'synthetic-marker'), 'utf8')).toBe('B'))
    await expect(fs.access(path.join(storageA, 'synthetic-marker'))).rejects.toThrow()
    const after = await call({ action: 'list' })
    expect(after.profiles?.map((p: ShopBrowserProfile) => p.id)).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(after.profiles?.find((p: ShopBrowserProfile) => p.id === a.id)?.loginState).toBe('unverified')
    ui.unmount()
  } finally {
    runtime.invalidate()
    await runtime.revalidate()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('creates, opens, identifies and closes through the typed runtime without business execution', async () => {
  const f = fixture()
  const view = render(<ShopBrowserProfilesPanel runtime={f.runtime} />)
  await screen.findByText('暂无内嵌登录档案')
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.create))
  await screen.findByText('店铺身份未核验')
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ action: 'open', target: 'merchant' }))
  )
  expect(f.send.mock.calls.some(([request]) => request.action === 'identify')).toBe(false)
  await screen.findByText(shopBrowserCopy.zh.loginHint)
  await waitFor(() => expect((screen.getByText(shopBrowserCopy.zh.identify) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.identify))
  await screen.findByText(/店铺身份已核验/)
  await screen.findByText(shopBrowserCopy.zh.sharedReady)
  view.unmount()
  expect(f.send).toHaveBeenCalledWith({ action: 'close' })
  expect(
    f.send.mock.calls.every(([request]) => !['start', 'startPayment', 'openPayment'].includes(request.action))
  ).toBe(true)
})

it('shows completion on a real profiles runtime and cancellation leaves the shop unverified', async () => {
  const { promises: fs } = await import('node:fs')
  const { default: os } = await import('node:os')
  const { default: path } = await import('node:path')
  const { ShopBrowserRuntime } = await import('../../electron/' + 'shop-browser-runtime')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-completion-ui-'))
  const snapshot = { tabs: [{ id: 'tab', title: '模拟', url: 'https://example.test', loading: false,
    canGoBack: false, canGoForward: false }], activeTabId: 'tab', suspended: false }
  const controller = new ShopBrowserRuntime({ root,
    authorize: async () => ({ origin: 'https://example.test', tenantId: 't', principalId: 'p' }),
    isCurrent: () => true, clearStorage: async () => {},
    createView: async () => ({ identify: async () => ({ shopId: '123', shopName: '模拟店铺' }),
      workspace: { snapshot: () => snapshot, operate: async () => snapshot },
      setBounds() {}, close: async () => {} }) })
  const send = vi.fn((request: Omit<ShopBrowserRequest, 'sessionId'>) => controller.operate({ ...request, sessionId: 'test' }))
  try {
    const view = render(<ShopBrowserProfilesPanel runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime} />)
    await screen.findByText('暂无内嵌登录档案')
    fireEvent.click(screen.getByText(shopBrowserCopy.zh.create))
    await screen.findByText(shopBrowserCopy.zh.loginHint)
    await waitFor(() => expect((screen.getByText(shopBrowserCopy.zh.identify) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText(shopBrowserCopy.zh.identify))
    const dialog = await screen.findByRole('dialog', { name: '补全店铺信息' }).catch(error => {
      throw new Error(`${error.message.slice(0, 120)} calls=${send.mock.calls.map(([request]) => request.action).join(',')}`)
    })
    expect(within(dialog).getByText('模拟店铺')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '补全店铺信息' })).toBeNull())
    const list = await controller.operate({ sessionId: 'test', action: 'list' })
    expect(list.profiles![0]).toMatchObject({ shopId: null, loginState: 'unverified' })
    expect(send.mock.calls.some(([request]) => request.action === 'confirmIdentity')).toBe(false)
    view.unmount()
  } finally {
    controller.invalidate()
    await controller.revalidate()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('closes the view before asking for destructive confirmation and does not reset automatically', async () => {
  const f = fixture()
  render(<ShopBrowserProfilesPanel runtime={f.runtime} />)
  await screen.findByText('暂无内嵌登录档案')
  fireEvent.click(screen.getByText(shopBrowserCopy.zh.create))
  await screen.findByText('店铺身份未核验')
  fireEvent.click(screen.getByText('清除登录并重新登录'))
  await screen.findByText('确认清除登录')
  expect(f.send.mock.calls.some(([request]) => request.action === 'relogin')).toBe(false)
  fireEvent.click(screen.getByText('确认清除登录'))
  await waitFor(() => expect(f.send.mock.calls.some(([request]) => request.action === 'relogin')).toBe(true))
})

it('does not let a late profile list from the previous runtime overwrite the new employee view', async () => {
  const old = fixture()
  const next = fixture()
  let release!: (value: unknown) => void
  old.send.mockImplementation(
    () =>
      new Promise(resolve => {
        release = resolve as never
      })
  )
  const view = render(<ShopBrowserProfilesPanel runtime={old.runtime} />)
  await waitFor(() => expect(old.send).toHaveBeenCalledWith({ action: 'list' }))
  const oldRelease = release
  view.rerender(<ShopBrowserProfilesPanel runtime={next.runtime} />)
  await screen.findByText('暂无内嵌登录档案')
  oldRelease({ ok: true, profiles: [{ id: 'old', displayName: '旧员工店铺' }] })
  await waitFor(() => expect(screen.queryByText('旧员工店铺')).toBeNull())
})
