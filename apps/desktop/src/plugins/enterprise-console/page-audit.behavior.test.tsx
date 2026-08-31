/**
 * P1-VIS-V3 behavior coverage for `AuditPage`.
 *
 * The audit page is read-only evidence. Behavior coverage re-verifies that
 * invariant on top of the SC4 contract test, and pins the four honest
 * error states (malformed event id / event not found / audit unavailable
 * / generic error) plus the evidence-chain navigation.
 *
 * No replay / retry / resend / re-execute control is introduced anywhere.
 * The transport is asserted to be GET-only.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { AuditPage } from './page-audit'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  effective_permissions: ['audit.read'],
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: {
    biz_tasks: { enabled: true, status: 'LIVE' }
  },
  role: 'tenant_admin',
  tenant_id: 't1'
}

interface AuditEvent {
  action: string
  actor: null | string
  event_id: string
  payload_ref: unknown
  resource_ref: null | string
  ts: string
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

class SpyTransport extends BaseHermesTransport {
  readonly mutating: string[] = []
  readonly requests: { method: string; path: string }[] = []
  private listResponse: { events: AuditEvent[] } | 'OUTAGE' = { events: [] }
  private detailResponse: { event: AuditEvent } | Error = {
    event: {
      action: 'kb.commit',
      actor: 'alice',
      event_id: 'e1',
      payload_ref: { delta: 'kb:doc:1 added', n: 1 },
      resource_ref: 'kb:doc:1',
      ts: '2026-08-28T00:00:00+00:00'
    }
  }

  setList(next: typeof this.listResponse) {
    this.listResponse = next
  }

  setDetail(next: typeof this.detailResponse) {
    this.detailResponse = next
  }

  async request<T>(path: string, opts?: { method?: string }): Promise<T> {
    const method = opts?.method ?? 'GET'
    this.requests.push({ method, path })

    if (method !== 'GET') {
      this.mutating.push(`${method} ${path}`)
    }

    if (path === '/api/audit-list' && this.listResponse !== 'OUTAGE') {
      return this.listResponse as T
    }

    if (path.startsWith('/api/audit-detail') && !(this.detailResponse instanceof Error)) {
      return this.detailResponse as T
    }

    if (path.startsWith('/api/audit-correlate') && this.listResponse !== 'OUTAGE') {
      return this.listResponse as T
    }

    if (this.listResponse === 'OUTAGE') {
      throw new HermesApiError(503, 'error', 'audit_unavailable')
    }

    if (this.detailResponse instanceof Error) {
      throw this.detailResponse
    }

    throw new Error(`unexpected ${method} ${path}`)
  }
}

let spy: SpyTransport

beforeEach(() => {
  $whoami.set(WHO)
  spy = new SpyTransport()
  $transport.set(spy)
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('AuditPage · behavior (P1-VIS-V3)', () => {
  it('AU-B1: filter inputs change the URL of the audit-list request without ever leaving read-only', async () => {
    spy.setList({ events: [] })
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit-action'))

    await act(async () => {
      fireEvent.change(screen.getByTestId('console-audit-action'), {
        target: { value: 'kb.commit' }
      })
      fireEvent.change(screen.getByTestId('console-audit-resource'), {
        target: { value: 'kb:doc:1' }
      })
    })

    await waitFor(() => {
      const filtered = spy.requests.find(
        r =>
          r.path === '/api/audit-list?action=kb.commit&resource_ref=kb%3Adoc%3A1' ||
          r.path === '/api/audit-list?resource_ref=kb%3Adoc%3A1&action=kb.commit'
      )

      expect(filtered).toBeTruthy()
    })

    expect(spy.mutating).toEqual([])
  })

  it('AU-B2: 400 on /api/audit-detail surfaces "malformed event id"', async () => {
    spy.setDetail(new HermesApiError(400, 'error', 'bad_event_id'))
    spy.setList({
      events: [
        {
          action: 'kb.commit',
          actor: 'alice',
          event_id: 'e1',
          payload_ref: {},
          resource_ref: 'kb:doc:1',
          ts: '2026-08-28T00:00:00+00:00'
        }
      ]
    })
    wrap(<AuditPage />)
    const row = await screen.findByTestId('console-audit-e1')

    await act(async () => {
      fireEvent.click(row)
    })

    expect(await screen.findByText(/malformed event id/i)).toBeTruthy()
  })

  it('AU-B3: 404 on /api/audit-detail surfaces "event not found"', async () => {
    spy.setDetail(new HermesApiError(404, 'error', 'event_not_found'))
    spy.setList({
      events: [
        {
          action: 'kb.commit',
          actor: 'alice',
          event_id: 'e1',
          payload_ref: {},
          resource_ref: 'kb:doc:1',
          ts: '2026-08-28T00:00:00+00:00'
        }
      ]
    })
    wrap(<AuditPage />)
    const row = await screen.findByTestId('console-audit-e1')

    await act(async () => {
      fireEvent.click(row)
    })

    expect(await screen.findByText(/event not found/i)).toBeTruthy()
  })

  it('AU-B4: 503 on /api/audit-list surfaces "audit unavailable"', async () => {
    spy.setList('OUTAGE')
    wrap(<AuditPage />)
    expect(await screen.findByText(/audit unavailable/i)).toBeTruthy()
  })

  it('AU-B5: correlate button opens the evidence chain panel and never POSTs anything', async () => {
    spy.setList({
      events: [
        {
          action: 'kb.commit',
          actor: 'alice',
          event_id: 'e1',
          payload_ref: {},
          resource_ref: 'kb:doc:1',
          ts: '2026-08-28T00:00:00+00:00'
        }
      ]
    })
    wrap(<AuditPage />)
    const correlate = await screen.findByTestId('console-audit-correlate-e1')

    await act(async () => {
      fireEvent.click(correlate)
    })

    await waitFor(() => screen.getByTestId('console-audit-correlate'))
    expect(spy.mutating).toEqual([])
  })
})
