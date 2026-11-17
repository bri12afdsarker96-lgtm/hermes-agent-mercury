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

it('keeps local test conversations out of the real reception workbench', async () => {
  const snapshot: CustomerServiceSnapshot = {
    revision: 2, profile: shop, rules: [],
    conversations: [{id: 'local-test-customer', mode: 'pending', version: 1, lastMatched: []}],
    tasks: [{id:'local-task', conversationId:'local-test-customer', reason:'test', status:'pending', seen:false, createdAt:1}],
    events: [{id:'event', at:1, conversationId:'local-test-customer', action:'send_message', detail:'local-test-reply'}]
  }

  const send = vi.fn(async () => ({ok:true, snapshot}))
  render(<CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={{customerService:send} as unknown as EnterpriseClientRuntime} view="workbench" />)
  expect(await screen.findByText('接待服务未接入')).toBeTruthy()
  expect(screen.queryByText('local-test-customer')).toBeNull()
  expect(screen.queryByText('local-test-reply')).toBeNull()
  expect(send).not.toHaveBeenCalled()
})

it('refreshes authorized shops without requesting a local preview snapshot', async () => {
  const send = vi.fn()
  const refresh = vi.fn()
  render(<CustomerServicePreviewPanel onRefresh={refresh} profileId={shop.id} profiles={[shop]} runtime={{customerService:send} as unknown as EnterpriseClientRuntime} view="workbench" />)
  fireEvent.click(screen.getByRole('button', {name:'刷新'}))
  expect(refresh).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalled()
})

it('keeps the pending shop filter unavailable while reception data is not connected', () => {
  render(<CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={{} as EnterpriseClientRuntime} view="workbench" />)
  expect((screen.getByRole('option', {name:'待处理'}) as HTMLOptionElement).disabled).toBe(true)
  expect(screen.getByLabelText('店铺筛选')).toBeTruthy()
})

it('offers local rule testing explicitly with an empty conversation and visible test history', async () => {
  const snapshot: CustomerServiceSnapshot = {
    revision: 2, profile: shop, rules: [], conversations: [], tasks: [],
    events: [{id:'event', at:1, conversationId:'old-test', action:'send_message', detail:'earlier-test-reply'}]
  }

  const send = vi.fn(async () => ({ok:true, snapshot}))
  render(<CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={{customerService:send} as unknown as EnterpriseClientRuntime} view="rules" />)
  fireEvent.click(await screen.findByText('规则测试'))
  expect(await screen.findByText('earlier-test-reply')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name:'模拟接收消息'}))
  expect((screen.getByLabelText('会话编号') as HTMLInputElement).value).toBe('')
})

it('runs a local rule test with the selected profile and displays its recorded result', async () => {
  const snapshot: CustomerServiceSnapshot = {revision: 2, profile: shop, rules: [], conversations: [], tasks: [], events: []}

  const result: CustomerServiceSnapshot = {
    ...snapshot, revision: 3,
    events: [{id:'result', at:1, conversationId:'test-123', action:'send_message', detail:'test-result-only'}]
  }

  const send = vi.fn(async (request: {action:string}) => ({ok:true, snapshot:request.action === 'simulate' ? result : snapshot}))
  render(<CustomerServicePreviewPanel profileId={shop.id} profiles={[shop]} runtime={{customerService:send} as unknown as EnterpriseClientRuntime} view="rules" />)
  fireEvent.click(await screen.findByText('规则测试'))
  fireEvent.click(await screen.findByRole('button', {name:'模拟接收消息'}))
  fireEvent.change(screen.getByLabelText('会话编号'), {target:{value:'test-123'}})
  fireEvent.change(screen.getByLabelText('消息内容'), {target:{value:'test input'}})
  fireEvent.click(screen.getByRole('button', {name:'运行模拟'}))
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({action:'simulate', profileId:shop.id, expectedRevision:2, message:expect.objectContaining({conversationId:'test-123', text:'test input'})})))
  expect((await screen.findAllByText('test-result-only')).length).toBeGreaterThan(0)
})

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

it('requests the authorized export independently of the visible shop filter', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )

  const send = vi.fn(async (request: { action: string }) => request.action === 'exportCsv'
    ? {ok:true, exportResult:{status:'saved', count:1}}
    : {ok:true, profiles:[shop]})

  render(
    <ShopBrowserProfilesPanel nativeLayout runtime={{ shopBrowser: send } as unknown as EnterpriseClientRuntime} />
  )
  await screen.findByText('五元店铺')
  expect(screen.getByText('5')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('店铺筛选'), { target: { value: 'expired' } })
  fireEvent.click(screen.getByRole('button', { name: '一键导出' }))
  expect(await screen.findByText(/导出成功.*1/)).toBeTruthy()
  expect(send).toHaveBeenCalledWith({action:'exportCsv', locale:'zh'})
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
  expect(view.container.querySelectorAll('.cs-work-shop')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '清空' }))
  await screen.findByText('暂无需重新登录的档案')
  expect(send.mock.calls.length).toBe(0)
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
