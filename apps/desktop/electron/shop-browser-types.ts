export interface ShopBrowserProfile {
  id: string
  displayName: string
  tenantId: string
  principalId: string
  shopId: string | null
  shopName: string | null
  createdAt: string
  checkedAt: string | null
  loginState: 'unverified' | 'verified' | 'expired'
}

export interface ShopBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShopBrowserRequest {
  sessionId: string
  action: 'list' | 'create' | 'open' | 'identify' | 'close' | 'relogin' | 'delete' | 'bounds'
  profileId?: string
  target?: 'merchant' | 'feige'
  bounds?: ShopBrowserBounds
}

export interface ShopBrowserReply {
  ok: boolean
  error?: string
  profiles?: ShopBrowserProfile[]
  profile?: ShopBrowserProfile
  openProfileId?: string | null
}
export function isShopBrowserUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['jinritemai.com', 'douyin.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}
export const recoverableShopBrowserErrors = [
  'SHOP_PROFILE_INVALID_REQUEST',
  'SHOP_PROFILE_NOT_FOUND',
  'SHOP_PROFILE_NOT_OPEN',
  'SHOP_PROFILE_IN_USE',
  'SHOP_PROFILE_PAGE_NOT_READY',
  'SHOP_PROFILE_IDENTITY_UNAVAILABLE'
] as const
