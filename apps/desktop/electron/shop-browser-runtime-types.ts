export interface ShopBrowserRuntimeSnapshot {
  maxConcurrentBrowsers: number
  browsers: { profileId: string; target: 'merchant' | 'feige'; active: boolean; lastUsed: number }[]
  receptionControl: { available: false; error: 'SHOP_RECEPTION_SERVICE_UNAVAILABLE' }
}

export interface ShopBrowserRuntimeRequest {
  sessionId: string
  action: 'snapshot' | 'setLimit' | 'closeAll'
  maxConcurrentBrowsers?: number
}

export interface ShopBrowserRuntimeReply {
  ok: boolean
  error?: string
  snapshot?: ShopBrowserRuntimeSnapshot
}
