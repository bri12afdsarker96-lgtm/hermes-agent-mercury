import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ fromPath: vi.fn(), create: vi.fn(), createExecution: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return native.createExecution(options)
    }
  },
  session: { fromPath: native.fromPath },
  WebContentsView: class {
    constructor(options: unknown) {
      return native.create(options)
    }
  }
}))
import {
  clearShopBrowserStorage,
  createShopBrowserView,
  createShopExecutionPage,
  isShopBrowserUrl,
  parseShopIdentity,
  shopBrowserExecutionTargets,
  shopBrowserTargets
} from './shop-browser-electron'

describe('embedded Chromium shop adapter', () => {
  it('starts merchant execution at the TD identity homepage while retaining visible navigation', () => {
    expect(shopBrowserExecutionTargets.merchant).toBe('https://fxg.jinritemai.com/ffa/mshop/homepage/index')
    expect(shopBrowserTargets.merchant).toBe('https://fxg.jinritemai.com/ffa/morder/order/list')
    expect(shopBrowserExecutionTargets.feige).toBe(shopBrowserTargets.feige)
  })

  it('accepts platform HTTPS navigation and rejects unrelated or local URLs', () => {
    for (const url of [
      'https://fxg.jinritemai.com/login',
      'https://im.jinritemai.com/pc_seller_v2/main/workspace',
      'https://e.douyin.com/'
    ])
      expect(isShopBrowserUrl(url)).toBe(true)
    for (const url of [
      'file:///C:/secret',
      'http://fxg.jinritemai.com',
      'https://jinritemai.com.attacker.test',
      'https://attacker.test',
      'https://user:password@fxg.jinritemai.com',
      'https://fxg.jinritemai.com:8888/'
    ])
      expect(isShopBrowserUrl(url)).toBe(false)
  })

  it('maps only the recovered identity fields, preserving string IDs and rejecting unsafe numbers', () => {
    expect(
      parseShopIdentity({ code: 0, data: { ShopId: '9007199254740993123', ShopName: ' Shop ', Cookie: 'secret' } })
    ).toEqual({ shopId: '9007199254740993123', shopName: 'Shop' })
    for (const response of [
      { code: 1, data: { ShopId: '123', ShopName: 'Shop' } },
      { code: 0, data: { ShopId: 9007199254740992, ShopName: 'Shop' } },
      { code: 0, data: { ShopId: '123', ShopName: '' } },
      null
    ])
      expect(parseShopIdentity(response)).toBeNull()
  })

  it('uses the exact profile session, internal CDP identity read, and deterministic view disposal', async () => {
    const browserSession = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      flushStorageData: vi.fn(),
      cookies: { flushStore: vi.fn(async () => {}) }
    })
    let currentUrl = 'about:blank'
    const contents = Object.assign(new EventEmitter(), {
      loadURL: vi.fn(async () => {}),
      getURL: () => currentUrl,
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      close: vi.fn(() => contents.emit('destroyed')),
      debugger: {
        isAttached: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(async (_method: string, _parameters: unknown) => ({
          result: { value: { code: 0, data: { ShopId: '123', ShopName: 'Shop' } } }
        }))
      }
    })
    const view = { webContents: contents, setBounds: vi.fn() }
    const parent = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getContentSize: () => [1000, 800],
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
    })
    native.fromPath.mockReturnValue(browserSession)
    native.create.mockReturnValue(view)
    const browser = await createShopBrowserView(parent as never, 'C:\\isolated\\profile', 'merchant', {
      x: 100,
      y: 100,
      width: 1500,
      height: 1000
    })
    expect(native.fromPath).toHaveBeenCalledWith('C:\\isolated\\profile')
    expect(native.create).toHaveBeenCalledWith({
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 100, width: 900, height: 700 })
    const identification = browser.identify()
    const identified = expect(identification).resolves.toEqual({ shopId: '123', shopName: 'Shop' })
    expect(contents.debugger.attach).not.toHaveBeenCalled()
    currentUrl = 'https://fxg.jinritemai.com/'
    contents.emit('did-navigate')
    await identified
    expect(contents.debugger.sendCommand.mock.calls[0][0]).toBe('Runtime.evaluate')
    expect(contents.listenerCount('did-navigate')).toBe(0)
    expect(contents.listenerCount('dom-ready')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)

    await expect(browser.identify()).resolves.toEqual({ shopId: '123', shopName: 'Shop' })
    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    try {
      currentUrl = 'about:blank'
      const unavailable = expect(browser.identify()).rejects.toThrow('SHOP_PROFILE_PAGE_NOT_READY')
      await vi.advanceTimersByTimeAsync(8000)
      await unavailable
      expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(2)
      expect(contents.listenerCount('did-navigate')).toBe(0)
      expect(contents.listenerCount('dom-ready')).toBe(0)
      expect(contents.listenerCount('destroyed')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
    await browser.close()
    await browser.close()
    expect(contents.close).toHaveBeenCalledOnce()
    expect(parent.contentView.removeChildView).toHaveBeenCalledOnce()
  })

  it('clears disk session state without opening a browser page', async () => {
    const browserSession = {
      closeAllConnections: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
      clearCache: vi.fn(async () => {}),
      flushStorageData: vi.fn(),
      cookies: { flushStore: vi.fn(async () => {}) }
    }
    native.fromPath.mockReturnValue(browserSession)
    await clearShopBrowserStorage('C:\\isolated\\profile')
    expect(browserSession.clearStorageData).toHaveBeenCalledOnce()
    expect(browserSession.clearCache).toHaveBeenCalledOnce()
    expect(browserSession.cookies.flushStore).toHaveBeenCalledOnce()
  })

  it.each(['parent', 'native child'])(
    'owns an offscreen task window and closes once after %s closes first',
    async firstClosed => {
      const browserSession = Object.assign(new EventEmitter(), {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        flushStorageData: vi.fn(),
        cookies: { flushStore: vi.fn(async () => {}) }
      })
      let destroyed = false
      const contents = Object.assign(new EventEmitter(), {
        loadURL: vi.fn(async () => {}),
        getURL: () => 'https://im.jinritemai.com/pc_seller_v2/main/workspace',
        isDestroyed: () => destroyed,
        setWindowOpenHandler: vi.fn(),
        debugger: {
          isAttached: () => true,
          attach: vi.fn(),
          sendCommand: vi.fn(async () => ({ result: { value: 42 } }))
        }
      })
      const taskWindow = Object.assign(new EventEmitter(), {
        webContents: contents,
        isDestroyed: () => destroyed,
        destroy: vi.fn(() => {
          destroyed = true
          contents.emit('destroyed')
          taskWindow.emit('closed')
        })
      })
      const parent = new EventEmitter()
      native.fromPath.mockReturnValue(browserSession)
      native.createExecution.mockReturnValue(taskWindow)
      const page = await createShopExecutionPage('C:\\isolated\\task-profile', contents.getURL(), parent as never)
      await expect(page.command('Runtime.evaluate', { expression: '42' })).resolves.toEqual({ result: { value: 42 } })
      expect(native.createExecution).toHaveBeenCalledWith({
        parent,
        show: false,
        skipTaskbar: true,
        width: 1920,
        height: 1080,
        useContentSize: true,
        webPreferences: {
          session: browserSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
          disableDialogs: true,
          offscreen: true
        }
      })
      if (firstClosed === 'native child') taskWindow.destroy()
      parent.emit('closed')
      await Promise.all([page.close(), page.close()])
      expect(taskWindow.destroy).toHaveBeenCalledOnce()
      expect(parent.listenerCount('closed')).toBe(0)
      expect(browserSession.cookies.flushStore).toHaveBeenCalledOnce()
      await expect(page.command('Runtime.evaluate', {})).rejects.toThrow('SHOP_PROFILE_PAGE_NOT_READY')
    }
  )

  it('rejects pending task-page navigation on parent close and removes navigation listeners', async () => {
    const browserSession = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      flushStorageData: vi.fn(),
      cookies: { flushStore: vi.fn(async () => {}) }
    })
    let destroyed = false
    const contents = Object.assign(new EventEmitter(), {
      loadURL: vi.fn(async () => {}),
      getURL: () => 'about:blank',
      isDestroyed: () => destroyed,
      setWindowOpenHandler: vi.fn()
    })
    const taskWindow = Object.assign(new EventEmitter(), {
      webContents: contents,
      isDestroyed: () => destroyed,
      destroy: vi.fn(() => {
        destroyed = true
        contents.emit('destroyed')
        taskWindow.emit('closed')
      })
    })
    const parent = new EventEmitter()
    native.fromPath.mockReturnValue(browserSession)
    native.createExecution.mockReturnValue(taskWindow)
    const pending = expect(
      createShopExecutionPage('C:\\isolated\\loading-profile', shopBrowserExecutionTargets.merchant, parent as never)
    ).rejects.toThrow('SHOP_PROFILE_PAGE_NOT_READY')
    parent.emit('closed')
    await pending
    expect(taskWindow.destroy).toHaveBeenCalledOnce()
    expect(contents.listenerCount('did-navigate')).toBe(0)
    expect(contents.listenerCount('dom-ready')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
    expect(parent.listenerCount('closed')).toBe(0)
    expect(browserSession.cookies.flushStore).toHaveBeenCalledOnce()
  })
})
