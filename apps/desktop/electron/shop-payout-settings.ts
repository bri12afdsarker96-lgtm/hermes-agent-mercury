/** Configuration fields recovered from CompleteShopWindow.cs. The original
 * message consumer and refund execution policy are absent from the clients. */
export interface ShopPayoutSettings {
  remitAmount: string
  payoutReviewDays: number
  payoutRequireReviewWithinDays: boolean
  payoutGoodReviewMode: 0 | 1
  payoutRefundChannel: 'small_remit' | 'refund_only'
}

export const defaultShopPayoutSettings: Readonly<ShopPayoutSettings> = {
  remitAmount: '',
  payoutReviewDays: 15,
  payoutRequireReviewWithinDays: false,
  payoutGoodReviewMode: 1,
  payoutRefundChannel: 'small_remit'
}

export function validShopPayoutSettings(value: unknown): value is ShopPayoutSettings {
  const settings = value as ShopPayoutSettings

  return (
    !!settings &&
    Object.keys(settings).length === 5 &&
    typeof settings.remitAmount === 'string' &&
    !!settings.remitAmount.trim() &&
    Number.isInteger(settings.payoutReviewDays) &&
    settings.payoutReviewDays > 0 &&
    settings.payoutReviewDays <= 2147483647 &&
    typeof settings.payoutRequireReviewWithinDays === 'boolean' &&
    [0, 1].includes(settings.payoutGoodReviewMode) &&
    ['small_remit', 'refund_only'].includes(settings.payoutRefundChannel)
  )
}
