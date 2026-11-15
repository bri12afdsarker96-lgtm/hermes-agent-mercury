import { describe, expect, it, vi } from 'vitest'

import { ShopBrowserTabs } from './shop-browser-tabs'
import type { ShopBrowserTabPage } from './shop-browser-workspace-types'

const bounds = { x: 10, y: 20, width: 800, height: 600 }
async function fixture() {
  let current = true
  const pages: (ShopBrowserTabPage & { popup(url: string): void })[] = []
  const tabs = await new ShopBrowserTabs({
    isCurrent: () => current,
    async createPage(url, _bounds, popup) {
      let address = url
      const page = {
        popup, identify: vi.fn(async () => ({ shopId: '123', shopName: 'Shop' })),
        setBounds: vi.fn(), close: vi.fn(async () => {}),
        browser: {
          state: () => ({ url: address, title: address === 'about:blank' ? '' : 'Page', loading: false, canGoBack: true, canGoForward: true }),
          navigate: vi.fn((next: string) => { address = next }), back: vi.fn(), forward: vi.fn(), reload: vi.fn(), setVisible: vi.fn()
        }
      }
      pages.push(page)
      return page
    }
  }, bounds, 'https://fxg.jinritemai.com/home').initialize('https://fxg.jinritemai.com/first')
  return { tabs, pages, revoke: () => { current = false } }
}

describe('native browser tab lifetime and navigation', () => {
  it('switches live pages and selects the previous neighbor when closing the active tab', async () => {
    const f = await fixture()
    const first = f.tabs.snapshot().tabs[0].id
    await f.tabs.operate({ action: 'new' })
    const second = f.tabs.snapshot().activeTabId!
    await f.tabs.operate({ action: 'new', url: 'https://fxg.jinritemai.com/third' })
    await f.tabs.operate({ action: 'switch', tabId: second })
    expect(f.pages[0].browser.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.pages[1].browser.setVisible).toHaveBeenLastCalledWith(true)
    await f.tabs.operate({ action: 'close', tabId: second })
    expect(f.tabs.snapshot().activeTabId).toBe(first)
    expect(f.pages[1].close).toHaveBeenCalledOnce()
    await f.tabs.operate({ action: 'close', tabId: first })
    expect(f.tabs.snapshot().tabs).toHaveLength(1)
    const last = f.tabs.snapshot().activeTabId!
    expect((await f.tabs.operate({ action: 'close', tabId: last })).tabs).toEqual([])
  })

  it('opens a requested new window as an active tab in the same workspace', async () => {
    const f = await fixture()
    f.pages[0].popup('https://im.jinritemai.com/new')
    await f.tabs.operate({ action: 'state' })
    const state = f.tabs.snapshot()
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.find(tab => tab.id === state.activeTabId)?.url).toBe('https://im.jinritemai.com/new')
  })

  it('uses native address prefixing and routes history and home to the active page', async () => {
    const f = await fixture()
    await f.tabs.operate({ action: 'navigate', url: ' fxg.jinritemai.com/orders ' })
    expect(f.pages[0].browser.navigate).toHaveBeenLastCalledWith('https://fxg.jinritemai.com/orders')
    await f.tabs.operate({ action: 'back' })
    await f.tabs.operate({ action: 'forward' })
    await f.tabs.operate({ action: 'reload' })
    expect(f.pages[0].browser.back).toHaveBeenCalledOnce()
    expect(f.pages[0].browser.forward).toHaveBeenCalledOnce()
    expect(f.pages[0].browser.reload).toHaveBeenCalledOnce()
    await f.tabs.operate({ action: 'home' })
    expect(f.pages[0].browser.navigate).toHaveBeenLastCalledWith('https://fxg.jinritemai.com/home')
  })

  it('hides native surfaces during overlays, preserves visibility while switching and resumes the active page', async () => {
    const f = await fixture()
    await f.tabs.operate({ action: 'suspend', value: true })
    await f.tabs.operate({ action: 'new' })
    expect(f.pages.every(page => vi.mocked(page.browser.setVisible).mock.lastCall?.[0] === false)).toBe(true)
    await f.tabs.operate({ action: 'suspend', value: false })
    expect(f.pages[1].browser.setVisible).toHaveBeenLastCalledWith(true)
    f.tabs.setBounds({ ...bounds, width: 500 })
    expect(f.pages.every(page => vi.mocked(page.setBounds).mock.lastCall?.[0].width === 500)).toBe(true)
  })

  it('rejects stale sessions, closes every page and rejects unsupported commands', async () => {
    const f = await fixture()
    await expect(f.tabs.operate({ action: 'new', url: 'javascript:alert(1)' })).rejects.toThrow('SHOP_BROWSER_URL_REJECTED')
    await expect(f.tabs.operate({ action: 'state', url: 'extra' })).rejects.toThrow('SHOP_BROWSER_INVALID_COMMAND')
    await expect(f.tabs.operate({ action: 'switch', tabId: 'missing' })).rejects.toThrow('SHOP_BROWSER_TAB_NOT_FOUND')
    f.revoke()
    await expect(f.tabs.operate({ action: 'new' })).rejects.toThrow('SHOP_PROFILE_OWNER_CHANGED')
    await f.tabs.close()
    await f.tabs.close()
    expect(f.pages[0].close).toHaveBeenCalledOnce()
  })
})
