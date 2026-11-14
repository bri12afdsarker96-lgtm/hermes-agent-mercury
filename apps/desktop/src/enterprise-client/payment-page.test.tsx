import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'

import { PaymentPage } from './payment-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('payment page', () => {
  it('exposes the original window without making a payment request on entry', async () => {
    const doudian = vi.fn(async (_request: { action: string }) => ({ ok: true, capabilities: { protocol: 1, paymentUi: 1 } }))
    const runtime = { doudian } as unknown as EnterpriseClientRuntime
    render(<I18nProvider initialLocale="zh" configClient={null}><PaymentPage runtime={runtime} /></I18nProvider>)
    await screen.findByRole('button', { name: '打开早鸟打款窗口' })
    expect(screen.getByTestId('payment-page')).toBeTruthy()
    expect(doudian.mock.calls.every(([request]) => ['capabilities', 'status'].includes(request.action))).toBe(true)
  })
})
