import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))

it.each([
  ['synced', '云端同步完成，可在其他电脑恢复本人有权使用的店铺。'],
  ['unavailable', '云端同步暂不可用。云端店铺暂不可用，请稍后刷新。'],
  ['conflict', '云端档案有新版本，请刷新后核验店铺。']
])('shows the actual %s cloud status without exposing a session payload', async (state, text) => {
  const runtime = {
    shopBrowser: vi.fn(async () => ({ ok: true, profiles: [], cloud: { state, checkedAt: '2026-11-16T00:00:00Z' } }))
  } as unknown as EnterpriseClientRuntime

  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={runtime} />)
  expect((await screen.findByTestId('shop-cloud-status')).textContent).toBe(text)
  expect(screen.queryByText('synthetic-value')).toBeNull()
  view.unmount()
})

it('removes the transferred shop and its selection on periodic refresh even without an open browser', async () => {
  let transferred = false

  const profile = {
    id: 'shop-a',
    displayName: 'Transferred shop',
    tenantId: 'tenant-a',
    principalId: 'employee-a',
    shopId: '12345',
    shopName: 'Transferred shop',
    createdAt: '2026-11-16T00:00:00Z',
    checkedAt: null,
    loginState: 'verified'
  }

  const selected = vi.fn()

  const runtime = {
    get: vi.fn(async () => ({ role: 'operator' })),
    shopBrowser: vi.fn(async () => ({ ok: true, profiles: transferred ? [] : [profile], openProfileId: null }))
  } as unknown as EnterpriseClientRuntime

  vi.useFakeTimers()

  const view = render(
    <ShopBrowserProfilesPanel nativeLayout onSelectedProfile={selected} runtime={runtime} selectedProfileId="shop-a" />
  )

  try {
    await act(async () => {})
    expect(screen.getAllByText('Transferred shop').length).toBeGreaterThan(0)
    transferred = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(screen.queryAllByText('Transferred shop')).toHaveLength(0)
    expect(selected).toHaveBeenCalledWith('')
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

it('clears the preceding tenant cloud status as soon as runtime changes', async () => {
  const first = {
    shopBrowser: vi.fn(async () => ({
      ok: true,
      profiles: [],
      cloud: { state: 'synced', checkedAt: '2026-11-16T00:00:00Z' }
    }))
  } as unknown as EnterpriseClientRuntime

  const second = { shopBrowser: vi.fn(() => new Promise(() => {})) } as unknown as EnterpriseClientRuntime
  const view = render(<ShopBrowserProfilesPanel nativeLayout runtime={first} />)
  await screen.findByTestId('shop-cloud-status')
  view.rerender(<ShopBrowserProfilesPanel nativeLayout runtime={second} />)
  expect(screen.queryByTestId('shop-cloud-status')).toBeNull()
  view.unmount()
})
