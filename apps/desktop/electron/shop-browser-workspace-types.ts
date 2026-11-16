import type { ShopBrowserBounds } from './shop-browser-types'

export interface ShopBrowserTabState {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface ShopBrowserLayout {
  sideWidth: number
  collapsed: boolean
}

export interface ShopBrowserSnapshot {
  tabs: ShopBrowserTabState[]
  activeTabId: string | null
  suspended: boolean
  layout?: ShopBrowserLayout
  error?: string
}

export interface ShopBrowserCommand {
  action: 'state' | 'new' | 'switch' | 'close' | 'navigate' | 'back' | 'forward' | 'reload' | 'home' | 'suspend' | 'layout'
  tabId?: string
  url?: string
  value?: boolean
  sideWidth?: number
  collapsed?: boolean
  containerWidth?: number
}

export interface ShopBrowserPageControls {
  state(): Omit<ShopBrowserTabState, 'id'>
  navigate(url: string): void
  back(): void
  forward(): void
  reload(): void
  setVisible(visible: boolean): void
}

export interface ShopBrowserWorkspace {
  snapshot(): ShopBrowserSnapshot
  operate(command: ShopBrowserCommand): Promise<ShopBrowserSnapshot>
}

export interface ShopBrowserPageOptions {
  initialUrl: string
  onNewWindow(url: string): void
}

export interface NativeBookmarkItem {
  Id: string
  Title: string
  Url: string
  IsFolder: boolean
  Children: NativeBookmarkItem[]
  CreateTime: string
}

export interface ShopBookmarkCommand {
  action: 'list' | 'toggle' | 'create-folder' | 'rename-folder' | 'move' | 'delete'
  id?: string
  folderId?: string
  title?: string
  url?: string
  confirmed?: boolean
}

export interface ShopBookmarkSnapshot {
  revision: number
  items: NativeBookmarkItem[]
}

export interface ShopBrowserTabPage {
  browser: ShopBrowserPageControls
  identify(): Promise<{ shopId: string; shopName: string } | null>
  setBounds(bounds: ShopBrowserBounds): void
  close(): Promise<void>
}

/** Native address entry prepends HTTPS. Local/file/script schemes have no
 * address-bar entry in the recovered implementation. */
export function normalizeBrowserAddress(value: string): string {
  const address = value.trim()

  if (!address || address === 'about:blank') {return address}

  return /^https?:\/\//i.test(address) ? address : `https://${address}`
}

export function isBrowserNavigationUrl(value: unknown): value is string {
  if (value === 'about:blank') {return true}

  if (typeof value !== 'string') {return false}

  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
