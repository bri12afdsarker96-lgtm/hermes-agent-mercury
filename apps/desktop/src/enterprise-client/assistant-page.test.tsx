import type { GatewayEvent } from '@hermes/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseAgentRuntime } from './agent-runtime'
import { AssistantPage } from './assistant-page'

const runtimeState = vi.hoisted(() => ({
  eventHandler: undefined as undefined | ((event: GatewayEvent) => void),
  runtime: undefined as EnterpriseAgentRuntime | undefined
}))

vi.mock('./agent-runtime', () => ({
  connectEnterpriseAgent: vi.fn(async () => runtimeState.runtime!)
}))

describe('AssistantPage', () => {
  it('renders a product-owned transcript from Hermes session and stream contracts', async () => {
    const runtime: EnterpriseAgentRuntime = {
      close: vi.fn(),
      createSession: vi.fn(async () => 'new-runtime-session'),
      listSessions: vi.fn(async () => [
        {
          id: 'stored-1',
          message_count: 2,
          preview: '历史摘要',
          source: 'desktop',
          started_at: 1_700_000_000,
          title: '项目复盘'
        }
      ]),
      onEvent: vi.fn(handler => {
        runtimeState.eventHandler = handler

        return () => undefined
      }),
      resumeSession: vi.fn(async () => ({
        messages: [
          { content: '历史用户问题', role: 'user' as const },
          { content: '历史 Hermes 回复', role: 'assistant' as const }
        ],
        session_id: 'runtime-1'
      })),
      submit: vi.fn(async () => undefined)
    }

    runtimeState.runtime = runtime

    render(<AssistantPage />)

    fireEvent.click(await screen.findByRole('button', { name: /项目复盘/ }))
    expect(await screen.findByText('历史用户问题')).toBeTruthy()
    expect(screen.getByText('历史 Hermes 回复')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('输入给智能助手的任务'), { target: { value: '继续梳理风险' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))
    expect(runtime.submit).toHaveBeenCalledWith('runtime-1', '继续梳理风险')

    act(() => {
      runtimeState.eventHandler?.({ payload: { text: '已收到。' }, session_id: 'runtime-1', type: 'message.delta' })
    })
    expect(await screen.findByText('已收到。')).toBeTruthy()
  })
})
