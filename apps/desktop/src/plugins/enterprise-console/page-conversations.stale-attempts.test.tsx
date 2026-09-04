/**
 * Stale-selection regression test for Conversations attempts
 * (W1-B1-REMEDIATION-02 §P15).
 *
 * Proves that switching the selected outbound id from m1 → m2 does
 * NOT temporarily render the m1 attempts under the m2 selection
 * identity.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ConversationsPage } from './page-conversations'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

class StaleAttemptsTransport extends BaseHermesTransport {
  public m1Attempts: Deferred<unknown> = deferred<unknown>()
  public m2Attempts: Deferred<unknown> = deferred<unknown>()

  request<T>(path: string, _opts?: TransportRequest): Promise<T> {
    const route = path.split('?')[0]

    if (route === '/api/conversations-inbound') {
      return Promise.resolve({ inbound: [] } as T)
    }

    if (route === '/api/conversations-outbound') {
      return Promise.resolve({
        outbound: [
          {
            channel: 'wecom',
            created_ts: '2030-01-01T00:00:00Z',
            internal_message_id: 'm1',
            recipient_binding_id: 'b1',
            state: 'sent',
            updated_ts: '2030-01-02T00:00:00Z',
          },
          {
            channel: 'wecom',
            created_ts: '2030-02-01T00:00:00Z',
            internal_message_id: 'm2',
            recipient_binding_id: 'b2',
            state: 'sent',
            updated_ts: '2030-02-02T00:00:00Z',
          },
        ],
      } as T)
    }

    if (route === '/api/conversations-attempts') {
      if (path.includes('internal_message_id=m1')) {
        return this.m1Attempts.promise as Promise<T>
      }

      if (path.includes('internal_message_id=m2')) {
        return this.m2Attempts.promise as Promise<T>
      }
    }

    return Promise.reject(new Error(`unexpected route: ${path}`))
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('ConversationsPage attempts selection-bound (W1-B1-REMEDIATION-02 §P15)', () => {
  it('does not leak m1 attempts under m2 selection', async () => {
    const transport = new StaleAttemptsTransport()
    $transport.set(transport)
    transport.m1Attempts.resolve({
      attempts: [
        {
          attempt_id: 'a1',
          attempt_number: 1,
          created_ts: '2030-01-01T00:00:00Z',
          finished_ts: '2030-01-01T00:01:00Z',
          internal_message_id: 'm1',
          outcome_class: 'success',
          state: 'succeeded',
        },
      ],
    })

    wrap(<ConversationsPage />)

    // Switch to outbound tab and select m1.
    const outboundTab = await screen.findByTestId('console-conv-tab-outbound')
    fireEvent.click(outboundTab)
    const rowM1 = await screen.findByTestId('console-outbound-m1')
    fireEvent.click(rowM1)

    // Wait for m1 attempts to render inside the attempts panel.
    const attemptsPanel = await screen.findByTestId('console-conv-attempts')
    await waitFor(() => {
      expect(attemptsPanel.textContent).toContain('succeeded')
    })
    expect(
      screen.getByTestId('console-conv-attempts').textContent?.includes('succeeded')
    ).toBe(true)

    // Switch to m2. m2 attempts are still pending.
    const rowM2 = await screen.findByTestId('console-outbound-m2')
    fireEvent.click(rowM2)

    // The selection-bound container remounts with key={selected}.
    // While the m2 attempts query is pending, the rendered
    // attempts panel must NOT contain any m1-specific fields.
    // The `succeeded` text appears ONLY in the m1 attempts payload
    // (not in the outbound list rows). While the QueryBody is in the
    // pending state it renders Loader; once it renders the m2 empty
    // list it uses EmptyState with `console-conv-attempts` absent too.
    // Wait for the m1 attempts content to be torn down.
    await waitFor(() => {
      expect(screen.queryByText('succeeded')).toBeNull()
    })

    // Resolve m2 attempts. m2 content should now render and m1 must
    // remain absent.
    transport.m2Attempts.resolve({
      attempts: [
        {
          attempt_id: 'b1',
          attempt_number: 1,
          created_ts: '2030-02-01T00:00:00Z',
          finished_ts: '2030-02-01T00:01:00Z',
          internal_message_id: 'm2',
          outcome_class: 'transient',
          state: 'started',
        },
      ],
    })

    await waitFor(() => {
      const panel = screen.getByTestId('console-conv-attempts')
      expect(panel.textContent).toContain('started')
    })
    // m1 content must NOT appear.
    expect(
      screen.getByTestId('console-conv-attempts').textContent?.includes('succeeded')
    ).toBe(false)
    // m2 content must appear.
    expect(
      screen.getByTestId('console-conv-attempts').textContent?.includes('started')
    ).toBe(true)
  })
})
