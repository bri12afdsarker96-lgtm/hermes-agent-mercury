
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

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
  release({ ok: false, error: 'SHOP_PROFILE_IN_USE' } as never)
  await screen.findByText(/SHOP_PROFILE_IN_USE/)
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
    async request(method: string, url: string, body?: { profile_id: string; expected_revision: number; profile: unknown; session: unknown }) {
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
    expect((await call({ action: 'identify', profileId: a.id })).ok).toBe(true)
    await call({ action: 'close' })
    shopNumber = 102
    const b = (await call({ action: 'create' })).profile!
    expect((await call({ action: 'open', profileId: b.id, target: 'merchant', bounds })).ok).toBe(true)
    expect((await call({ action: 'identify', profileId: b.id })).ok).toBe(true)
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
