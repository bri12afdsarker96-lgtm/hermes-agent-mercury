import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { ToolsPage } from './tools-page'
import type { EnterpriseClientRuntime } from './runtime'

vi.mock('./order-filter-panel', () => ({OrderFilterPanel: () => null}))
vi.mock('./wecom-reminder-panel', () => ({WeComReminderPanel: () => null}))
vi.mock('./wecom-seat-binding-panel', () => ({WeComSeatBindingPanel: () => null}))
vi.mock('./wecom-duty-panel', () => ({WeComDutyPanel: () => null}))

describe('tools configuration entry', () => {
  it('opens the existing protected model form only on demand from tools', async () => {
    const get = vi.fn(async () => ({models: [], personas: [], providers: [{key:'custom', label:'Custom'}]}))
    const runtime = {get, post:vi.fn(), disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<I18nProvider initialLocale="zh" configClient={null}><ToolsPage runtime={runtime} role="tenant_admin" canConfigureAi /></I18nProvider>)
    expect(screen.queryByTestId('ai-configuration-page')).toBeNull()
    expect(get).not.toHaveBeenCalled()
    const summary = screen.getByText('AI 模型、密钥与人设配置')
    const details = summary.closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(await screen.findByTestId('ai-configuration-page')).toBeTruthy()
    const preset = screen.getByRole('button', {name:/Nfvid API/})
    await waitFor(() => expect((preset as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(preset)
    expect(screen.getByDisplayValue('gpt-6.1-sol')).toBeTruthy()
    expect(screen.getByDisplayValue('https://api.nfvid.vip/v1')).toBeTruthy()
    expect(runtime.post).not.toHaveBeenCalled()
  })

  it('does not mount tenant configuration for a seat without configuration permission', () => {
    const get = vi.fn()
    render(<ToolsPage role="operator" runtime={{get} as unknown as EnterpriseClientRuntime} />)
    expect(screen.queryByTestId('ai-configuration-page')).toBeNull()
    expect(screen.queryByText('AI 模型、密钥与人设配置')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})
