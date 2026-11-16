import { randomUUID } from 'node:crypto'

import type { ShopBrowserBounds } from './shop-browser-types'
import type {
  ShopBrowserCommand,
  ShopBrowserLayout,
  ShopBrowserSnapshot,
  ShopBrowserTabPage,
  ShopBrowserWorkspace
} from './shop-browser-workspace-types'
import { isBrowserNavigationUrl, normalizeBrowserAddress } from './shop-browser-workspace-types'

interface Dependencies {
  createPage(url: string, bounds: ShopBrowserBounds, onNewWindow: (url: string) => void): Promise<ShopBrowserTabPage>
  isCurrent(): boolean
}

/** A native BrowserWindow owns one environment and several live WebViews.
 * Tab state intentionally has the same window lifetime as that implementation. */
export class ShopBrowserTabs implements ShopBrowserWorkspace {
  private pages: { id: string; page: ShopBrowserTabPage }[] = []
  private activeTabId: string | null = null
  private suspended = false
  private closed = false
  private tail: Promise<unknown> = Promise.resolve()
  private error?: string
  private layout: ShopBrowserLayout = { sideWidth: 320, collapsed: false }

  constructor(
    private deps: Dependencies,
    private bounds: ShopBrowserBounds,
    private homeUrl: string
  ) {}

  private current() {
    if (this.closed || !this.deps.isCurrent()) {throw new Error('SHOP_PROFILE_OWNER_CHANGED')}
  }

  async initialize(url: string) {
    await this.add(url)

    return this
  }

  private visibility() {
    for (const { id, page } of this.pages) {page.browser.setVisible(!this.suspended && id === this.activeTabId)}
  }

  private async add(url: string) {
    this.current()

    if (!isBrowserNavigationUrl(url)) {throw new Error('SHOP_BROWSER_URL_REJECTED')}

    const page = await this.deps.createPage(url, this.bounds, next => {
      void this.operate({ action: 'new', url: next }).catch(error => {
        this.error = error instanceof Error ? error.message : 'SHOP_BROWSER_FAILED'
      })
    })

    try {
      this.current()
    } catch (error) {
      await page.close()
      throw error
    }

    const tab = { id: randomUUID(), page }
    this.pages.push(tab)
    this.activeTabId = tab.id
    this.visibility()
  }

  snapshot(): ShopBrowserSnapshot {
    return {
      tabs: this.pages.map(({ id, page }) => ({ id, ...page.browser.state() })),
      activeTabId: this.activeTabId,
      suspended: this.suspended,
      layout: { ...this.layout },
      ...(this.error ? { error: this.error } : {})
    }
  }

  operate(command: ShopBrowserCommand): Promise<ShopBrowserSnapshot> {
    const operation = this.tail.then(() => this.perform(command))
    this.tail = operation.catch(() => {})

    return operation
  }

  private async perform(command: ShopBrowserCommand) {
    this.current()

    const fields: Record<string, string[]> = {
      state: [],
      new: ['url'],
      switch: ['tabId'],
      close: ['tabId'],
      navigate: ['url'],
      back: [],
      forward: [],
      reload: [],
      home: [],
      suspend: ['value'],
      layout: ['sideWidth', 'collapsed', 'containerWidth']
    }

    const allowed = fields[command?.action]

    if (!allowed || Object.keys(command).some(key => !['action', ...allowed].includes(key)))
      {throw new Error('SHOP_BROWSER_INVALID_COMMAND')}

    this.error = undefined

    if (command.action === 'layout') {
      const hasWidth = Object.hasOwn(command, 'sideWidth')
      const hasCollapsed = Object.hasOwn(command, 'collapsed')

      if (
        (!hasWidth && !hasCollapsed) ||
        (hasCollapsed && typeof command.collapsed !== 'boolean') ||
        (hasWidth && (
          typeof command.sideWidth !== 'number' || !Number.isFinite(command.sideWidth) ||
          typeof command.containerWidth !== 'number' || !Number.isFinite(command.containerWidth) ||
          command.containerWidth < 0 || command.sideWidth < 260 ||
          command.sideWidth > Math.max(command.containerWidth * 0.6, 320)
        )) ||
        (!hasWidth && Object.hasOwn(command, 'containerWidth'))
      ) {throw new Error('SHOP_BROWSER_INVALID_COMMAND')}

      this.layout = {
        sideWidth: hasWidth ? command.sideWidth! : this.layout.sideWidth,
        collapsed: hasCollapsed ? command.collapsed! : this.layout.collapsed
      }
    }

    if (command.action === 'new') {await this.add(command.url === undefined ? 'about:blank' : command.url)}

    if (command.action === 'switch' || command.action === 'close') {
      const index = this.pages.findIndex(tab => tab.id === command.tabId)

      if (index < 0) {throw new Error('SHOP_BROWSER_TAB_NOT_FOUND')}

      if (command.action === 'switch') {this.activeTabId = this.pages[index].id}
      else {
        const [removed] = this.pages.splice(index, 1)

        if (this.activeTabId === removed.id) {this.activeTabId = this.pages[Math.max(0, index - 1)]?.id ?? null}
        await removed.page.close()
      }
    }

    const active = this.pages.find(tab => tab.id === this.activeTabId)?.page

    if (command.action === 'navigate') {
      if (typeof command.url !== 'string') {throw new Error('SHOP_BROWSER_INVALID_COMMAND')}
      const url = normalizeBrowserAddress(command.url)

      if (url) {
        if (!isBrowserNavigationUrl(url)) {throw new Error('SHOP_BROWSER_URL_REJECTED')}
        active?.browser.navigate(url)
      }
    }

    if (command.action === 'back') {active?.browser.back()}

    if (command.action === 'forward') {active?.browser.forward()}

    if (command.action === 'reload') {active?.browser.reload()}

    if (command.action === 'home') {active?.browser.navigate(this.homeUrl)}

    if (command.action === 'suspend') {
      if (typeof command.value !== 'boolean') {throw new Error('SHOP_BROWSER_INVALID_COMMAND')}
      this.suspended = command.value
    }

    this.visibility()

    return this.snapshot()
  }

  setBounds(bounds: ShopBrowserBounds) {
    this.bounds = bounds

    for (const { page } of this.pages) {page.setBounds(bounds)}
  }

  identify() {
    this.current()
    const active = this.pages.find(tab => tab.id === this.activeTabId)

    if (!active) {throw new Error('SHOP_PROFILE_NOT_OPEN')}

    return active.page.identify()
  }

  async close() {
    this.closed = true
    this.layout = { sideWidth: 320, collapsed: false }
    const pages = this.pages
    this.pages = []
    this.activeTabId = null
    await Promise.all(pages.map(({ page }) => page.close()))
  }
}
