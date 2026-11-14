import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'
import { PaymentPage } from '#fixture-payment-page'
import type { EnterpriseClientRuntime } from '@/enterprise-client/runtime'
import type { DoudianRequest } from '../electron/doudian-types'
import '../native-fixture-ui/styles.css'
import '../native-fixture-ui/test-ui.css'

declare global { interface Window { syntheticPayment: { request(payload: Omit<DoudianRequest, 'sessionId'>): Promise<any> } } }
const runtime = { doudian: (request: Omit<DoudianRequest, 'sessionId'>) => window.syntheticPayment.request(request) } as EnterpriseClientRuntime
createRoot(document.getElementById('root')!).render(
  <I18nProvider initialLocale="zh"><ThemeProvider>
    <div className="fixture-banner" role="status">本机模拟付款验收 · 假 Screen / Excel · 不连接店铺 · 不发生真实付款</div>
    <main className="fixture-content"><PaymentPage runtime={runtime} /></main>
  </ThemeProvider></I18nProvider>
)
