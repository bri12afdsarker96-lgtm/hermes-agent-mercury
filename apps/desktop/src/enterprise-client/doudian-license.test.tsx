import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'
import { DoudianLicense } from './doudian-license'
import type { EnterpriseClientRuntime } from './runtime'
import type { DoudianRequest } from '../../electron/doudian-types'

function mount(doudian: ReturnType<typeof vi.fn>) {
  return render(<I18nProvider initialLocale="zh" configClient={null}><DoudianLicense runtime={{ doudian } as unknown as EnterpriseClientRuntime} onReady={vi.fn()} /></I18nProvider>)
}

describe('embedded original activation', () => {
  it('does not accept a code when the integration is unavailable', async () => {
    const doudian = vi.fn(async (_request: Omit<DoudianRequest, 'sessionId'>) => ({ ok: true, capabilities: { protocol: 1, authorized: false, licenseActivation: 0 } }))
    mount(doudian)
    await screen.findByText('原激活码服务尚未就绪，无法执行任务。')
    expect(screen.queryByLabelText('原激活码')).toBeNull()
    expect(doudian.mock.calls.some(([request]) => request.action === 'activateLicense')).toBe(false)
  })

  it('sends a synthetic code only after an explicit click and clears the input', async () => {
    const doudian = vi.fn(async request => request.action === 'capabilities'
      ? { ok: true, capabilities: { protocol: 1, authorized: false, licenseActivation: 1 } }
      : { ok: true, license: { state: 'pending' } })
    mount(doudian)
    const input = await screen.findByLabelText('原激活码') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SYNTHETIC-CODE' } })
    expect(doudian.mock.calls.some(([request]) => request.action === 'activateLicense')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '验证激活码' }))
    await waitFor(() => expect(doudian).toHaveBeenCalledWith({ action: 'activateLicense', licenseCode: 'SYNTHETIC-CODE' }))
    expect(input.value).toBe('')
  })
})
