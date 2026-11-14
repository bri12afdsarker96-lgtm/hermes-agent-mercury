import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import type { DoudianRequest } from '../../electron/doudian-types'
import type { EnterpriseClientRuntime } from './runtime'
import { PaymentPage } from './payment-page'
import { ReviewCapturePage } from './review-capture-page'

describe('enterprise-only desktop entry', () => {
  it.each(['review', 'payment'])('does not display or request activation for %s', async kind => {
    const doudian = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>) => {
      if (request.action === 'capabilities') return { ok: true, capabilities: { protocol: 1, version: '1.0.54', chrome: true, spreadsheet: true, authorized: true, authorizationMode: 'enterprise-session-v1' } }
      if (request.action === 'shops') return { ok: true, shops: [] }
      return { ok: true, task: { kind: 'review' as const, taskId: null, state: 'idle' as const, saved: 0, summary: '', error: '', messages: [] } }
    })
    const runtime = { doudian } as unknown as EnterpriseClientRuntime
    render(<I18nProvider initialLocale="zh" configClient={null}>{kind === 'review' ? <ReviewCapturePage runtime={runtime} /> : <PaymentPage runtime={runtime} />}</I18nProvider>)
    await waitFor(() => expect(doudian).toHaveBeenCalledWith({ action: 'capabilities' }))
    expect(screen.queryByText(/激活码/)).toBeNull()
    expect(doudian.mock.calls.some(([request]) => ['activateLicense', 'resumeLicense', 'licenseStatus'].includes(request.action))).toBe(false)
  })
  it('does not send activation requests when the host is unavailable', async () => {
    const doudian = vi.fn(async (_request: Omit<DoudianRequest, 'sessionId'>) => ({ ok: false, error: 'DOUDIAN_FORBIDDEN' }))
    render(<I18nProvider initialLocale="zh" configClient={null}><PaymentPage runtime={{ doudian } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    await screen.findByText('执行模块不可用或企业权限不足')
    expect(doudian.mock.calls.some(([request]) => ['activateLicense', 'resumeLicense', 'licenseStatus'].includes(request.action))).toBe(false)
  })
})
