import type { BrowserWindow } from 'electron'

import { createShopBrowserView, shopBrowserTargets } from './shop-browser-electron'
import type { ShopBrowserView } from './shop-browser-profiles'
import { ShopBrowserTabs } from './shop-browser-tabs'
import type { ShopBrowserBounds } from './shop-browser-types'

export async function createShopBrowserWorkspace(
  parent: BrowserWindow,
  storagePath: string,
  target: 'merchant' | 'feige',
  bounds: ShopBrowserBounds,
  isCurrent: () => boolean
): Promise<ShopBrowserView> {
  const tabs = new ShopBrowserTabs(
    {
      isCurrent,
      async createPage(url, nextBounds, onNewWindow) {
        const page = await createShopBrowserView(parent, storagePath, target, nextBounds, {
          initialUrl: url,
          onNewWindow
        })

        return { ...page, browser: page.browser! }
      }
    },
    bounds,
    shopBrowserTargets.merchant
  )

  await tabs.initialize(shopBrowserTargets[target])

  return {
    workspace: tabs,
    identify: () => tabs.identify(),
    setBounds: next => tabs.setBounds(next),
    close: () => tabs.close()
  }
}
