import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type {
  ShopBrowserRuntimeReply,
  ShopBrowserRuntimeRequest,
  ShopBrowserRuntimeSnapshot
} from '../../electron/shop-browser-runtime-types'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'
import { ShopBrowserRuntimeSettings } from './shop-browser-runtime'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  let snapshot: ShopBrowserRuntimeSnapshot = {
    maxConcurrentBrowsers: 3,
    browsers: [{ profileId: '11111111-1111-1111-1111-111111111111', target: 'merchant', active: true, lastUsed: 1 }],
    receptionControl: { available: false, error: 'SHOP_RECEPTION_SERVICE_UNAVAILABLE' }
  }

  const send = vi.fn(
    async (request: Omit<ShopBrowserRuntimeRequest, 'sessionId'>): Promise<ShopBrowserRuntimeReply> => {
      if (request.action === 'setLimit') {
        snapshot = { ...snapshot, maxConcurrentBrowsers: request.maxConcurrentBrowsers! }
      }

      if (request.action === 'closeAll') {
        snapshot = { ...snapshot, browsers: [] }
      }

      return { ok: true, snapshot }
    }
  )

  return { send, runtime: { shopBrowserRuntime: send } as unknown as EnterpriseClientRuntime }
}

it('normalizes native integer input on blur and persists the result through the typed runtime', async () => {
  const f = fixture()
  render(<ShopBrowserRuntimeSettings runtime={f.runtime} />)
  const input = await screen.findByLabelText('最大同时打开店铺数')
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  expect(screen.getByRole('status').textContent).toContain('1/3')

  for (const [draft, expected] of [
    ['11', 10],
    ['0', 1],
    ['', 3],
    ['1e1', 3],
    ['2147483648', 3]
  ] as const) {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: draft } })
    fireEvent.blur(input)
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(String(expected)))
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  }

  expect(
    f.send.mock.calls
      .filter(([request]) => request.action === 'setLimit')
      .map(([request]) => request.maxConcurrentBrowsers)
  ).toEqual([10, 1, 3])
})

it('closes only through the explicit command and updates the real retained count', async () => {
  const f = fixture()
  const onClosed = vi.fn()
  render(<ShopBrowserRuntimeSettings onClosed={onClosed} runtime={f.runtime} />)
  const close = screen.getByRole('button', { name: '关闭全部店铺浏览器' })
  await waitFor(() => expect((close as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(close)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('0/3'))
  expect(f.send).toHaveBeenCalledWith({ action: 'closeAll' })
  expect(onClosed).toHaveBeenCalledOnce()
})

it('ignores late runtime replies from a previous employee session', async () => {
  let release!: (reply: ShopBrowserRuntimeReply) => void
  const old = fixture()
  old.send.mockImplementation(
    () =>
      new Promise(resolve => {
        release = resolve
      })
  )
  const next = fixture()
  const view = render(<ShopBrowserRuntimeSettings runtime={old.runtime} />)
  await waitFor(() => expect(old.send).toHaveBeenCalledOnce())
  view.rerender(<ShopBrowserRuntimeSettings runtime={next.runtime} />)
  await waitFor(() => expect((screen.getByLabelText('最大同时打开店铺数') as HTMLInputElement).value).toBe('3'))
  release({
    ok: true,
    snapshot: {
      maxConcurrentBrowsers: 10,
      browsers: [],
      receptionControl: { available: false, error: 'SHOP_RECEPTION_SERVICE_UNAVAILABLE' }
    }
  })
  await waitFor(() => expect((screen.getByLabelText('最大同时打开店铺数') as HTMLInputElement).value).toBe('3'))
})

it('shows reception state as unknown and keeps unavailable native controls disabled', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const f = fixture()

  const profile = {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: 'tenant',
    principalId: 'employee',
    displayName: '模拟店铺 A',
    shopId: '10001',
    shopName: '模拟店铺 A',
    loginState: 'verified',
    checkedAt: '2026-11-16T01:00:00Z',
    createdAt: '2026-11-15T00:00:00Z'
  }

  const shopBrowser = vi.fn(async (_request: { action: string }) => ({
    ok: true,
    profiles: [profile],
    openProfileId: null
  }))

  const runtime = {
    ...f.runtime,
    shopBrowser,
    get: async () => ({ role: 'operator' })
  } as unknown as EnterpriseClientRuntime

  await act(async () => {
    render(<ShopBrowserProfilesPanel nativeLayout runtime={runtime} />)
  })
  await screen.findByText('模拟店铺 A')
  expect(screen.getByText('接待服务未接入')).toBeTruthy()

  for (const control of screen.getAllByRole('checkbox')) {
    expect(control.getAttribute('aria-checked')).toBe('mixed')
    expect((control as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(control)
  }

  expect((screen.getByRole('button', { name: /^上线$/ }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: /^下线$/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(shopBrowser.mock.calls.every(([request]) => (request as { action: string }).action === 'list')).toBe(true)
})
