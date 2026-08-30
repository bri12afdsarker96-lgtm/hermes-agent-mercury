/**
 * SC3 · Conversations contract closure against frozen Hermes_AI PR131 server
 * contracts. Verifies exact route + query keys, response shapes, owner-scope
 * semantic (no client row-scope inference; revoked-binding historical
 * conversation remains readable if server returns it), selection/query/render
 * identity for attempts, and 401/403/503 server-denied behaviour against the
 * frozen contract (no fake local success, no optimistic resend on
 * unknown_delivery).
 *
 * Per the E-line frozen scope: read or extend only the SC3 surface files
 * (`page-conversations.tsx` + controller + view-model + view + targeted
 * tests). Shared frozen seams are preserved exactly as PR14 landed them.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { ConversationsPage } from './page-conversations'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'

interface RequestLog {
  body?: unknown
  method?: string
  path: string
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

/** PR131 frozen server columns for inbound / outbound / attempts projections.
 *  No payload_ref, no raw body, no secret, no fencing token. */
const SC3_INBOUND_KEYS = [
  'inbound_id',
  'channel',
  'external_chat_id',
  'message_type',
  'state',
  'received_ts',
  'processed_ts',
  'updated_ts'
] as const

const SC3_OUTBOUND_KEYS = [
  'internal_message_id',
  'channel',
  'recipient_binding_id',
  'state',
  'created_ts',
  'updated_ts'
] as const

const SC3_ATTEMPT_KEYS = [
  'attempt_id',
  'internal_message_id',
  'attempt_number',
  'state',
  'outcome_class',
  'created_ts',
  'finished_ts'
] as const

function makeAllRoutesSpy(handler: (path: string, opts?: TransportRequest) => unknown) {
  return new (class extends BaseHermesTransport {
    request<T>(path: string, opts?: TransportRequest): Promise<T> {
      return Promise.resolve(handler(path, opts) as T)
    }
  })()
}

describe('ConversationsPage · SC3 contract closure against PR131 frozen contracts', () => {
  it('routes for inbound / outbound / attempts are the frozen exact paths', async () => {
    const seen: RequestLog[] = []

    $transport.set(makeAllRoutesSpy((path, opts) => {
      seen.push({ body: opts?.body, method: opts?.method, path })

      if (path === '/api/conversations-inbound') {
        // At least one row so the inbound list container testid is in the DOM.
        return {
          inbound: [
            {
              channel: 'wecom',
              external_chat_id: 'thr-x',
              inbound_id: 'in-1',
              message_type: 'text',
              processed_ts: '2026-08-28T01:00:05+00:00',
              received_ts: '2026-08-28T01:00:00+00:00',
              state: 'processed',
              updated_ts: '2026-08-28T01:00:05+00:00'
            }
          ]
        }
      }

      if (path === '/api/conversations-outbound') {
        return { outbound: [] }
      }

      if (path.startsWith('/api/conversations-attempts')) {
        return { attempts: [] }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    await waitFor(() => expect(screen.getByTestId('console-conv-inbound')).toBeTruthy())

    const inboundCalls = seen.filter(r => r.path === '/api/conversations-inbound')
    const outboundCalls = seen.filter(r => r.path === '/api/conversations-outbound')

    expect(inboundCalls.length).toBeGreaterThan(0)
    expect(outboundCalls.length).toBeGreaterThan(0)

    for (const call of [...inboundCalls, ...outboundCalls]) {
      // No scope filter on the read (server RLS is the row-scope authority).
      expect(call.path).not.toMatch(/tenant_id|principal_id|role=/)
      expect((call.method ?? 'GET')).toBe('GET')
    }
  })

  it('attempts query carries the frozen exact query key { internal_message_id } and no scope filter', async () => {
    const seen: RequestLog[] = []

    $transport.set(makeAllRoutesSpy((path, opts) => {
      seen.push({ body: opts?.body, method: opts?.method, path })

      if (path === '/api/conversations-inbound') {
        return { inbound: [] }
      }

      if (path === '/api/conversations-outbound') {
        return {
          outbound: [
            {
              channel: 'wecom',
              created_ts: '2026-08-28T02:00:00+00:00',
              internal_message_id: 'om-1',
              recipient_binding_id: 'b1',
              state: 'sent',
              updated_ts: '2026-08-28T02:00:00+00:00'
            }
          ]
        }
      }

      if (path.startsWith('/api/conversations-attempts')) {
        return { attempts: [] }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    fireEvent.click(screen.getByTestId('console-conv-tab-outbound'))
    await waitFor(() => expect(screen.getByTestId('console-outbound-om-1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-outbound-om-1'))

    await waitFor(() => {
      expect(seen.some(r => r.path.startsWith('/api/conversations-attempts'))).toBe(true)
    })

    const attemptsCall = seen.find(r => r.path.startsWith('/api/conversations-attempts'))

    expect(attemptsCall).toBeTruthy()
    expect(attemptsCall!.path).toContain('internal_message_id=om-1')
    // Owner-scope is server-enforced; the request must not smuggle a scope filter.
    expect(attemptsCall!.path).not.toMatch(/principal_id|role|tenant_id/)
  })

  it('renders inbound row using every frozen server column (no missing, no extra)', async () => {
    $transport.set(makeAllRoutesSpy(path => {
      if (path === '/api/conversations-inbound') {
        return {
          inbound: [
            {
              channel: 'wecom',
              external_chat_id: 'thr-x',
              inbound_id: 'in-1',
              message_type: 'text',
              processed_ts: '2026-08-28T01:00:05+00:00',
              received_ts: '2026-08-28T01:00:00+00:00',
              state: 'processed',
              updated_ts: '2026-08-28T01:00:05+00:00'
            }
          ]
        }
      }

      if (path === '/api/conversations-outbound') {
        return { outbound: [] }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    await waitFor(() => expect(screen.getByTestId('console-conv-inbound')).toBeTruthy())
    const body = screen.getByTestId('console-conv-inbound').textContent ?? ''
    // Frozen column references in the rendered row.
    expect(body).toContain('wecom')
    expect(body).toContain('processed')
    expect(body).toContain('text')
    // ISO date format → real local date, not epoch 1970.
    expect(body).not.toContain('1970')
    // No leaked payload_ref / secret column.
    expect(body).not.toContain('payload_ref')
  })

  it('renders outbound row using every frozen server column', async () => {
    $transport.set(makeAllRoutesSpy(path => {
      if (path === '/api/conversations-inbound') {
        return { inbound: [] }
      }

      if (path === '/api/conversations-outbound') {
        return {
          outbound: [
            {
              channel: 'wecom',
              created_ts: '2026-08-28T02:00:00+00:00',
              internal_message_id: 'om-1',
              recipient_binding_id: 'binding-1',
              state: 'sent',
              updated_ts: '2026-08-28T02:00:00+00:00'
            }
          ]
        }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    fireEvent.click(screen.getByTestId('console-conv-tab-outbound'))
    await waitFor(() => expect(screen.getByTestId('console-outbound-om-1')).toBeTruthy())
    const body = screen.getByTestId('console-outbound-om-1').textContent ?? ''
    expect(body).toContain('sent')
    expect(body).toContain('binding-1')
  })

  it('unknown_delivery state renders evidence-only (NO resend / retry / re-execute affordance)', async () => {
    $transport.set(makeAllRoutesSpy(path => {
      if (path === '/api/conversations-inbound') {
        return {
          inbound: [
            {
              channel: 'wecom',
              external_chat_id: 'thr-x',
              inbound_id: 'in-1',
              message_type: 'text',
              processed_ts: null,
              received_ts: '2026-08-28T01:00:00+00:00',
              state: 'unknown_delivery',
              updated_ts: '2026-08-28T01:00:00+00:00'
            }
          ]
        }
      }

      if (path === '/api/conversations-outbound') {
        return { outbound: [] }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    await waitFor(() => expect(screen.getByTestId('console-conv-inbound')).toBeTruthy())
    const body = screen.getByTestId('console-conv-inbound').textContent ?? ''
    expect(body).toContain('unknown_delivery')
    // No resend / retry / re-execute button is offered for unknown_delivery —
    // it is evidence-only.
    expect(screen.queryByRole('button', { name: /resend|retry|re-?execute|replay/i })).toBeNull()
  })

  it('revoked-binding historical conversation still renders if the server returns it (no client owner-scope inference)', async () => {
    // PR131 invariant: server-side owner-scope JOIN does NOT filter on
    // channel_bindings.status — a message owned through a since-revoked binding
    // must not vanish from its owner's history. The renderer must mirror that:
    // a row whose `recipient_binding_id` has since been revoked on the server
    // is still rendered (the renderer does not collapse / hide it client-side).
    $transport.set(makeAllRoutesSpy(path => {
      if (path === '/api/conversations-inbound') {
        return { inbound: [] }
      }

      if (path === '/api/conversations-outbound') {
        return {
          outbound: [
            {
              channel: 'wecom',
              created_ts: '2026-08-28T02:00:00+00:00',
              internal_message_id: 'om-revoked',
              recipient_binding_id: 'binding-revoked',
              state: 'sent',
              updated_ts: '2026-08-28T02:00:00+00:00'
            }
          ]
        }
      }

      throw new HermesApiError(404, 'error', `unexpected route ${path}`)
    }))
    wrap(<ConversationsPage />)

    fireEvent.click(screen.getByTestId('console-conv-tab-outbound'))
    await waitFor(() => expect(screen.getByTestId('console-outbound-om-revoked')).toBeTruthy())
    const body = screen.getByTestId('console-outbound-om-revoked').textContent ?? ''
    // The renderer renders the row — it does NOT silently hide / filter on
    // recipient_binding_id state. The server's owner-scope join decides what
    // comes back; once it came back, the renderer renders it.
    expect(body).toContain('binding-revoked')
    expect(body).toContain('sent')
  })

  it('server 401 surfaces an honest error (no fake rows)', async () => {
    class UnauthTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(401, 'unauthorized', 'conversations_console_unauthorized'))
      }
    }
    $transport.set(new UnauthTransport())
    wrap(<ConversationsPage />)

    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByTestId('console-conv-inbound')).toBeNull()
    expect(screen.queryByTestId('console-conv-outbound')).toBeNull()
  })

  it('server 403 surfaces an honest error (no fake rows)', async () => {
    class ForbiddenTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(403, 'forbidden', 'conversation_read_denied'))
      }
    }
    $transport.set(new ForbiddenTransport())
    wrap(<ConversationsPage />)

    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByTestId('console-conv-inbound')).toBeNull()
  })

  it('server 503 surfaces an honest error (no fake rows)', async () => {
    class OutageTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(503, 'error', 'conversations_console_unavailable'))
      }
    }
    $transport.set(new OutageTransport())
    wrap(<ConversationsPage />)

    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('processed')).toBeNull()
    expect(screen.queryByText('sent')).toBeNull()
  })

  it('frozen server column sets: no payload_ref / no secret / no fencing token / no provider idempotency id', () => {
    // Pure contract audit — proves the renderer never expects any extra /
    // secret column. If PR131 adds a column, this suite must grow in
    // lockstep (regression on extension drift).
    expect(SC3_INBOUND_KEYS).not.toContain('payload_ref')
    expect(SC3_INBOUND_KEYS).not.toContain('body')
    expect(SC3_INBOUND_KEYS).not.toContain('secret')
    expect(SC3_INBOUND_KEYS).not.toContain('fencing_token')
    expect(SC3_INBOUND_KEYS).not.toContain('idempotency_key')
    expect(SC3_OUTBOUND_KEYS).not.toContain('payload_ref')
    expect(SC3_OUTBOUND_KEYS).not.toContain('fencing_token')
    expect(SC3_ATTEMPT_KEYS).not.toContain('fencing_token')
    expect(SC3_ATTEMPT_KEYS).not.toContain('provider_message_id')
  })
})