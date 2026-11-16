import { app, BrowserWindow, session } from 'electron'
import path from 'node:path'

import { createShopBrowserView, clearShopBrowserStorage } from './shop-browser-electron'
import { ShopBrowserProfiles } from './shop-browser-profiles'
import { exportShopBrowserSession, importShopBrowserSession } from './shop-browser-session'
import type { ShopBrowserRequest } from './shop-browser-types'

// Standalone storage acceptance. Platform HTTPS is served locally, never logged in.
const root = process.env.HERMES_SHOP_NATIVE_ROOT
if (!root || !path.isAbsolute(root)) throw new Error('HERMES_SHOP_NATIVE_ROOT must be absolute')
app.setPath('userData', path.join(root, 'electron'))
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1100,
      height: 780,
      title: 'Hermes shop profile storage acceptance',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await window.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<title>Hermes shop profile storage acceptance</title><h2>Local Chromium profile storage acceptance</h2><p>Synthetic storage only. No platform login, messages or payment.</p>'
        )
    )
    let allowed = true
    let activeStorage = ''
    const configured = new Set<string>()
    const controller = new ShopBrowserProfiles({
      root: path.join(root, 'profiles'),
      isCurrent: () => true,
      async authorize() {
        if (!allowed) throw new Error('REVOKED')
        return { origin: 'https://enterprise.example', tenantId: 'storage-test', principalId: 'storage-test' }
      },
      async createView(storage, target, bounds) {
        const browserSession = session.fromPath(storage)
        if (!configured.has(storage)) {
          await browserSession.setProxy({
            mode: 'fixed_servers',
            proxyRules: '127.0.0.1:9',
            proxyBypassRules: '<-loopback>'
          })
          await browserSession.protocol.handle(
            'https',
            () =>
              new Response(
                '<title>Local storage fixture</title><h3>Persistent profile storage</h3><p>This page is a local fixture, without a shop account.</p>',
                { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
              )
          )
          configured.add(storage)
        }
        activeStorage = storage
        return createShopBrowserView(window, storage, target, bounds)
      },
      clearStorage: clearShopBrowserStorage
    })
    Object.assign(globalThis, {
      shopBrowserNative: {
        call: (request: ShopBrowserRequest) => controller.operate(request),
        async putSyntheticCookie() {
          await session.fromPath(activeStorage).cookies.set({
            url: 'https://fxg.jinritemai.com/',
            name: 'hermes_storage_test',
            value: 'synthetic',
            expirationDate: Date.now() / 1000 + 3600,
            secure: true
          })
          await session.fromPath(activeStorage).cookies.flushStore()
        },
        async cookieNames() {
          return (await session.fromPath(activeStorage).cookies.get({})).map(cookie => cookie.name)
        },
        async cloudPortability() {
          const source = window.contentView.children.at(-1) as Electron.WebContentsView
          await source.webContents.executeJavaScript("localStorage.setItem('hermes_cloud_test','synthetic-local-storage')")
          await session.fromPath(activeStorage).cookies.set({ url: 'https://enterprise.example/', name: 'synthetic_enterprise', value: 'not-a-shop-credential', secure: true })
          const backup = await exportShopBrowserSession(activeStorage, () => {})
          await session.fromPath(activeStorage).cookies.remove('https://enterprise.example/', 'synthetic_enterprise')
          const destination = path.join(root, 'cloud-restored-session')
          const restoredSession = session.fromPath(destination)
          await restoredSession.clearStorageData()
          await restoredSession.setProxy({ mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: '<-loopback>' })
          await restoredSession.protocol.handle('https', () => new Response('<title>Local restore fixture</title><h3>Cloud restore fixture</h3>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
          await importShopBrowserSession(destination, backup, () => {})
          const view = await createShopBrowserView(window, destination, 'merchant', { x: 20, y: 150, width: 1000, height: 540 })
          try {
            const contents = (window.contentView.children.at(-1) as Electron.WebContentsView).webContents
            if (contents.isLoading()) await new Promise<void>(resolve => contents.once('did-finish-load', () => resolve()))
            return { differentPartition: destination !== activeStorage,
              enterpriseCookieExcluded: backup.cookies.every(cookie => cookie.name !== 'synthetic_enterprise'),
              cookieNames: (await restoredSession.cookies.get({})).map(cookie => cookie.name),
              localStorageRestored: await contents.executeJavaScript("localStorage.getItem('hermes_cloud_test')==='synthetic-local-storage'"),
              exportedOrigins: backup.origins.map(item => item.origin) }
          } finally { await view.close() }
        },
        async revoke() {
          allowed = false
          await controller.revalidate()
        },
        state() {
          return {
            storage: activeStorage,
            views: window.contentView.children.length,
            pid: process.pid,
            title: window.getTitle()
          }
        }
      }
    })
    app.on('window-all-closed', () => app.quit())
  })
  .catch(error => {
    console.error(error)
    app.exit(1)
  })
