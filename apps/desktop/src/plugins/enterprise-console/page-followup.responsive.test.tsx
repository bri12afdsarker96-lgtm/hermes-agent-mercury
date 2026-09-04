import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FollowupPage } from './page-followup'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'

class FollowupTransport extends BaseHermesTransport {
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
          }
        ]
      } as T)
    }

    if (route === '/api/followup-detail') {
      return Promise.resolve({
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
          version: 1
        }
      } as T)
    }

    if (route === '/api/followup-history') {
      return Promise.resolve({ history: [] } as T)
    }

    return Promise.reject(new Error(`unexpected route: ${path}`))
  }
}

function setViewportMode(compact: boolean) {
  const listeners = new Set<() => void>()

  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    dispatchEvent: () => true,
    matches: compact && query === '(max-width: 1439px)',
    media: query,
    onchange: null,
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
  }))
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  vi.unstubAllGlobals()
})

describe('FollowupPage responsive detail', () => {
  it('uses the existing Sheet for selected detail below 1440px', async () => {
    setViewportMode(true)
    $transport.set(new FollowupTransport())
    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    // Per W1-B1-REMEDIATION-02 §P4 + §P10: when the dialog opens
    // the selection-bound detail surface MUST already exist
    // (QueryBody mounts Loader inside the console-followup-detail
    // wrapper immediately on mount — never blank).
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  it('returns keyboard focus to the opening row after Escape closes the compact Sheet', async () => {
    setViewportMode(true)
    $transport.set(new FollowupTransport())
    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    row.focus()
    fireEvent.click(row)

    await screen.findByRole('dialog')
    fireEvent.keyDown(window.document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.document.activeElement).toBe(row))
  })

  it('renders selected detail inline at 1440px and above', async () => {
    setViewportMode(false)
    $transport.set(new FollowupTransport())
    wrap(<FollowupPage />)

    const row = await screen.findByTestId('console-followup-f1')
    fireEvent.click(row)

    await waitFor(() =>
      expect(screen.getByTestId('console-followup-detail')).toBeTruthy()
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })
})
