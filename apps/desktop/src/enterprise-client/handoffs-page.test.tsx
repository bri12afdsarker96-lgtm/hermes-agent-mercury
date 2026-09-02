import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HandoffsPage } from './handoffs-page'
import type { EnterpriseClientRuntime } from './runtime'

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
})
