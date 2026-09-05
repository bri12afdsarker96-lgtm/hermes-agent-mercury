/**
 * Stale-selection regression test (W1-B1-REMEDIATION-02 §P11).
 *
 * Proves that switching the selected follow-up id from f1 → f2 does
 * NOT temporarily render the f1 detail/history under the f2
 * selection identity.
 *
 * Uses deferred promises so we can hold the f2 detail/history response
 * pending while we assert the rendered detail panel does NOT contain
 * any f1 detail fields.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FollowupPage } from './page-followup'
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

/**
 * Transport that resolves list immediately with two rows (f1, f2),
 * resolves /api/followup-detail synchronously for f1, and lets the test
 * control the f2 detail/history responses via deferred promises so we
 * can hold them pending while asserting the rendered surface.
 */
class StaleSelectionTransport extends BaseHermesTransport {
  public f1Detail: Deferred<unknown> = deferred<unknown>()
  public f1History: Deferred<unknown> = deferred<unknown>()
  public f2Detail: Deferred<unknown> = deferred<unknown>()
  public f2History: Deferred<unknown> = deferred<unknown>()

  request<T>(path: string, _opts?: TransportRequest): Promise<T> {
    const route = path.split('?')[0]

    if (route === '/api/followup-list') {
      return Promise.resolve({
        followups: [
          {
            amount: '100.00',
            business_subject: 'Invoice A',
            business_team: null,
            created_ts: '2030-01-01T00:00:00Z',
            currency: 'USD',
            expected_receive_date: '2030-01-10',
            followup_id: 'f1',
            followup_type: 'receivable',
            next_followup_at: null,
            owner_principal_id: 'p1',
            received_at: null,
            status: 'open',
            updated_ts: '2030-01-02T00:00:00Z',
            version: 1
          },
          {
            amount: '200.00',
            business_subject: 'Invoice B',
            business_team: null,
            created_ts: '2030-02-01T00:00:00Z',
            currency: 'USD',
            expected_receive_date: '2030-02-10',
            followup_id: 'f2',
            followup_type: 'receivable',
            next_followup_at: null,
            owner_principal_id: 'p2',
            received_at: null,
            status: 'created',
            updated_ts: '2030-02-02T00:00:00Z',
            version: 1
          }
        ]
      } as T)
    }

    if (route === '/api/followup-detail') {
      if (path.includes('followup_id=f1')) {
        return this.f1Detail.promise as Promise<T>
      }

      if (path.includes('followup_id=f2')) {
        return this.f2Detail.promise as Promise<T>
      }
    }

    if (route === '/api/followup-history') {
      if (path.includes('followup_id=f1')) {
        return this.f1History.promise as Promise<T>
      }

      if (path.includes('followup_id=f2')) {
        return this.f2History.promise as Promise<T>
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

describe('FollowupPage selection-bound detail (W1-B1-REMEDIATION-02 §P11)', () => {
  it('does not leak f1 detail under f2 selection', async () => {
    const transport = new StaleSelectionTransport()
    $transport.set(transport)
    // f1 responses resolve immediately so f1 detail loads.
    transport.f1Detail.resolve({
      followup: {
        amount: '100.00',
        business_subject: 'Invoice A',
        business_team: null,
        created_ts: '2030-01-01T00:00:00Z',
        currency: 'USD',
        expected_receive_date: '2030-01-10',
        followup_id: 'f1',
        followup_type: 'receivable',
        next_followup_at: null,
        owner_principal_id: 'p1',
        received_at: null,
        status: 'open',
        updated_ts: '2030-01-02T00:00:00Z',
        version: 1,
      },
    })
    transport.f1History.resolve({ history: [] })

    wrap(<FollowupPage />)

    // Select f1 and wait for the detail to render with f1's content.
    const rowF1 = await screen.findByTestId('console-followup-f1')
    fireEvent.click(rowF1)

    // Wait for the detail PANEL (not the list row) to render f1
    // content. We use within() to scope to the detail panel.
    const detailPanel = await screen.findByTestId('console-followup-detail')
    await waitFor(() => {
      expect(detailPanel.textContent).toContain('Invoice A')
    })
    // Sanity: f1 content is visible inside the detail panel.
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('Invoice A')
    ).toBe(true)

    // Now switch to f2. f2 detail/history are still pending (the
    // deferred promises haven't been resolved yet).
    const rowF2 = await screen.findByTestId('console-followup-f2')
    fireEvent.click(rowF2)

    // The selection-bound container remounts with key={selectedId}.
    // While the f2 queries are pending, the rendered detail panel
    // must NOT contain any f1-specific fields (subject 'Invoice A',
    // amount '100.00'). The list rows may still reference 'Invoice
    // A' so we must scope our assertions to the detail panel.
    await waitFor(() => {
      const detailPanel = screen.getByTestId('console-followup-detail')
      expect(detailPanel.textContent).not.toContain('Invoice A')
    })
    // Detail panel must also NOT show the f1 amount.
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('100.00 USD')
    ).toBe(false)

    // Resolve f2 detail + history. f2 content should now render.
    transport.f2Detail.resolve({
      followup: {
        amount: '200.00',
        business_subject: 'Invoice B',
        business_team: null,
        created_ts: '2030-02-01T00:00:00Z',
        currency: 'USD',
        expected_receive_date: '2030-02-10',
        followup_id: 'f2',
        followup_type: 'receivable',
        next_followup_at: null,
        owner_principal_id: 'p2',
        received_at: null,
        status: 'created',
        updated_ts: '2030-02-02T00:00:00Z',
        version: 1,
      },
    })
    transport.f2History.resolve({ history: [] })

    await waitFor(() => {
      const detailPanel = screen.getByTestId('console-followup-detail')
      expect(detailPanel.textContent).toContain('Invoice B')
    })
    // f1 content must NOT appear in the detail panel.
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('Invoice A')
    ).toBe(false)
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('100.00 USD')
    ).toBe(false)
    // f2 content must appear in the detail panel.
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('Invoice B')
    ).toBe(true)
    expect(
      screen
        .getByTestId('console-followup-detail')
        .textContent?.includes('200.00 USD')
    ).toBe(true)
  })
})
