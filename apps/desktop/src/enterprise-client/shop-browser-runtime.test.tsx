import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import type {
  ShopBrowserRuntimeReply,
  ShopBrowserRuntimeRequest,
  ShopBrowserRuntimeSnapshot
} from '../../electron/shop-browser-runtime-types'

import type { EnterpriseClientRuntime } from './runtime'
import type { ShopBrowserBounds, ShopBrowserReply, ShopBrowserRequest } from '../../electron/shop-browser-types'
import type { ShopBrowserTabPage, ShopBrowserWorkspace } from '../../electron/shop-browser-workspace-types'
import { ShopBrowserWorkspacePanel } from './shop-browser-workspace'
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

interface LayoutController {
  operate(request: ShopBrowserRequest): Promise<ShopBrowserReply>
  invalidate(): void
  revalidate(): Promise<void>
}

interface LayoutWorkspace extends ShopBrowserWorkspace {
  initialize(url: string): Promise<LayoutWorkspace>
  identify(): Promise<{ shopId: string; shopName: string } | null>
  setBounds(bounds: ShopBrowserBounds): void
  close(): Promise<void>
}

const layoutFixtures: { runtime: LayoutController; root: string }[] = []
afterEach(async () => {
  for (const fixture of layoutFixtures.splice(0)) {
    fixture.runtime.invalidate()
    await fixture.runtime.revalidate()
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

async function layoutFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-layout-renderer-'))
  const pageDependencies = {
    isCurrent: () => true,
    createPage: async (url: string): Promise<ShopBrowserTabPage> => ({
      identify: async () => null,
      setBounds() {},
      close: async () => {},
      browser: {
        state: () => ({ title: 'Synthetic page', url, loading: false, canGoBack: false, canGoForward: false }),
        navigate() {}, back() {}, forward() {}, reload() {}, setVisible() {}
      }
    })
  }
  // Match the existing shared-shop-flow harness across the Electron/renderer
  // compiler boundary while executing the real main-owned objects.
  const { ShopBrowserTabs } = await vi.importActual<{
    ShopBrowserTabs: new (dependencies: typeof pageDependencies, bounds: ShopBrowserBounds, home: string) => LayoutWorkspace
  }>('../../electron/shop-browser-tabs')
  const dependencies = {
    root,
    authorize: async () => ({ origin: 'https://synthetic.example', tenantId: 'tenant-a', principalId: 'employee-a' }),
    isCurrent: pageDependencies.isCurrent,
    clearStorage: async () => { throw new Error('UNEXPECTED_STORAGE_CLEAR') },
    createView: async (_storage: string, _target: 'merchant' | 'feige', bounds: ShopBrowserBounds) => {
      const tabs = await new ShopBrowserTabs(pageDependencies, bounds, 'https://synthetic.example/home').initialize('about:blank')
      return {
        workspace: tabs,
        identify: () => tabs.identify(),
        setBounds: (next: ShopBrowserBounds) => tabs.setBounds(next),
        close: () => tabs.close()
      }
    }
  }
  const { ShopBrowserRuntime } = await vi.importActual<{
    ShopBrowserRuntime: new (deps: typeof dependencies) => LayoutController
  }>('../../electron/shop-browser-runtime')
  const controller = new ShopBrowserRuntime(dependencies)
  layoutFixtures.push({ runtime: controller, root })
  const send = vi.fn(async (request: Omit<ShopBrowserRequest, 'sessionId'>) =>
    controller.operate({ sessionId: 'synthetic-session', ...request }))
  const runtime = { shopBrowser: send } as unknown as EnterpriseClientRuntime
  const create = async () => (await controller.operate({ sessionId: 'synthetic-session', action: 'create' })).profile!.id
  const open = async (profileId: string) => {
    expect((await controller.operate({ sessionId: 'synthetic-session', action: 'open', profileId, target: 'merchant',
      bounds: { x: 0, y: 0, width: 1000, height: 700 } })).ok).toBe(true)
  }
  const panel = (profileId: string) => <ShopBrowserWorkspacePanel key={profileId} runtime={runtime} profileId={profileId}
    shopVerified viewportRef={{ current: null }} onClosed={() => {}} />
  return { controller, send, open, create, panel }
}

function layoutContent() {
  return screen.getByRole('separator').closest('.shop-browser-content') as HTMLElement
}

async function dragLayout(to: number) {
  const separator = screen.getByRole('separator')
  const initial = Number(separator.getAttribute('aria-valuenow'))
  Object.defineProperty(layoutContent(), 'clientWidth', { value: 1000, configurable: true })
  fireEvent.pointerDown(separator, { clientX: 800 })
  fireEvent.pointerMove(window, { clientX: 800 + initial - to })
  fireEvent.pointerUp(window)
  await waitFor(() => expect(separator.getAttribute('aria-valuenow')).toBe(String(to)))
}

it('retains A layout through real Runtime/Workspace and keyed Renderer A/B/A remounts', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const f = await layoutFixture()
  const a = await f.create()
  const b = await f.create()
  await f.open(a)
  const view = render(f.panel(a))
  await waitFor(() => expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('320'))
  await dragLayout(460)
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
  await waitFor(() => expect(layoutContent().style.gridTemplateColumns).toContain('44px'))
  await act(async () => { await f.open(b) })
  view.rerender(f.panel(b))
  await waitFor(() => expect(layoutContent().style.gridTemplateColumns).toContain('320px'))
  await dragLayout(380)
  await act(async () => { await f.open(a) })
  view.rerender(f.panel(a))
  await waitFor(() => expect(layoutContent().style.gridTemplateColumns).toContain('44px'))
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
  await waitFor(() => expect(layoutContent().style.gridTemplateColumns).toContain('460px'))
  await act(async () => { await f.open(b) })
  view.rerender(f.panel(b))
  await waitFor(() => expect(layoutContent().style.gridTemplateColumns).toContain('380px'))
  view.unmount()
})

it.each(['pointerUp', 'pointerCancel', 'blur'] as const)('paints pointer moves locally and commits one valid width on %s', async end => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const f = await layoutFixture()
  const a = await f.create()
  await f.open(a)
  const view = render(f.panel(a))
  await waitFor(() => expect(f.send.mock.calls.some(([r]) => r.action === 'bookmarks')).toBe(true))
  Object.defineProperty(layoutContent(), 'clientWidth', { value: 1000, configurable: true })
  f.send.mockClear()
  fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 800 })
  for (const x of [790, 760, 720, 660]) fireEvent.pointerMove(window, { clientX: x })
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('460')
  expect(f.send.mock.calls.filter(([r]) => (r.browser?.action as string) === 'layout')).toHaveLength(0)
  fireEvent[end](window)
  await waitFor(() => expect(f.send.mock.calls.filter(([r]) => (r.browser?.action as string) === 'layout')).toHaveLength(1))
  fireEvent.pointerUp(window)
  expect(f.send.mock.calls.filter(([r]) => (r.browser?.action as string) === 'layout')).toHaveLength(1)
  await dragLayout(460)
  expect(f.send.mock.calls.filter(([r]) => (r.browser?.action as string) === 'layout')).toHaveLength(1)
  view.unmount()
})

it('rejects initial state and layout replies that arrive after a newer local layout change', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const f = await layoutFixture()
  const a = await f.create()
  await f.open(a)
  let releaseState!: () => void
  let releaseCollapse!: () => void
  let statePending = false
  let collapsePending = false
  f.send.mockImplementation(async request => {
    const reply = await f.controller.operate({ sessionId: 'synthetic-session', ...request })
    if (request.browser?.action === 'state' && !statePending) {
      statePending = true
      await new Promise<void>(resolve => { releaseState = resolve })
    }
    if (request.browser?.action === 'layout' && request.browser.collapsed === true) {
      collapsePending = true
      await new Promise<void>(resolve => { releaseCollapse = resolve })
    }
    return reply
  })
  const view = render(f.panel(a))
  await waitFor(() => expect(statePending).toBe(true))
  await dragLayout(460)
  await act(async () => { releaseState() })
  expect(layoutContent().style.gridTemplateColumns).toContain('460px')
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
  await waitFor(() => expect(collapsePending).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
  await act(async () => {
    await f.controller.operate({ sessionId: 'synthetic-session', action: 'browser', profileId: a, browser: { action: 'state' } })
    releaseCollapse()
  })
  expect(layoutContent().style.gridTemplateColumns).toContain('460px')
  expect(screen.getByRole('button', { name: '收起侧栏' })).toBeTruthy()
  view.unmount()
})

it('ignores a real A response delivered after the Renderer has switched to B', async () => {
  const f = await layoutFixture()
  const a = await f.create()
  const b = await f.create()
  await f.open(a)
  let release!: () => void
  let pending = false
  expect((await f.controller.operate({ sessionId: 'synthetic-session', action: 'browser', profileId: a,
    browser: { action: 'layout', sideWidth: 460, collapsed: true, containerWidth: 1000 } })).ok).toBe(true)
  f.send.mockImplementation(async request => {
    const reply = await f.controller.operate({ sessionId: 'synthetic-session', ...request })
    if (request.profileId === a && request.browser?.action === 'state') {
      pending = true
      await new Promise<void>(resolve => { release = resolve })
    }
    return reply
  })
  const view = render(f.panel(a))
  await waitFor(() => expect(pending).toBe(true))
  await act(async () => { await f.open(b) })
  view.rerender(f.panel(b))
  await waitFor(() => expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('320'))
  await act(async () => { release() })
  expect(layoutContent().style.gridTemplateColumns).toContain('320px')
  view.unmount()
})
