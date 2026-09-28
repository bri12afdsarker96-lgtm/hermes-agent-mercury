import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { TenantAiPersonaPanel } from './tenant-ai-persona-panel'

describe('TenantAiPersonaPanel', () => {
  it('creates a shared persona without exposing the full setting in the list', async () => {
    const initial = { personas: [] }
    const saved = {
      personas: [{ description: '售后咨询', is_default: false, name: '售后顾问', persona_id: 'persona_support_1234' }]
    }
    const post = vi.fn(async () => saved)
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: vi.fn(async () => initial) as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<TenantAiPersonaPanel runtime={runtime} />)
    await screen.findByText('请设置默认人设')
    fireEvent.change(screen.getByLabelText('人设名称'), { target: { value: '售后顾问' } })
    fireEvent.change(screen.getByLabelText('适用说明'), { target: { value: '售后咨询' } })
    fireEvent.change(screen.getByLabelText('人设设定'), { target: { value: '先安抚，再给处理步骤。' } })
    fireEvent.click(screen.getByRole('button', { name: '创建人设' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenant-ai-personas', {
      action: 'upsert', description: '售后咨询', instructions: '先安抚，再给处理步骤。', name: '售后顾问', persona_id: undefined
    }))
    expect(await screen.findByText('售后顾问')).toBeTruthy()
    expect(screen.queryByText('先安抚，再给处理步骤。')).toBeNull()
  })

  it('lets the enterprise administrator explicitly choose the default persona', async () => {
    const initial = { personas: [
      { description: '处理售后', is_default: false, name: '售后顾问', persona_id: 'persona_support_1234' },
      { description: '处理销售', is_default: true, name: '销售顾问', persona_id: 'persona_sales_1234' }
    ] }
    const post = vi.fn(async () => ({ personas: [
      { ...initial.personas[0], is_default: true }, { ...initial.personas[1], is_default: false }
    ] }))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: vi.fn(async () => initial) as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<TenantAiPersonaPanel runtime={runtime} />)
    await screen.findByText('销售顾问（默认）')
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenant-ai-personas', {
      action: 'set_default', persona_id: 'persona_support_1234'
    }))
    expect(await screen.findByText('售后顾问（默认）')).toBeTruthy()
  })
})
