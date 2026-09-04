import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HandoffsPage } from './handoffs-page'
import type { EnterpriseClientRuntime } from './runtime'
import { enterpriseClientErrorForStatus } from './runtime-errors'

describe('HandoffsPage', () => {
  it('loads server handoffs and sends only an explicit operator claim through the runtime', async () => {
    const get = vi.fn(async () => ({
      handoffs: [
        {
          claim_age_s: null,
          msg_id: 'handoff-1',
          state: 'escalated',
          text: '需要人工处理',
          thread_id: 'thread-1'
        }
      ]
    }))

    const post = vi.fn(async () => ({ status: 'ok' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<HandoffsPage principalId="operator-1" runtime={runtime} />)

    expect(await screen.findByText('需要人工处理')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '认领交接' }))

    await screen.findByRole('button', { name: '认领交接' })
    expect(post).toHaveBeenCalledWith('/api/handoff-claim', { msg_id: 'handoff-1' })
  })

  it('reconciles the server queue after a claim conflicts', async () => {
    const get = vi
      .fn<EnterpriseClientRuntime['get']>()
      .mockResolvedValueOnce({ handoffs: [{ msg_id: 'handoff-1', state: 'escalated', text: '等待认领' }] })
      .mockResolvedValueOnce({ handoffs: [{ agent_id: 'operator-2', msg_id: 'handoff-1', state: 'claimed' }] })

    const post = vi.fn(async () => {
      throw enterpriseClientErrorForStatus(409)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<HandoffsPage principalId="operator-1" runtime={runtime} />)

    expect(await screen.findByText('等待认领')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '认领交接' }))

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('operator-2')).toBeTruthy()
    expect(screen.getByText('服务端状态已变化，请刷新后重试')).toBeTruthy()
  })
})
