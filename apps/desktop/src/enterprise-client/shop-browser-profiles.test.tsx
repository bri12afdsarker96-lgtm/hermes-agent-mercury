import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ShopBrowserProfile, ShopBrowserRequest } from '../../electron/shop-browser-types'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh' }) }))
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  let profiles: ShopBrowserProfile[] = []
  let openProfileId: string | null = null
  const send = vi.fn(async (request: Omit<ShopBrowserRequest, 'sessionId'>) => {
    if (request.action === 'list') return { ok: true, profiles, openProfileId }
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
    if (request.action === 'open') openProfileId = request.profileId!
    if (request.action === 'close') openProfileId = null
    if (request.action === 'identify')
      profiles = profiles.map(profile => ({
        ...profile,
        shopId: '123',
        shopName: '识别店铺',
        displayName: '识别店铺',
        loginState: 'verified'
      }))
    if (request.action === 'relogin')
      profiles = profiles.map(profile => ({ ...profile, shopId: null, shopName: null, loginState: 'unverified' }))
    if (request.action === 'delete') profiles = []
    return { ok: true, openProfileId }
  })
  const runtime = { shopBrowser: send } as unknown as EnterpriseClientRuntime
  return { send, runtime }
}

it('creates, opens, identifies and closes through the typed runtime without business execution', async () => {
  const f = fixture()
  const view = render(<ShopBrowserProfilesPanel runtime={f.runtime} />)
  await screen.findByText('暂无内嵌登录档案')
  fireEvent.click(screen.getByText('新增登录档案'))
  await screen.findByText('店铺身份未核验')
  fireEvent.click(screen.getByText('打开店铺后台'))
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ action: 'open', target: 'merchant' }))
  )
  await waitFor(() => expect((screen.getByText('识别当前店铺') as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByText('识别当前店铺'))
  await screen.findByText(/店铺身份已核验/)
  view.unmount()
  expect(f.send).toHaveBeenCalledWith({ action: 'close' })
  expect(
    f.send.mock.calls.every(([request]) => !['start', 'startPayment', 'openPayment'].includes(request.action))
  ).toBe(true)
})

it('closes the view before asking for destructive confirmation and does not reset automatically', async () => {
  const f = fixture()
  render(<ShopBrowserProfilesPanel runtime={f.runtime} />)
  await screen.findByText('暂无内嵌登录档案')
  fireEvent.click(screen.getByText('新增登录档案'))
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
