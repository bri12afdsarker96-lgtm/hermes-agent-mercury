import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ShopBrowserProfile, ShopBrowserReply } from '../../electron/shop-browser-types'

import { CustomerServicePage } from './customer-service-page'
import type { EnterpriseClientRuntime } from './runtime'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))
vi.mock('./customer-service-preview', () => ({
  CustomerServicePreviewPanel: ({ profileId }: { profileId: string }) => (
    <div data-testid="loaded-workflow">{profileId}</div>
  )
}))
afterEach(() => vi.unstubAllGlobals())

const profile: ShopBrowserProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: '已保存店铺',
  tenantId: 't',
  principalId: 'p',
  shopId: '123',
  shopName: '已保存店铺',
  createdAt: '',
  checkedAt: null,
  loginState: 'verified'
}

function fixture() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const requests: ((value: ShopBrowserReply) => void)[] = []

  const send = vi.fn(({ action }: { action: string }) =>
    action === 'list' ? new Promise<ShopBrowserReply>(resolve => requests.push(resolve)) : Promise.resolve({ ok: true })
  )

  const get = vi.fn(async (path: string) => {
    if (path === '/api/whoami') {
      return { role: 'operator', tenant_id: 't', principal_id: 'p', name: '当前员工' }
    }

    if (path === '/api/shop-login-profiles') {
      return {
        profiles: [
          {
            profile_id: profile.id,
            revision: 1,
            deleted: false,
            servicing_principal_id: 'p',
            profile: { shop_name: '已保存店铺' }
          }
        ]
      }
    }

    throw new Error('Unexpected endpoint')
  })

  return { requests, send, runtime: { shopBrowser: send, get } as unknown as EnterpriseClientRuntime }
}

it.each(['话术规则', '坐席工作台', '坐席与授权'])(
  'loads saved profiles after navigating immediately to %s',
  async destination => {
    const f = fixture()
    render(<CustomerServicePage runtime={f.runtime} />)
    await waitFor(() => expect(f.requests).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: destination }))
    expect(screen.queryByText('先在店铺管理中创建或选择登录档案')).toBeNull()
    await waitFor(() => expect(f.requests).toHaveLength(2))
    await act(async () => f.requests[1]({ ok: true, profiles: [profile] }))

    if (destination === '坐席与授权') {
      const row = await screen.findByText('当前员工')
      expect(row.closest('tr')?.textContent).toContain('1 家店铺')
    } else {
      expect((await screen.findByTestId('loaded-workflow')).textContent).toBe(profile.id)
    }

    await act(async () => f.requests[0]({ ok: true, profiles: [] }))
    expect(screen.queryByText('先在店铺管理中创建或选择登录档案')).toBeNull()
    expect(f.send.mock.calls.every(([request]) => ['list', 'close'].includes(request.action))).toBe(true)
  }
)

it('shows a list failure with retry and shows empty only after an authoritative empty reply', async () => {
  const f = fixture()
  render(<CustomerServicePage runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '坐席工作台' }))
  await waitFor(() => expect(f.requests).toHaveLength(2))
  await act(async () => f.requests[1]({ ok: false, error: 'SHOP_PROFILE_FORBIDDEN' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('先在店铺管理中创建或选择登录档案')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '刷新档案' }))
  await waitFor(() => expect(f.requests).toHaveLength(3))
  await act(async () => f.requests[2]({ ok: true, profiles: [] }))
  await screen.findByText('先在店铺管理中创建或选择登录档案')
})

it('ignores an old employee request after the runtime changes', async () => {
  const old = fixture()
  const next = fixture()
  const view = render(<CustomerServicePage runtime={old.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '坐席工作台' }))
  await waitFor(() => expect(old.requests).toHaveLength(2))
  view.rerender(<CustomerServicePage runtime={next.runtime} />)
  await waitFor(() => expect(next.requests).toHaveLength(1))
  await act(async () => old.requests[1]({ ok: true, profiles: [profile] }))
  await act(async () => next.requests[0]({ ok: true, profiles: [] }))
  fireEvent.click(screen.getByRole('button', { name: '坐席工作台' }))
  await waitFor(() => expect(next.requests).toHaveLength(2))
  await act(async () => next.requests[1]({ ok: true, profiles: [] }))
  expect(screen.queryByTestId('loaded-workflow')).toBeNull()
  await screen.findByText('先在店铺管理中创建或选择登录档案')
})
