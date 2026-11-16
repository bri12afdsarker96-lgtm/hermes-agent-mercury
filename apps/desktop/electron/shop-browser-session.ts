import { BrowserWindow, session, webContents } from 'electron'

import type { PortableShopSession } from './shop-browser-cloud'
import { isPortableShopDomain, validatePortableShopSession } from './shop-browser-cloud'
import { configureShopSession } from './shop-browser-electron'
import { isShopBrowserUrl } from './shop-browser-types'

/** Export logical values so the backup has no Windows DPAPI dependency. */
export async function exportShopBrowserSession(
  storagePath: string,
  assertCurrent: () => void
): Promise<PortableShopSession> {
  assertCurrent()
  const browserSession = session.fromPath(storagePath)
  await browserSession.cookies.flushStore()

  const cookies = (await browserSession.cookies.get({}))
    .filter(cookie => isPortableShopDomain(cookie.domain))
    .map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain!,
      path: cookie.path ?? '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      hostOnly: Boolean(cookie.hostOnly),
      sameSite: cookie.sameSite,
      ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate })
    }))

  const origins = new Map<string, [string, string][]>()

  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed() || contents.session !== browserSession || !isShopBrowserUrl(contents.getURL())) {
      continue
    }

    assertCurrent()
    const origin = new URL(contents.getURL()).origin

    if (origins.has(origin)) {
      continue
    }

    const attached = !contents.debugger.isAttached()

    if (attached) {
      contents.debugger.attach('1.3')
    }

    try {
      await contents.debugger.sendCommand('DOMStorage.enable')

      const result = await contents.debugger.sendCommand('DOMStorage.getDOMStorageItems', {
        storageId: { securityOrigin: origin, isLocalStorage: true }
      })

      assertCurrent()

      if (!Array.isArray(result.entries)) {
        throw new Error('SHOP_CLOUD_SESSION_INVALID')
      }

      origins.set(origin, result.entries)
    } finally {
      if (attached && !contents.isDestroyed() && contents.debugger.isAttached()) {
        contents.debugger.detach()
      }
    }
  }

  assertCurrent()

  return validatePortableShopSession({
    version: 1,
    cookies,
    origins: [...origins].map(([origin, localStorage]) => ({ origin, localStorage }))
  })
}

/** Restore only into a newly allocated profile partition. Identity is checked afterwards. */
export async function importShopBrowserSession(
  storagePath: string,
  value: PortableShopSession,
  assertCurrent: () => void
) {
  const data = validatePortableShopSession(value)
  assertCurrent()
  const browserSession = configureShopSession(storagePath)

  if ((await browserSession.cookies.get({})).length) {
    throw new Error('SHOP_CLOUD_RESTORE_NOT_EMPTY')
  }

  let stage = 'cookies'

  try {
    for (const cookie of data.cookies) {
      assertCurrent()

      if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000) {
        continue
      }

      const { hostOnly, domain, ...attributes } = cookie
      await browserSession.cookies.set({
        ...attributes,
        url: 'https://' + domain.replace(/^\./, '') + cookie.path,
        ...(hostOnly ? {} : { domain })
      })
    }

    for (const entry of data.origins) {
      stage = 'origin-window'
      assertCurrent()

      const window = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })

      const contents = window.webContents
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event, url) => {
        if (!isShopBrowserUrl(url)) {
          event.preventDefault()
        }
      })

      const timer = setTimeout(() => {
        if (!window.isDestroyed()) {
          window.destroy()
        }
      }, 15000)

      try {
        await contents.loadURL('about:blank')
        contents.debugger.attach('1.3')
        await contents.debugger.sendCommand('Page.enable')
        stage = 'origin-script'
        const worldName = 'hermes-cloud-restore'
        // Verify the complete write before page startup scripts legitimately update runtime values.
        const source = `
          if (location.origin === ${JSON.stringify(entry.origin)}) {
            const entries = ${JSON.stringify(entry.localStorage)}
            for (const [key, value] of entries) localStorage.setItem(key, value)
            globalThis.hermesCloudRestoreVerified = entries.every(
              ([key, value]) => localStorage.getItem(key) === value
            )
          }
        `
        const script = await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName })
        stage = 'origin-navigation'
        await contents.loadURL(entry.origin + '/')
        assertCurrent()

        if (new URL(contents.getURL()).origin !== entry.origin) {
          throw new Error('SHOP_CLOUD_RESTORE_ORIGIN_CHANGED')
        }

        await contents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: script.identifier
        })
        stage = 'origin-storage-read'
        const tree = await contents.debugger.sendCommand('Page.getFrameTree')
        const world = await contents.debugger.sendCommand('Page.createIsolatedWorld', {
          frameId: tree.frameTree.frame.id,
          worldName
        })
        const restored = await contents.debugger.sendCommand('Runtime.evaluate', {
          contextId: world.executionContextId,
          expression: 'globalThis.hermesCloudRestoreVerified === true',
          returnByValue: true
        })
        stage = 'origin-storage-values'

        if (restored.exceptionDetails || restored.result?.value !== true) {
          throw new Error('SHOP_CLOUD_RESTORE_FAILED')
        }
      } finally {
        clearTimeout(timer)

        if (!window.isDestroyed()) {
          window.destroy()
        }
      }
    }

    assertCurrent()
    browserSession.flushStorageData()
    await browserSession.cookies.flushStore()
  } catch (error) {
    await browserSession.clearStorageData()
    throw new Error('SHOP_CLOUD_RESTORE_FAILED_' + stage)
  }
}
