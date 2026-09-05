import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConversationsPage } from './conversations-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('ConversationsPage', () => {
  it('reads only the server-projected conversation facts through the product runtime', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/conversations-inbound' || path === '/api/conversations-inbound?state=received') {
        return {
          inbound: [
            {
              channel: 'wecom',
              external_chat_id: 'thread-1',
              message_type: 'text',
              received_ts: '2026-09-01T10:00:00Z',
              state: 'received'
            }
          ]
        }
      }

      if (path === '/api/conversations-outbound' || path === '/api/conversations-outbound?state=delivered') {
        return {
          outbound: [
            { channel: 'wecom', created_ts: '2026-09-01T10:01:00Z', internal_message_id: 'out-1', state: 'delivered' }
          ]
        }
      }

      if (path === '/api/conversations-attempts?internal_message_id=out-1') {
        return { attempts: [{ attempt_number: 1, outcome_class: 'success', state: 'completed' }] }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<ConversationsPage runtime={runtime} />)

    expect(await screen.findByText('thread-1')).toBeTruthy()
    expect(await screen.findByText('out-1')).toBeTruthy()
    expect(await screen.findByText('success')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('筛选入站消息状态'), { target: { value: 'received' } })

    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/conversations-inbound?state=received'))
    expect(get).toHaveBeenCalledWith('/api/conversations-inbound')
    expect(get).toHaveBeenCalledWith('/api/conversations-outbound')
    expect(get).toHaveBeenCalledWith('/api/conversations-attempts?internal_message_id=out-1')
  })
})
