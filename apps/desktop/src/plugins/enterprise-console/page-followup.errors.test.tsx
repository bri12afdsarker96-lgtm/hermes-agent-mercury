/**
 * Detail / History error parity tests (W1-B1-REMEDIATION-02 §P12).
 *
 * Proves the selection-bound detail/history panel preserves:
 *   - detail HermesApiError(code='not_implemented') → honest module
 *     unavailable state (EmptyState with `status.module` /
 *     `status.moduleBody`)
 *   - detail ordinary error → ErrorState
 *   - history HermesApiError(code='not_implemented') → honest module
 *     unavailable state
 *   - history ordinary error → ErrorState
 *
 * Implementation note: rejections are scheduled via setTimeout(0) so
 * React Query can attach its error listener between the request() call
 * and the rejection firing. The deferred's promise has a no-op .catch
 * attached at construction so the rejection is always observed and
 * never bubbles into vitest's unhandled-error log.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
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

  // Attach a no-op .catch immediately so the rejection is always
  // observed (React Query attaches its own .catch later; this
  // guarantees the rejection is consumed by SOME handler before
  // vitest's global unhandled-error log fires).
  promise.catch(() => undefined)

  return { promise, resolve, reject }
}

class DetailHistoryErrorTransport extends BaseHermesTransport {
  public detail: Deferred<unknown> = deferred<unknown>()
  public history: Deferred<unknown> = deferred<unknown>()

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
            version: 1,
          },
        ],
      } as T)
    }

    if (route === '/api/followup-detail') {
      return this.detail.promise as Promise<T>
    }
    if (route === '/api/followup-history') {
      return this.history.promise as Promise<T>
    }
    return Promise.reject(new Error(`unexpected route: ${path}`))
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/**
 * Trigger a deferred rejection via setTimeout(0). The macrotask
 * delay lets React Query attach its `.catch()` to the promise so
 * the rejection is observed by the query lifecycle rather than
 * surfacing as an unhandled error.
 */
function scheduleReject<T>(d: Deferred<T>, reason: unknown): void {
  setTimeout(() => d.reject(reason), 0)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('FollowupPage detail / history error parity (W1-B1-REMEDIATION-02 §P12)', () => {
  it('detail HermesApiError(code=not_implemented) surfaces honest module state', async () => {
    const transport = new DetailHistoryErrorTransport()
    $transport.set(transport)
    transport.history.resolve({ history: [] })
    scheduleReject(
      transport.detail,
      new HermesApiError(501, 'not_implemented', 'followup_detail_module_unavailable')
    )

    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    // The detail surface exists immediately (QueryBody mounts Loader
    // inside console-followup-detail).
    await waitFor(() =>
      expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    )

    // Wait for the not_implemented state to surface.
    await waitFor(() => expect(screen.getByText('status.module')).toBeTruthy())
    // Module body text appears too.
    expect(screen.getByText('status.moduleBody')).toBeTruthy()
  })

  it('detail ordinary error surfaces ErrorState', async () => {
    const transport = new DetailHistoryErrorTransport()
    $transport.set(transport)
    transport.history.resolve({ history: [] })
    scheduleReject(transport.detail, new Error('boom detail'))

    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    await waitFor(() =>
      expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    )

    // Wait for the error message to surface.
    await waitFor(() => expect(screen.getByText('boom detail')).toBeTruthy())
  })

  it('history HermesApiError(code=not_implemented) surfaces honest module state', async () => {
    const transport = new DetailHistoryErrorTransport()
    $transport.set(transport)
    transport.detail.resolve({
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
    scheduleReject(
      transport.history,
      new HermesApiError(501, 'not_implemented', 'followup_history_module_unavailable')
    )

    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    await waitFor(() =>
      expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    )

    // History panel uses QueryBody; on not_implemented the inner
    // EmptyState surfaces status.module / status.moduleBody.
    await waitFor(() =>
      expect(screen.getAllByText('status.module').length).toBeGreaterThanOrEqual(1)
    )
  })

  it('history ordinary error surfaces ErrorState', async () => {
    const transport = new DetailHistoryErrorTransport()
    $transport.set(transport)
    transport.detail.resolve({
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
    scheduleReject(transport.history, new Error('boom history'))

    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    await waitFor(() =>
      expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    )

    // The history panel ErrorState title is `status.error` and the
    // description is the error message.
    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThanOrEqual(1)
    )
    await waitFor(() => expect(screen.getByText('boom history')).toBeTruthy())
  })
})
