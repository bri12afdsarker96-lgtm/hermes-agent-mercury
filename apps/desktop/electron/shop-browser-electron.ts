import { BrowserWindow, session, WebContentsView, type Session, type WebContents } from 'electron'

import type { ShopBrowserView } from './shop-browser-profiles'
import { isShopBrowserUrl, type ShopBrowserBounds } from './shop-browser-types'
import type { ShopExecutionPage } from './shop-browser-execution'

export { isShopBrowserUrl } from './shop-browser-types'
import type { ShopBrowserPageOptions } from './shop-browser-workspace-types'
import { isBrowserNavigationUrl } from './shop-browser-workspace-types'

export const shopBrowserTargets = {
  merchant: 'https://fxg.jinritemai.com/ffa/morder/order/list',
  feige: 'https://im.jinritemai.com/pc_seller_v2/main/workspace'
}
const configuredSessions = new WeakSet<Session>()

export function parseShopIdentity(value: unknown): { shopId: string; shopName: string } | null {
  const response = value as { code?: unknown; data?: { ShopId?: unknown; ShopName?: unknown } }
  if (!response || response.code !== 0 || !response.data) return null
  const id = response.data.ShopId
  if (typeof id !== 'string' && !(typeof id === 'number' && Number.isSafeInteger(id))) return null
  const shopId = String(id)
  const shopName = response.data.ShopName
  if (!/^\d{1,32}$/.test(shopId) || typeof shopName !== 'string' || !shopName.trim() || shopName.length > 200)
    return null
  return { shopId, shopName: shopName.trim() }
}

export async function clearShopBrowserStorage(storagePath: string) {
  const browserSession = session.fromPath(storagePath)
  await browserSession.closeAllConnections()
  await browserSession.clearStorageData()
  await browserSession.clearCache()
  browserSession.flushStorageData()
  await browserSession.cookies.flushStore()
}

function configureShopSession(storagePath: string) {
  const browserSession = session.fromPath(storagePath)
  if (!configuredSessions.has(browserSession)) {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', event => event.preventDefault())
    configuredSessions.add(browserSession)
  }
  return browserSession
}

async function waitForShopNavigation(contents: WebContents) {
  if (contents.isDestroyed()) throw new Error('SHOP_PROFILE_PAGE_NOT_READY')
  if (isShopBrowserUrl(contents.getURL())) return
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      contents.removeListener('did-navigate', ready)
      contents.removeListener('dom-ready', ready)
      contents.removeListener('destroyed', destroyed)
      if (error) reject(error)
      else resolve()
    }
    const ready = () => {
      if (!contents.isDestroyed() && isShopBrowserUrl(contents.getURL())) finish()
    }
    const destroyed = () => finish(new Error('SHOP_PROFILE_PAGE_NOT_READY'))
    const timer = setTimeout(() => finish(new Error('SHOP_PROFILE_PAGE_NOT_READY')), 8000)
    contents.on('did-navigate', ready)
    contents.on('dom-ready', ready)
    contents.once('destroyed', destroyed)
    ready()
  })
}

async function identifyShopContents(contents: WebContents) {
  await waitForShopNavigation(contents)
  const attached = !contents.debugger.isAttached()
  if (attached) contents.debugger.attach('1.3')
  try {
    const result = await contents.debugger.sendCommand('Runtime.evaluate', {
      expression: `(async () => {
        const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 8000);
        try {
          const response = await fetch('https://pigeon.jinritemai.com/backstage/currentuser', { credentials: 'include', signal: abort.signal });
          if (!response.ok) throw new Error('identity request failed');
          const value = await response.json();
          return { code: value.code, data: { ShopId: value.data?.ShopId, ShopName: value.data?.ShopName } };
        } finally { clearTimeout(timer); }
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error('SHOP_PROFILE_IDENTITY_UNAVAILABLE')
    return parseShopIdentity(result.result?.value)
  } finally {
    if (attached && !contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
  }
}

/** Background task pages share the exact persisted session, with no new OS window. */
export async function createShopExecutionPage(storagePath: string, url: string): Promise<ShopExecutionPage> {
  if (!isShopBrowserUrl(url)) throw new Error('SHOP_BROWSER_URL_REJECTED')
  const browserSession = configureShopSession(storagePath)
  const view = new WebContentsView({ webPreferences: {
    session: browserSession, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    backgroundThrottling: false
  } })
  const contents = view.webContents
  view.setBounds({ x: 0, y: 0, width: 1920, height: 1080 })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const navigation = (event: { preventDefault(): void }, next: string) => {
    if (!isShopBrowserUrl(next)) event.preventDefault()
  }
  contents.on('will-navigate', navigation)
  contents.on('will-redirect', navigation)
  const close = async () => {
    if (!contents.isDestroyed()) await new Promise<void>(resolve => {
      contents.once('destroyed', resolve)
      contents.close({ waitForBeforeUnload: false })
    })
    browserSession.flushStorageData()
    await browserSession.cookies.flushStore()
  }
  try {
    void contents.loadURL(url).catch(() => {})
    await waitForShopNavigation(contents)
    return {
      url: () => contents.isDestroyed() ? '' : contents.getURL(),
      identify: () => identifyShopContents(contents),
      async command(method, params) {
        if (contents.isDestroyed()) throw new Error('SHOP_PROFILE_PAGE_NOT_READY')
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
        return contents.debugger.sendCommand(method, params)
      },
      close
    }
  } catch (error) { await close(); throw error }
}

/** Third-party pages have no preload, Node access or Hermes IPC bridge. */
export async function createShopBrowserView(
  parent: BrowserWindow,
  storagePath: string,
  target: 'merchant' | 'feige',
  bounds: ShopBrowserBounds,
  options?: ShopBrowserPageOptions
): Promise<ShopBrowserView> {
  const browserSession = configureShopSession(storagePath)
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  const contents = view.webContents
  const allowsUrl = options ? isBrowserNavigationUrl : isShopBrowserUrl
  const navigate = (event: { preventDefault(): void }, url: string) => {
    if (!allowsUrl(url)) event.preventDefault()
  }
  contents.on('will-navigate', navigate)
  contents.on('will-redirect', navigate)
  contents.setWindowOpenHandler(({ url }) => {
    if (allowsUrl(url)) {
      if (options) options.onNewWindow(url)
      else void contents.loadURL(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  parent.contentView.addChildView(view)
  const setBounds = (next: ShopBrowserBounds) => {
    const [width, height] = parent.getContentSize()
    const x = Math.min(next.x, width)
    const y = Math.min(next.y, height)
    view.setBounds({
      x,
      y,
      width: Math.max(0, Math.min(next.width, width - x)),
      height: Math.max(0, Math.min(next.height, height - y))
    })
  }
  setBounds(bounds)
  // Login navigation is user-initiated. Failure stays in the embedded surface
  // and can be retried without dropping the persisted profile.
  void contents.loadURL(options?.initialUrl ?? shopBrowserTargets[target]).catch(() => {})
  let closing: Promise<void> | undefined
  const close = () => {
    if (closing) return closing
    closing = (async () => {
      parent.removeListener('closed', onParentClosed)
      if (!parent.isDestroyed()) parent.contentView.removeChildView(view)
      if (!contents.isDestroyed())
        await new Promise<void>(resolve => {
          contents.once('destroyed', resolve)
          contents.close({ waitForBeforeUnload: false })
        })
      browserSession.flushStorageData()
      await browserSession.cookies.flushStore()
    })()
    return closing
  }
  const onParentClosed = () => {
    void close().catch(() => {})
  }
  parent.once('closed', onParentClosed)
  return {
    setBounds,
    identify: () => identifyShopContents(contents),
    browser: {
      state: () => ({
        title: contents.isDestroyed() ? '' : contents.getTitle(),
        url: contents.isDestroyed() ? '' : contents.getURL(),
        loading: !contents.isDestroyed() && contents.isLoading(),
        canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
        canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward()
      }),
      navigate(url) {
        if (!allowsUrl(url)) throw new Error('SHOP_BROWSER_URL_REJECTED')
        void contents.loadURL(url).catch(() => {})
      },
      back: () => { if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack() },
      forward: () => { if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward() },
      reload: () => contents.reload(),
      setVisible: visible => view.setVisible(visible)
    },
    close
  }
}
