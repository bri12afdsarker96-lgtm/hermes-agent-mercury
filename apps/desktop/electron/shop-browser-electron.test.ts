import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ fromPath: vi.fn(), create: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: {},
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
  isShopBrowserUrl,
  parseShopIdentity
} from './shop-browser-electron'

describe('embedded Chromium shop adapter', () => {
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
    const contents = Object.assign(new EventEmitter(), {
      loadURL: vi.fn(async () => {}),
      getURL: () => 'https://fxg.jinritemai.com/',
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
    await expect(browser.identify()).resolves.toEqual({ shopId: '123', shopName: 'Shop' })
    expect(contents.debugger.sendCommand.mock.calls[0][0]).toBe('Runtime.evaluate')
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
})
