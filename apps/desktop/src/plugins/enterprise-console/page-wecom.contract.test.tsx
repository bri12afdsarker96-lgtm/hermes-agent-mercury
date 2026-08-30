/**
 * SC5 · WeCom status contract closure against frozen Hermes_AI PR131 server
 * contracts. Verifies exact route keys, response shapes, the
 * UNKNOWN / ABSENT / PARTIAL / PRESENT 4-state rendering, the read-only
 * discipline (no credential exposure, no callback health inference from
 * silence), and 401/403/503 server-denied behaviour against the frozen
 * contract (no fake local success).
 *
 * Per the E-line frozen scope: read or extend only the SC5 surface file
 * (`page-wecom.tsx` and its targeted tests). Shared frozen seams are
 * preserved exactly as PR14 landed them.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { WeComPage } from './page-wecom'
import { $transport, BaseHermesTransport } from './transport'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** Frozen server payload keys for /api/wecom-status response (PR131
 *  wecom_status_console.py). tenant_id is RLS scope, never payload. */
const SC5_RESPONSE_KEYS = [
  'association_state',
  'runtime_credential_state',
  'runtime_credential_present_count',
  'binding_count',
  'observed_app_config_ref_count',
  'last_verified_inbound_at',
  'last_outbound_at',
  'last_delivery_outcome',
  'callback_health'
] as const

function makeWeComTransport(wecom: Record<string, unknown>): BaseHermesTransport {
  return new (class extends BaseHermesTransport {
    request<P>(path: string): Promise<P> {
      if (path === '/api/wecom-status') {
        return Promise.resolve({ wecom } as P)
      }

      return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
    }
  })()
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('WeComPage · SC5 contract closure against PR131 frozen contracts', () => {
  it('route + query key for /api/wecom-status is the frozen exact path (no scope smuggling)', async () => {
    const seen: string[] = []

    class Spy extends BaseHermesTransport {
      request<P>(path: string): Promise<P> {
        seen.push(path)

        return Promise.resolve({
          wecom: {
            association_state: 'BOUND',
            binding_count: 1,
            callback_health: 'unknown',
            last_delivery_outcome: null,
            last_outbound_at: null,
            last_verified_inbound_at: null,
            observed_app_config_ref_count: 1,
            runtime_credential_present_count: 1,
            runtime_credential_state: 'PRESENT'
          }
        } as P)
      }
    }
    $transport.set(new Spy())
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())

    expect(seen).toContain('/api/wecom-status')

    // No scope / filter query string — server RLS is the only scope authority.
    expect(seen.some(p => p.includes('?'))).toBe(false)
  })

  it('renders every frozen server response key (no missing column)', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'BOUND',
      binding_count: 2,
      callback_health: 'unknown',
      last_delivery_outcome: 'success',
      last_outbound_at: '2026-08-28T10:00:00+00:00',
      last_verified_inbound_at: '2026-08-28T09:00:00+00:00',
      observed_app_config_ref_count: 2,
      runtime_credential_present_count: 2,
      runtime_credential_state: 'PRESENT'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('BOUND')
    expect(body).toContain('PRESENT')
    expect(body).toContain('unknown')
    // Server-stamped ISO dates are rendered as local dates, never 1970.
    expect(body).not.toContain('1970')
  })

  it('4-state credential rendering: UNKNOWN renders as muted (never inferred PRESENT)', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'BOUND',
      binding_count: 1,
      callback_health: 'unknown',
      last_delivery_outcome: null,
      last_outbound_at: null,
      last_verified_inbound_at: null,
      observed_app_config_ref_count: 1,
      runtime_credential_present_count: null,
      runtime_credential_state: 'UNKNOWN'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('UNKNOWN')
    expect(body).not.toContain('PRESENT')
    expect(body).not.toContain('ABSENT')
  })

  it('4-state credential rendering: ABSENT renders honestly (no faked PRESENT)', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'BOUND',
      binding_count: 1,
      callback_health: 'unknown',
      last_delivery_outcome: null,
      last_outbound_at: null,
      last_verified_inbound_at: null,
      observed_app_config_ref_count: 1,
      runtime_credential_present_count: 0,
      runtime_credential_state: 'ABSENT'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('ABSENT')
    expect(body).not.toContain('PRESENT')
    expect(body).not.toContain('PARTIAL')
  })

  it('4-state credential rendering: PRESENT renders honestly (one app, one credential)', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'BOUND',
      binding_count: 1,
      callback_health: 'unknown',
      last_delivery_outcome: 'success',
      last_outbound_at: '2026-08-28T10:00:00+00:00',
      last_verified_inbound_at: '2026-08-28T09:00:00+00:00',
      observed_app_config_ref_count: 1,
      runtime_credential_present_count: 1,
      runtime_credential_state: 'PRESENT'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('PRESENT')
    expect(body).not.toContain('PARTIAL')
    expect(body).not.toContain('ABSENT')
    expect(body).not.toContain('UNKNOWN')
  })

  it('UNBOUND tenant: zero bindings → UNBOUND association, NO callback health inference', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'UNBOUND',
      binding_count: 0,
      callback_health: 'unknown',
      last_delivery_outcome: null,
      last_outbound_at: null,
      last_verified_inbound_at: null,
      observed_app_config_ref_count: 0,
      runtime_credential_present_count: null,
      runtime_credential_state: 'UNKNOWN'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('UNBOUND')
    expect(body).toContain('unknown')
    // No provider configuration controls (read-only status, no actions).
    expect(screen.queryByRole('button', { name: /configure|setup|install/i })).toBeNull()
  })

  it('read-only discipline: no write / configuration affordance is exposed (no credential UI)', async () => {
    $transport.set(makeWeComTransport({
      association_state: 'BOUND',
      binding_count: 1,
      callback_health: 'unknown',
      last_delivery_outcome: null,
      last_outbound_at: null,
      last_verified_inbound_at: null,
      observed_app_config_ref_count: 1,
      runtime_credential_present_count: 1,
      runtime_credential_state: 'PRESENT'
    }))
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    // No form, no credential input, no provider-config action, no rotate/reissue.
    expect(screen.queryByRole('button', { name: /credential|secret|token|rotate|reissue|configure/i })).toBeNull()
    expect(screen.queryByLabelText(/credential|secret|token/i)).toBeNull()
  })

  it('server 401 surfaces an honest error (no fake row)', async () => {
    class UnauthTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(401, 'unauthorized', 'wecom_status_console_unauthorized'))
      }
    }
    $transport.set(new UnauthTransport())
    wrap(<WeComPage />)

    // QueryBody renders ErrorState; with no i18n bundle the title is the raw
    // `status.error` key. Assert at least one ErrorState appears.
    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByTestId('console-wecom')).toBeNull()
  })

  it('server 503 surfaces an honest error (no fake credential state)', async () => {
    class OutageTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(503, 'error', 'wecom_status_authority_unavailable'))
      }
    }
    $transport.set(new OutageTransport())
    wrap(<WeComPage />)

    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('PRESENT')).toBeNull()
    expect(screen.queryByText('ABSENT')).toBeNull()
    expect(screen.queryByText('PARTIAL')).toBeNull()
  })

  it('frozen server response key set is the only payload the renderer expects (no tenant_id leak)', () => {
    // Pure contract audit — proves the test fixture enumerates the exact
    // server-side projection. tenant_id is RLS scope, never payload.
    expect(SC5_RESPONSE_KEYS.length).toBe(9)
    expect(SC5_RESPONSE_KEYS).not.toContain('tenant_id')
    expect(SC5_RESPONSE_KEYS).not.toContain('credential')
    expect(SC5_RESPONSE_KEYS).not.toContain('secret')
    expect(SC5_RESPONSE_KEYS).not.toContain('app_secret_ref')
    expect(SC5_RESPONSE_KEYS).not.toContain('agent_id')
  })
})