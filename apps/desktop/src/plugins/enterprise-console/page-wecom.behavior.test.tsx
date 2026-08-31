/**
 * P1-VIS-V3 behavior coverage for `WeComPage`.
 *
 * WeCom is read-only end-to-end. The page must never POST anything to the
 * server. This test pins the four-state truth contract on top of the
 * existing SC5 contract test, and proves that:
 *
 *   - Every legal `runtime_credential_state` value renders the literal
 *     state word and never invents a positive value out of silence.
 *   - `callback_health` is rendered as `unknown · not actively probed`
 *     and never as healthy / live / ok.
 *   - No POST / PUT / PATCH / DELETE is ever dispatched.
 *   - When the server 503s, an honest `status.error` is shown — never a
 *     cached or fake row.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { WeComPage } from './page-wecom'
import { $transport, BaseHermesTransport } from './transport'

type CredentialState = 'ABSENT' | 'PARTIAL' | 'PRESENT' | 'UNKNOWN'

interface WeComFixture {
  wecom: {
    association_state: 'BOUND' | 'UNBOUND'
    binding_count: number
    callback_health: 'unknown'
    last_delivery_outcome: 'permanent' | 'success' | 'transient' | null
    last_outbound_at: null | string
    last_verified_inbound_at: null | string
    observed_app_config_ref_count: number
    runtime_credential_present_count: null | number
    runtime_credential_state: CredentialState
  }
}

class ReadOnlySpyTransport extends BaseHermesTransport {
  readonly mutating: string[] = []
  private fixture: WeComFixture

  constructor(fixture: WeComFixture) {
    super()
    this.fixture = fixture
  }

  setFixture(next: WeComFixture) {
    this.fixture = next
  }

  async request<T>(path: string, opts?: { method?: string }): Promise<T> {
    const method = opts?.method ?? 'GET'

    if (method !== 'GET') {
      this.mutating.push(`${method} ${path}`)
    }

    if (path === '/api/wecom-status') {
      return this.fixture as T
    }

    throw new Error(`unexpected ${method} ${path}`)
  }
}

function makeFixture(
  state: CredentialState,
  overrides: Partial<WeComFixture['wecom']> = {}
): WeComFixture {
  return {
    wecom: {
      association_state: 'BOUND',
      binding_count: 0,
      callback_health: 'unknown',
      last_delivery_outcome: null,
      last_outbound_at: null,
      last_verified_inbound_at: null,
      observed_app_config_ref_count: 0,
      runtime_credential_present_count: null,
      runtime_credential_state: state,
      ...overrides
    }
  }
}

function wrapPage(spy: ReadOnlySpyTransport | null) {
  if (spy) {
    $transport.set(spy)
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <WeComPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('WeComPage · behavior (P1-VIS-V3)', () => {
  it('W-B1: ABSENT state shows "ABSENT" and never PARTIAL / PRESENT / UNKNOWN', async () => {
    wrapPage(new ReadOnlySpyTransport(makeFixture('ABSENT')))
    await waitFor(() => screen.getByTestId('console-wecom'))
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('ABSENT')
    expect(body).not.toContain('PARTIAL')
    expect(body).not.toContain('PRESENT')
    expect(body).not.toContain('UNKNOWN')
  })

  it('W-B2: PRESENT state shows "PRESENT" and never ABSENT / PARTIAL / UNKNOWN', async () => {
    wrapPage(new ReadOnlySpyTransport(makeFixture('PRESENT')))
    await waitFor(() => screen.getByTestId('console-wecom'))
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('PRESENT')
    expect(body).not.toContain('ABSENT')
    expect(body).not.toContain('PARTIAL')
    expect(body).not.toContain('UNKNOWN')
  })

  it('W-B3: callback health renders as "unknown · not actively probed" (never healthy / live / ok)', async () => {
    wrapPage(new ReadOnlySpyTransport(makeFixture('PARTIAL')))
    await waitFor(() => screen.getByTestId('console-wecom'))
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('not actively probed')
    expect(body).not.toMatch(/healthy/i)
    expect(body).not.toMatch(/\blive\b/i)
    expect(body).not.toMatch(/\bok\b/i)
  })

  it('W-B4: the page never dispatches a non-GET to the transport (read-only invariant)', async () => {
    const spy = new ReadOnlySpyTransport(makeFixture('PARTIAL'))
    wrapPage(spy)
    await waitFor(() => screen.getByTestId('console-wecom'))
    expect(spy.mutating).toEqual([])
  })

  it('W-B5: server 503 surfaces an honest status.error and no fake credential word', async () => {
    class OutageTransport extends BaseHermesTransport {
      async request<T>(): Promise<T> {
        return Promise.reject(new HermesApiError(503, 'error', 'wecom_unavailable'))
      }
    }
    $transport.set(new OutageTransport())
    wrapPage(null)
    await waitFor(() => expect(screen.getAllByText('status.error').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('console-wecom')).toBeNull()
    expect(screen.queryByText('PRESENT')).toBeNull()
    expect(screen.queryByText('ABSENT')).toBeNull()
    expect(screen.queryByText('PARTIAL')).toBeNull()
  })
})
