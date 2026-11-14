import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'
import { ReviewCapturePage } from '@/enterprise-client/review-capture-page'
import type { EnterpriseClientRuntime } from '@/enterprise-client/runtime'
import type { DoudianRequest } from '../electron/doudian-types'
import './styles.css'
import './test-ui.css'

declare global {
  interface Window { syntheticReview: { request(payload: Omit<DoudianRequest, 'sessionId'>): Promise<any> } }
}

const runtime = { doudian: (request: Omit<DoudianRequest, 'sessionId'>) => window.syntheticReview.request(request) } as EnterpriseClientRuntime

createRoot(document.getElementById('root')!).render(
  <I18nProvider initialLocale="zh"><ThemeProvider>
    <div className="fixture-banner" role="status">本机合成验收 · 测试数据 · 不连接店铺 · 付款不可用</div>
    <main className="fixture-content"><ReviewCapturePage runtime={runtime} /></main>
  </ThemeProvider></I18nProvider>
)
