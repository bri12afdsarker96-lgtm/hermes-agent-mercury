import { useI18n } from '@/i18n/context'
import { paymentOriginalCopy } from '@/i18n/payment-original'

import type { DoudianPageProps } from './doudian-entry-state'
import { OriginalPaymentWindow } from './payment-original-window'

export function PaymentPage({ runtime }: DoudianPageProps) {
  const { locale } = useI18n()

  return (
    <section className="hesc-page space-y-4" data-testid="payment-page">
      <header className="hesc-page-header"><h1>{paymentOriginalCopy[locale].title}</h1></header>
      <OriginalPaymentWindow runtime={runtime} />
    </section>
  )
}
