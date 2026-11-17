import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode, RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { shopBrowserCopy } from '@/i18n/shop-browser'
import type { Locale } from '@/i18n/types'
import { zh } from '@/i18n/zh'

import type { CustomerServiceReply, CustomerServiceRequest } from '../../electron/customer-service-types'
import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'
import type { BoundShopExecution } from '../../electron/shop-browser-execution'
import type { ShopBrowserBounds, ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest } from '../../electron/shop-browser-types'

import { CustomerServicePage } from './customer-service-page'
import { DoudianShopManagement } from './doudian-shop-management'
import { PaymentPage } from './payment-page'
import { ReviewCapturePage } from './review-capture-page'
import type { EnterpriseClientRuntime } from './runtime'

// The native viewport is supplied by Electron. Keep profile/controller/storage
// behavior real while replacing Chromium and the TD process with offline adapters.
vi.mock('./shop-browser-workspace', () => ({
  ShopBrowserWorkspacePanel: ({ viewportRef }: { viewportRef: RefObject<HTMLDivElement | null> }) =>
    <div data-testid="native-viewport" ref={viewportRef} />
}))

type ShopBrowserAuthority = Pick<ShopBrowserProfile, 'tenantId' | 'principalId'> & { origin: string }
interface ProfileController {
  operate(request: ShopBrowserRequest): Promise<ShopBrowserReply>
  acquireExecution(profileId: string, target: 'merchant' | 'feige'): Promise<BoundShopExecution>
  invalidate(): void
  revalidate(): Promise<void>
}

const fixtures: { root: string; profiles: ProfileController; doudian: { close(): void } }[] = []
const observed: { element: Element; resize: () => void }[] = []
const bounds = { x: 0, y: 0, width: 800, height: 600 }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private resize: () => void) {}
    observe(element: Element) { observed.push({ element, resize: this.resize }) }
    disconnect() {}
  })
})

afterEach(async () => {
  cleanup()
  observed.length = 0

  for (const f of fixtures.splice(0)) {
    f.doudian.close()
    f.profiles.invalidate()
    await fs.rm(f.root, { recursive: true, force: true })
  }

  vi.unstubAllGlobals()
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-shared-shop-flow-'))
  const workbook = path.join(root, 'copy.xlsx')
  await fs.writeFile(workbook, 'offline workbook fixture')
  let current = true
  let scope: ShopBrowserAuthority = { origin: 'https://enterprise.example', tenantId: 'tenant-a', principalId: 'seat-a' }
  let identity: { shopId: string; shopName: string } | null = { shopId: '10001', shopName: 'Verified shop A' }
  const identify = vi.fn(async () => identity)
  const setBounds = vi.fn()
  const closeView = vi.fn(async () => {})
  const createView = vi.fn(async (_storage: string, _target: 'merchant' | 'feige', _bounds: ShopBrowserBounds) => ({ identify, setBounds, close: closeView }))
  const command = vi.fn(async () => ({}))
  const closeExecution = vi.fn(async () => {})

  const createExecution = vi.fn(async (_storage: string, _target: 'merchant' | 'feige') => {
    return { identify, command, close: closeExecution }
  })

  const profileDependencies = {
    root: path.join(root, 'profiles'),
    authorize: async () => scope,
    isCurrent: () => current,
    createView,
    createExecution,
    clearStorage: vi.fn(async () => {})
  }

  // Load the real main modules through Vitest so renderer typechecking keeps its
  // own strict configuration. Calls still use the shared IPC and execution types.
  const { ShopBrowserProfiles } = await vi.importActual<{
    ShopBrowserProfiles: new (dependencies: typeof profileDependencies) => ProfileController
  }>('../../electron/shop-browser-profiles')

  const profiles = new ShopBrowserProfiles(profileDependencies)

  const shopBrowser = vi.fn((request: Omit<ShopBrowserRequest, 'sessionId'>) =>
    profiles.operate({ ...request, sessionId: 'session-a' }))

  const listBrowserProfiles = async () => {
    const result = await profiles.operate({ sessionId: 'session-a', action: 'list' })

    if (!result.ok) { throw new Error(result.error) }

    return result.profiles ?? []
  }

  const customerDependencies = {
    root: path.join(root, 'customer'),
    isCurrent: () => current,
    authorize: async (profileId: string) => {
      const profile = (await listBrowserProfiles()).find(item => item.id === profileId)

      if (!profile) { throw new Error('CUSTOMER_PROFILE_NOT_FOUND') }

      return { ...scope, profile }
    }
  }

  const { CustomerServicePreview } = await vi.importActual<{
    CustomerServicePreview: new (dependencies: typeof customerDependencies) => {
      operate(request: CustomerServiceRequest): Promise<CustomerServiceReply>
    }
  }>('../../electron/customer-service-preview')

  const customer = new CustomerServicePreview(customerDependencies)
  let task: DoudianTask = { kind: 'review', taskId: null, state: 'idle', saved: 0, summary: '', error: '', messages: [] }

  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string, _args?: Record<string, string>) => {
      if (method === 'initialize') {
        return { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1' }
      }

      if (method === 'capabilities') {
        return { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1', chrome: true, spreadsheet: true, embeddedBrowser: 1, reviewOptions: 1, paymentControls: 1, paymentCdp: 1, shopManagement: 0 }
      }

      if (method === 'shops') { return [] }

      if (method === 'prepare' || method === 'preparePayment') {
        task = { ...task, kind: method === 'prepare' ? 'review' : 'payment', taskId: 'a'.repeat(32), state: 'awaiting_confirmation' }
      } else if (method === 'stop') {
        task = { ...task, state: 'stopped' }
      } else if (method !== 'status') {
        throw new Error(`Unexpected offline host action ${method}`)
      }

      return task
    })
  }

  const connectBrowser = vi.fn((profileId: string, target: 'merchant' | 'feige') => profiles.acquireExecution(profileId, target))

  const doudianDependencies = {
    platform: 'win32', root, authorize: async () => JSON.stringify(scope), isCurrent: () => current,
    verify: async () => 'offline-host', chooseWorkbook: async () => workbook,
    createHost: () => host, listBrowserProfiles, connectBrowser
  }

  const { DoudianController } = await vi.importActual<{
    DoudianController: new (dependencies: typeof doudianDependencies) => {
      operate(request: DoudianRequest): Promise<DoudianReply>
      close(): void
    }
  }>('../../electron/doudian-host')

  const doudian = new DoudianController(doudianDependencies)

  const runtime: EnterpriseClientRuntime = {
    serverOrigin: scope.origin,
    doudian: vi.fn((request: Omit<DoudianRequest, 'sessionId'>) => doudian.operate({ ...request, sessionId: 'session-a' })),
    shopBrowser,
    customerService: vi.fn(request => customer.operate({ ...request, sessionId: 'session-a' })),
    disconnect: async () => {}, get: async () => { throw new Error('No network in offline fixture') }
  }

  const f = {
    root, profiles, runtime, doudian, host, shopBrowser, identify, createView, createExecution,
    connectBrowser, listBrowserProfiles, setBounds, command, closeExecution,
    restartProfiles: () => new ShopBrowserProfiles(profileDependencies),
    setIdentity: (next: typeof identity) => { identity = next },
    setScope: (next: ShopBrowserAuthority) => { scope = next },
    logout: () => { current = false; profiles.invalidate() }
  }

  fixtures.push(f)

  return f
}

function localized(content: ReactNode, locale: Locale = 'zh') {
  return <I18nProvider configClient={null} initialLocale={locale}>{content}</I18nProvider>
}

async function addShop(f: Awaited<ReturnType<typeof fixture>>) {
  await clickWhenReady(shopBrowserCopy.zh.create)
  await waitFor(() => expect(f.createView).toHaveBeenCalledOnce())
  await waitFor(() => expect((screen.getAllByRole('button', { name: shopBrowserCopy.zh.identify })[0] as HTMLButtonElement).disabled).toBe(false))

  return (await f.listBrowserProfiles())[0]
}

async function clickWhenReady(name: string) {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}

async function verifyShop() {
  fireEvent.click(screen.getAllByRole('button', { name: shopBrowserCopy.zh.identify })[0])
  const dialog = await screen.findByRole('dialog', { name: '补全店铺信息' })
  fireEvent.change(within(dialog).getByLabelText('每单打款金额'), { target: { value: '5' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
  await screen.findByText(shopBrowserCopy.zh.sharedReady)
}

async function confirmShop(f: Awaited<ReturnType<typeof fixture>>, profileId: string) {
  const result = await f.shopBrowser({ action: 'identify', profileId })
  expect(result.pendingIdentity).toBeDefined()
  const confirmed = await f.shopBrowser({ action: 'confirmIdentity', profileId,
    pendingToken: result.pendingIdentity!.token, payoutSettings: {
      remitAmount: '5', payoutReviewDays: 15, payoutRequireReviewWithinDays: true,
      payoutGoodReviewMode: 0, payoutRefundChannel: 'small_remit'
    } })
  expect(confirmed.ok).toBe(true)
}

describe('shared shop flow through real controllers and temporary profile storage', () => {
  it('adds and verifies once, then uses the same ID and storage for capture, payment and Feige', async () => {
    const f = await fixture()
    const view = render(localized(<CustomerServicePage runtime={f.runtime} />))
    const draft = await addShop(f)
    expect(f.createView.mock.calls[0][1]).toBe('merchant')
    expect(f.identify).not.toHaveBeenCalled()
    expect((await f.runtime.doudian!({ action: 'shops' })).shops).toEqual([])
    expect(draft.loginState).toBe('unverified')
    await verifyShop()
    const profile = (await f.listBrowserProfiles())[0]
    expect(profile).toMatchObject({ id: draft.id, shopId: '10001', loginState: 'verified' })
    const restarted = f.restartProfiles()
    expect((await restarted.operate({ sessionId: 'restarted', action: 'list' })).profiles).toEqual([profile])
    restarted.invalidate()

    fireEvent.click(screen.getByRole('button', { name: shopBrowserCopy.zh.feige }))
    await waitFor(() => expect(f.createView).toHaveBeenCalledTimes(2))
    const storage = f.createView.mock.calls[0][0]
    expect(f.createView.mock.calls[1]).toEqual([storage, 'feige', expect.any(Object)])
    fireEvent.click(screen.getByRole('button', { name: customerServiceCopy.zh.rules }))
    await screen.findByText(customerServiceCopy.zh.emptyRules)
    expect(f.runtime.customerService).toHaveBeenCalledWith({ action: 'rulesSnapshot', profileId: profile.id })
    const customer = await f.runtime.customerService!({ action: 'snapshot', profileId: profile.id })
    expect(customer.snapshot?.profile).toEqual(profile)

    view.rerender(localized(<ReviewCapturePage runtime={f.runtime} />))
    await screen.findByRole('option', { name: 'Verified shop A (10001)' })
    fireEvent.change(screen.getByRole('combobox', { name: zh.doudian.shop }), { target: { value: profile.id } })
    fireEvent.click(screen.getByRole('button', { name: zh.doudian.chooseWorkbook }))
    await screen.findByText('copy.xlsx')
    fireEvent.click(screen.getByRole('button', { name: zh.doudian.prepare }))
    await screen.findByRole('button', { name: zh.doudian.confirmStart })
    expect(f.connectBrowser).toHaveBeenLastCalledWith(profile.id, 'merchant')
    expect(f.createExecution).toHaveBeenLastCalledWith(storage, 'merchant')
    fireEvent.click(screen.getByRole('button', { name: zh.doudian.stop }))
    await waitFor(() => expect(screen.queryByRole('button', { name: zh.doudian.confirmStart })).toBeNull())

    view.rerender(localized(<PaymentPage runtime={f.runtime} />))
    const paymentOption = await screen.findByRole('option', { name: 'Verified shop A (10001)' })
    expect((paymentOption as HTMLOptionElement).value).toBe(profile.id)
    fireEvent.change(screen.getByRole('combobox', { name: shopBrowserCopy.zh.profile }), { target: { value: profile.id } })
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('copy.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '0.01' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText('等待确认开始')
    expect(f.connectBrowser).toHaveBeenLastCalledWith(profile.id, 'feige')
    expect(f.createExecution).toHaveBeenLastCalledWith(storage, 'feige')
    expect(f.host.request.mock.calls.some(([method]) => ['start', 'startPayment', 'openPayment', 'openFeige', 'manageShops'].includes(method))).toBe(false)
    expect(f.command).not.toHaveBeenCalled()
  })

  it.each(['capture', 'payment'] as const)('refreshes shared shops and preserves the %s form when returning from management', async page => {
    const f = await fixture()
    render(localized(page === 'capture' ? <ReviewCapturePage runtime={f.runtime} /> : <PaymentPage runtime={f.runtime} />))
    await clickWhenReady(customerServiceLayoutCopy.zh.title)
    await screen.findByTestId('customer-service-page')
    const draft = await addShop(f)
    expect((await f.runtime.doudian!({ action: 'shops' })).shops).toEqual([])
    await verifyShop()
    fireEvent.click(screen.getByRole('button', { name: zh.common.back }))
    const option = await screen.findByRole('option', { name: 'Verified shop A (10001)' })
    expect((option as HTMLOptionElement).value).toBe(draft.id)
    const shopLabel = page === 'capture' ? zh.doudian.shop : shopBrowserCopy.zh.profile
    fireEvent.change(screen.getByRole('combobox', { name: shopLabel }), { target: { value: draft.id } })
    await clickWhenReady(page === 'capture' ? zh.doudian.chooseWorkbook : '选择工作簿')
    await screen.findByText('copy.xlsx')
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(/最多行/), { target: { value: '13' } })

    if (page === 'capture') {
      fireEvent.change(screen.getByLabelText('截图并发'), { target: { value: '2' } })
    } else {
      fireEvent.change(screen.getByLabelText('金额'), { target: { value: '0.02' } })
    }

    await clickWhenReady(customerServiceLayoutCopy.zh.title)
    await screen.findByTestId('customer-service-page')
    await clickWhenReady(zh.common.back)
    await screen.findByRole('option', { name: 'Verified shop A (10001)' })
    await waitFor(() => expect((screen.getByRole('combobox', { name: shopLabel }) as HTMLSelectElement).value).toBe(draft.id))
    expect(screen.getByText('copy.xlsx')).toBeTruthy()
    expect((screen.getByLabelText('起始行') as HTMLInputElement).value).toBe('7')
    expect((screen.getByLabelText(/最多行/) as HTMLInputElement).value).toBe('13')
    expect((screen.getByLabelText(page === 'capture' ? '截图并发' : '金额') as HTMLInputElement).value).toBe(page === 'capture' ? '2' : '0.02')
    expect(f.host.request.mock.calls.some(([method]) => method.startsWith('shopManagement') || ['manageShops', 'shopLoginStart'].includes(method))).toBe(false)
    expect(f.host.request.mock.calls.some(([method]) => ['prepare', 'preparePayment', 'start', 'startPayment'].includes(method))).toBe(false)
  })

  it.each(['capture', 'payment'] as const)('excludes an unverified new profile from the %s options', async page => {
    const f = await fixture()
    render(localized(page === 'capture' ? <ReviewCapturePage runtime={f.runtime} /> : <PaymentPage runtime={f.runtime} />))
    await clickWhenReady(customerServiceLayoutCopy.zh.title)
    const draft = await addShop(f)
    await clickWhenReady(zh.common.back)
    await screen.findByTestId(page === 'capture' ? 'doudian-workbench' : 'payment-page')
    await waitFor(() => expect(screen.queryByRole('option', { name: /10001|店铺登录/ })).toBeNull())
    expect((await f.runtime.doudian!({ action: 'shops' })).shops).toEqual([])
    expect((await f.listBrowserProfiles())[0]).toMatchObject({ id: draft.id, loginState: 'unverified' })
    expect(f.connectBrowser).not.toHaveBeenCalled()
  })

  it('routes new shops from the legacy manager into the same shared management page', async () => {
    const f = await fixture()
    render(localized(<DoudianShopManagement onChanged={async () => {}} onClose={() => {}} operationsSupported runtime={f.runtime} />))
    await clickWhenReady(customerServiceLayoutCopy.zh.title)
    await screen.findByTestId('customer-service-page')
    await addShop(f)
    expect(f.host.request.mock.calls.some(([method]) => ['shopManagementAdd', 'shopLoginStart', 'manageShops'].includes(method))).toBe(false)
  })

  it('retains the created profile when opening fails and retries login without creating another profile', async () => {
    const f = await fixture()
    f.createView.mockRejectedValueOnce(new Error('SHOP_PROFILE_PAGE_NOT_READY'))
    render(localized(<CustomerServicePage runtime={f.runtime} />))
    await clickWhenReady(shopBrowserCopy.zh.create)
    await screen.findByRole('alert')
    const draft = (await f.listBrowserProfiles())[0]
    await clickWhenReady(shopBrowserCopy.zh.merchant)
    await screen.findByTestId('native-viewport')
    expect(f.shopBrowser.mock.calls.filter(([request]) => request.action === 'create')).toHaveLength(1)
    expect((await f.listBrowserProfiles()).map(profile => profile.id)).toEqual([draft.id])
    expect(f.createView.mock.calls[1][0]).toBe(f.createView.mock.calls[0][0])
  })

  it('keeps the login page usable after a recoverable identity failure and saves only after a successful retry', async () => {
    const f = await fixture()
    render(localized(<CustomerServicePage runtime={f.runtime} />))
    const draft = await addShop(f)
    f.identify.mockRejectedValueOnce(new Error('SHOP_PROFILE_PAGE_NOT_READY'))
    fireEvent.click(screen.getAllByRole('button', { name: shopBrowserCopy.zh.identify })[0])
    await screen.findAllByRole('alert')
    expect((await f.listBrowserProfiles())[0]).toMatchObject({ id: draft.id, loginState: 'unverified' })
    expect((await f.runtime.doudian!({ action: 'shops' })).shops).toEqual([])
    expect(screen.getByTestId('native-viewport')).toBeTruthy()
    await waitFor(() => expect((screen.getAllByRole('button', { name: shopBrowserCopy.zh.identify })[0] as HTMLButtonElement).disabled).toBe(false))
    await verifyShop()
    expect((await f.runtime.doudian!({ action: 'shops' })).shops?.[0].browserProfileId).toBe(draft.id)
    expect(f.createView).toHaveBeenCalledOnce()
  })

  it('restores a visible native viewport after creating with zero initial bounds', async () => {
    const f = await fixture()
    render(localized(<CustomerServicePage runtime={f.runtime} />))
    await addShop(f)
    expect(f.createView.mock.calls[0][2]).toMatchObject({ width: 0, height: 0 })
    const viewport = screen.getByTestId('native-viewport')
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 100, 800, 500))
    await act(async () => {
      observed.find(item => item.element === viewport)!.resize()
    })
    await waitFor(() => expect(f.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 100, width: 800, height: 500 }))
  })

  it.each(['logout', 'tenant', 'principal', 'origin'] as const)('invalidates all three consumers on %s', async change => {
    const f = await fixture()
    const profile = (await f.shopBrowser({ action: 'create' })).profile!
    await f.shopBrowser({ action: 'open', profileId: profile.id, target: 'merchant', bounds })
    await confirmShop(f, profile.id)
    expect((await f.runtime.doudian!({ action: 'shops' })).shops?.[0].id).toBe(profile.id)
    const execution = await f.profiles.acquireExecution(profile.id, 'feige')

    if (change === 'logout') {
      f.logout()
    } else {
      f.setScope({
        origin: change === 'origin' ? 'https://other.example' : 'https://enterprise.example',
        tenantId: change === 'tenant' ? 'tenant-b' : 'tenant-a',
        principalId: change === 'principal' ? 'seat-b' : 'seat-a'
      })
      await f.profiles.revalidate()
    }

    expect((await f.shopBrowser({ action: 'list' })).ok).toBe(false)
    expect((await f.runtime.doudian!({ action: 'shops' })).error).toBe('DOUDIAN_OWNER_CHANGED')
    expect((await f.runtime.customerService!({ action: 'snapshot', profileId: profile.id })).ok).toBe(false)
    await expect(execution.command('root', 'Runtime.evaluate', {})).rejects.toThrow('SHOP_PROFILE_OWNER_CHANGED')
    expect(f.closeExecution).toHaveBeenCalledOnce()
  })

  it('clears shared rows and selection when main rejects the current tenant authority', async () => {
    const f = await fixture()
    render(localized(<CustomerServicePage runtime={f.runtime} />))
    await addShop(f)
    await verifyShop()
    f.setScope({ origin: 'https://enterprise.example', tenantId: 'tenant-b', principalId: 'seat-b' })
    await clickWhenReady(shopBrowserCopy.zh.refresh)
    await screen.findByRole('alert')
    expect(screen.queryByText('Verified shop A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: customerServiceCopy.zh.rules }))
    expect((await screen.findByRole('alert')).textContent).toContain('SHOP_PROFILE_OWNER_CHANGED')
    expect(screen.queryByText(customerServiceLayoutCopy.zh.noProfile)).toBeNull()
    expect(f.runtime.customerService).not.toHaveBeenCalled()
  })

  it('clears old rows and selection on runtime changes and ignores a late list from the old tenant', async () => {
    const old = await fixture()
    const next = await fixture()
    const view = render(localized(<CustomerServicePage runtime={old.runtime} />))
    await addShop(old)
    await verifyShop()
    let release!: (reply: ShopBrowserReply) => void
    const oldList = await old.shopBrowser({ action: 'list' })
    const original = old.shopBrowser.getMockImplementation()!
    old.shopBrowser.mockImplementation(request => request.action === 'list'
      ? new Promise(resolve => { release = resolve }) : original(request))
    fireEvent.click(screen.getByRole('button', { name: shopBrowserCopy.zh.refresh }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    next.setScope({ origin: 'https://enterprise.example', tenantId: 'tenant-b', principalId: 'seat-b' })
    next.setIdentity({ shopId: '20002', shopName: 'Verified shop B' })
    const nextProfile = (await next.shopBrowser({ action: 'create' })).profile!
    await next.shopBrowser({ action: 'open', profileId: nextProfile.id, target: 'merchant', bounds })
    await confirmShop(next, nextProfile.id)
    await next.shopBrowser({ action: 'close' })
    view.rerender(localized(<CustomerServicePage runtime={next.runtime} />))
    expect(screen.queryByText('Verified shop A')).toBeNull()
    const nextRow = await screen.findByRole('row', { name: /Verified shop B/ })
    expect(nextRow.getAttribute('data-selected')).toBe('true')
    await act(async () => { release(oldList) })
    expect(screen.queryByText('Verified shop A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: customerServiceCopy.zh.rules }))
    await screen.findByText(customerServiceCopy.zh.emptyRules)
    expect((screen.getByRole('combobox', { name: customerServiceLayoutCopy.zh.selectShop }) as HTMLSelectElement).value).toBe(nextProfile.id)
    expect(next.runtime.customerService).toHaveBeenCalledWith({ action: 'rulesSnapshot', profileId: nextProfile.id })
    view.rerender(localized(<CustomerServicePage runtime={null} />))
    expect(screen.queryByRole('option', { name: /Verified shop B/ })).toBeNull()
    expect(screen.queryByText('Verified shop B')).toBeNull()
  })

  it.each(['zh', 'zh-hant', 'en', 'ja', 'ar'] as Locale[])('uses the five-language shared entry and add flow in %s', async locale => {
    const f = await fixture()
    render(localized(<PaymentPage runtime={f.runtime} />, locale))
    await clickWhenReady(customerServiceLayoutCopy[locale].title)
    expect(await screen.findByRole('button', { name: shopBrowserCopy[locale].create })).toBeTruthy()
  })
})
