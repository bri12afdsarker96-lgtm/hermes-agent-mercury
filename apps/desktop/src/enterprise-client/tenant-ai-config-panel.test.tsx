import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { TenantAiConfigPanel } from './tenant-ai-config-panel'

describe('TenantAiConfigPanel', () => {
  it('adds multiple server-encrypted models and changes the default without displaying keys', async () => {
    const initial = {
      configured: true,
      default_model_id: 'model_a',
      encryption_ready: true,
      models: [{ configuration_id: 'model_a', is_default: true, model: 'deepseek-chat', provider: 'deepseek' }],
      providers: [{ default_model: 'deepseek-chat', key: 'deepseek', label: 'DeepSeek' }]
    }
    const saved = {
      ...initial,
      models: [
        ...initial.models,
        { configuration_id: 'model_b', is_default: false, model: 'deepseek-reasoner', provider: 'deepseek' }
      ]
    }
    const get = vi.fn(async () => initial)
    const post = vi.fn(async () => saved)
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<TenantAiConfigPanel runtime={runtime} />)
    expect(await screen.findByText('1 个已配置模型')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-reasoner' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-secret-only-once' } })
    fireEvent.click(screen.getByRole('button', { name: '安全保存新模型' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/tenant-ai-config', expect.objectContaining({
        action: 'upsert_model', api_key: 'new-secret-only-once', model: 'deepseek-reasoner', provider: 'deepseek'
      }))
    })
    expect(await screen.findByText('2 个已配置模型')).toBeTruthy()
    expect(screen.queryByDisplayValue('new-secret-only-once')).toBeNull()
  })
})
