import { BrowserWindow, session, WebContentsView, type Session } from 'electron'

import type { ShopBrowserView } from './shop-browser-profiles'
import type { ShopBrowserBounds } from './shop-browser-types'

export const shopBrowserTargets = {
  merchant: 'https://fxg.jinritemai.com/ffa/morder/order/list',
  feige: 'https://im.jinritemai.com/pc_seller_v2/main/workspace'
}
const configuredSessions = new WeakSet<Session>()

export function isShopBrowserUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['jinritemai.com', 'douyin.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
  } catch {
    return false
  }
}

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

/** Third-party pages have no preload, Node access or Hermes IPC bridge. */
export async function createShopBrowserView(
  parent: BrowserWindow,
  storagePath: string,
  target: 'merchant' | 'feige',
  bounds: ShopBrowserBounds
): Promise<ShopBrowserView> {
  const browserSession = session.fromPath(storagePath)
  if (!configuredSessions.has(browserSession)) {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', event => event.preventDefault())
    configuredSessions.add(browserSession)
  }
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
  const navigate = (event: { preventDefault(): void }, url: string) => {
    if (!isShopBrowserUrl(url)) event.preventDefault()
  }
  contents.on('will-navigate', navigate)
  contents.on('will-redirect', navigate)
  contents.setWindowOpenHandler(({ url }) => {
    if (isShopBrowserUrl(url)) void contents.loadURL(url).catch(() => {})
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
  void contents.loadURL(shopBrowserTargets[target]).catch(() => {})
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
    async identify() {
      if (!contents.isDestroyed() && !isShopBrowserUrl(contents.getURL())) {
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
      if (contents.isDestroyed() || !isShopBrowserUrl(contents.getURL())) throw new Error('SHOP_PROFILE_PAGE_NOT_READY')
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
    },
    close
  }
}
