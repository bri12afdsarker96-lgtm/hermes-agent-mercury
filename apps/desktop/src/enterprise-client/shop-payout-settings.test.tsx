import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopPayoutSettingsButton } from './shop-payout-settings'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))

const profile: ShopBrowserProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: '设置测试店铺',
  tenantId: 't',
  principalId: 'p',
  shopId: '123',
  shopName: '设置测试店铺',
  createdAt: '',
  checkedAt: null,
  loginState: 'verified'
}

it('saves the native fields explicitly at five yuan and preserves the refund channel values', async () => {
  const send = vi.fn(async () => ({ ok: true }))
  const refreshed = vi.fn(async () => {})
  render(
    <ShopPayoutSettingsButton
      onSaved={refreshed}
      profile={profile}
      runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '店铺设置' }))
  expect((screen.getByLabelText('每单打款金额') as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('每单打款金额'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('退款渠道'), { target: { value: 'refund_only' } })
  fireEvent.click(screen.getByLabelText('要求评价在上述天数内'))
  fireEvent.change(screen.getByLabelText('好评判定模式'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
  expect(send).toHaveBeenCalledExactlyOnceWith({
    action: 'savePayoutSettings',
    profileId: profile.id,
    expectedRevision: 0,
    payoutSettings: {
      remitAmount: '5',
      payoutReviewDays: 15,
      payoutRequireReviewWithinDays: true,
      payoutGoodReviewMode: 0,
      payoutRefundChannel: 'refund_only'
    }
  })
})

it('rejects invalid days and keeps a conflicting edit visible for review', async () => {
  const send = vi.fn(async () => ({ ok: false, error: 'SHOP_PAYOUT_SETTINGS_CONFLICT' }))
  render(
    <ShopPayoutSettingsButton
      onSaved={async () => {}}
      profile={profile}
      runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '店铺设置' }))
  fireEvent.change(screen.getByLabelText('每单打款金额'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('评价天数上限'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(send).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('评价天数上限'), { target: { value: '15' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('配置已在另一页面更新，请关闭并重新打开设置。')
  expect((screen.getByLabelText('每单打款金额') as HTMLInputElement).value).toBe('5')
})

it('opens completion without a preset amount and confirms the candidate with user settings', async () => {
  const send = vi.fn(async () => ({ ok: true }))
  const saved = vi.fn(async () => {})
  render(<ShopPayoutSettingsButton onSaved={saved} profile={profile}
    pendingIdentity={{ profileId: profile.id, shopId: '123', shopName: profile.displayName, token: 'candidate' }}
    onCancelPending={() => {}} runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime} />)
  expect(await screen.findByRole('dialog', { name: '补全店铺信息' })).toBeTruthy()
  expect((screen.getByLabelText('每单打款金额') as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('每单打款金额'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirmIdentity', pendingToken: 'candidate', profileId: profile.id }))
})

it('cancels a pending identity without saving settings', async () => {
  const send = vi.fn(async () => ({ ok: true }))
  const canceled = vi.fn()
  render(<ShopPayoutSettingsButton onSaved={async () => {}} profile={profile}
    pendingIdentity={{ profileId: profile.id, shopId: '123', shopName: profile.displayName, token: 'candidate' }}
    onCancelPending={canceled} runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime} />)
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  expect(canceled).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalled()
})
