import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { TenantAiConfigPanel } from './tenant-ai-config-panel'

describe('TenantAiConfigPanel', () => {
  it('prefills the Nfvid relay and saves a key once without Codex login or exposing the key', async () => {
    const status = {configured: false, encryption_ready: true, models: [], providers: [{key: 'custom', label: 'Custom'}]}
    let finish!: (value: typeof status) => void
    const post = vi.fn(() => new Promise<typeof status>(resolve => {finish = resolve}))
    const runtime = {get: vi.fn(async () => status), post, disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<TenantAiConfigPanel runtime={runtime} />)
    const preset = await screen.findByRole('button', {name: /Nfvid API/})
    await waitFor(() => expect((preset as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('API Key'), {target: {value: 'old-unsaved-key'}})
    fireEvent.click(preset)
    expect(screen.queryByDisplayValue('old-unsaved-key')).toBeNull()
    expect(screen.getByDisplayValue('gpt-6.1-sol')).toBeTruthy()
    expect(screen.getByDisplayValue('https://api.nfvid.vip/v1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('API Key'), {target: {value: 'synthetic-nfvid-key'}})
    const save = screen.getByRole('button', {name: '安全保存新模型'})
    fireEvent.click(save)
    fireEvent.click(save)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/api/tenant-ai-config', {
      action: 'upsert_model', api_key: 'synthetic-nfvid-key', base_url: 'https://api.nfvid.vip/v1',
      configuration_id: undefined, model: 'gpt-6.1-sol', provider: 'custom'
    })
    expect(screen.queryByDisplayValue('synthetic-nfvid-key')).toBeNull()
    finish(status)
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true))
  })
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
