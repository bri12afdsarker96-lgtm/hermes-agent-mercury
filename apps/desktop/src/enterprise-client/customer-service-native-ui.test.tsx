import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { CustomerServiceSnapshot } from '../../electron/customer-service-types'
import type { ShopBrowserProfile, ShopBrowserReply } from '../../electron/shop-browser-types'

import { CustomerServicePreviewPanel } from './customer-service-preview'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'
import { ShopPayoutSettingsButton } from './shop-payout-settings'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const shop: ShopBrowserProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't',
  principalId: 'p',
  displayName: '五元店铺',
  shopName: '五元店铺',
  shopId: '123',
  loginState: 'expired',
  createdAt: '',
  checkedAt: '2026-11-16T00:00:00Z',
  payoutSettings: {
    remitAmount: '5',
    payoutReviewDays: 15,
    payoutRequireReviewWithinDays: false,
    payoutGoodReviewMode: 1,
    payoutRefundChannel: 'small_remit'
  }
}

it('waits for the authoritative list before showing an empty native shop state', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  let resolveList!: (value: { ok: true; profiles: ShopBrowserProfile[] }) => void

  const pending = new Promise<{ ok: true; profiles: ShopBrowserProfile[] }>(resolve => {
    resolveList = resolve
  })

  const view = render(
    <ShopBrowserProfilesPanel
      nativeLayout
      runtime={{ shopBrowser: vi.fn(() => pending) } as unknown as EnterpriseClientRuntime}
    />
  )

  expect(view.container.querySelector('.cs-empty')).toBeNull()
  expect(view.container.querySelector('.cs-summary')?.textContent).not.toContain('0')
  resolveList({ ok: true, profiles: [] })
  await waitFor(() => expect(view.container.querySelector('.cs-empty')).not.toBeNull())
})

it('exports the freshly authorized list and keeps the native two CSV fields and quote escaping', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const create = vi.fn((_blob: Blob) => 'blob:isolated-csv')
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    }
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  let available = [shop]
  const send = vi.fn(async (_request: { action: string }) => ({ ok: true, profiles: available }))
  render(
    <ShopBrowserProfilesPanel nativeLayout runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime} />
  )
  await screen.findByText('五元店铺')
  expect(screen.getByText('5')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('店铺筛选'), { target: { value: 'expired' } })
  available = [{ ...shop, displayName: '授权后店铺', shopName: '授权后店铺"A' }]
  fireEvent.click(screen.getByRole('button', { name: '一键导出' }))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())

  const csv = await new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(create.mock.calls[0][0] as Blob)
  })

  expect(csv).toBe('店铺名,打款金额\r\n"授权后店铺""A","5"')
  expect(send.mock.calls.length).toBe(2)
})

it('keeps the five-field settings draft visible when the cloud write is unavailable and allows retry', async () => {
  const send = vi.fn(async (): Promise<ShopBrowserReply> => ({
    ok: false,
    error: 'SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE'
  }))

  const refreshed = vi.fn(async () => {})
  render(
    <ShopPayoutSettingsButton
      onSaved={refreshed}
      profile={shop}
      runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '店铺设置' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toContain('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
  expect((screen.getByLabelText('每单打款金额') as HTMLInputElement).value).toBe('5')
  expect(refreshed).not.toHaveBeenCalled()
  send.mockResolvedValueOnce({ ok: true })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(send.mock.calls).toHaveLength(2)
})

it('keeps the four native columns, clears only displayed login warnings, and saves rule fields through the existing runtime', async () => {
  const snapshot: CustomerServiceSnapshot = {
    revision: 2,
    profile: shop,
    rules: [],
    conversations: [],
    tasks: [],
    events: []
  }

  const send = vi.fn(async (_request: { action: string }) => ({ ok: true, snapshot }))
  const runtime = { customerService: send } as unknown as EnterpriseClientRuntime

  const view = render(
    <CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={runtime} view="workbench" />
  )

  await screen.findByText('需重新登录', { selector: 'h4' })
  expect(view.container.querySelector('.cs-work-columns')?.children).toHaveLength(4)
  fireEvent.change(screen.getByLabelText('店铺筛选'), { target: { value: 'pending' } })
  expect(view.container.querySelectorAll('.cs-work-shop')).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('店铺筛选'), { target: { value: 'all' } })
  expect(view.container.querySelectorAll('.cs-work-shop')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '清空' }))
  await screen.findByText('暂无需重新登录的档案')
  expect(send.mock.calls.length).toBe(1)
  view.rerender(<CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={runtime} view="rules" />)
  fireEvent.click(await screen.findByRole('button', { name: '新增规则' }))
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '需要人工' } })
  fireEvent.change(screen.getByLabelText('回复内容'), { target: { value: '正在为您处理' } })
  fireEvent.click(screen.getByLabelText('转人工'))
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }))
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'saveRule',
        profileId: shop.id,
        expectedRevision: 2,
        rule: expect.objectContaining({ name: '需要人工', priority: 500, reply: '正在为您处理', transferHuman: true })
      })
    )
  )
  expect(send.mock.calls.every(([request]) => ['snapshot', 'saveRule'].includes(request.action))).toBe(true)
})
