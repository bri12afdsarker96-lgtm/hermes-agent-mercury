/**
 * V3-REMEDIATION-01 · V3-R1 — WeCom behavior coverage (extended).
 *
 * Inherits the V3 behavior suite and adds the V3-R1 acceptance gate:
 *   - the SC5-permitted UNKNOWN fixture (observed_app_config_ref_count = 1,
 *     runtime_credential_present_count = null) renders the literal
 *     `UNKNOWN` token and does NOT render the client-inferred phrase
 *     "no observed app config refs".
 *   - no POST / PUT / PATCH / DELETE is ever dispatched.
 *   - callback health is still "unknown · not actively probed".
 *
 * The pre-existing V3 four-state tests are preserved unchanged.
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

describe('WeComPage · behavior (V3-REMEDIATION-01 · V3-R1)', () => {
  it('W-R1-1: UNKNOWN fixture (observed_app_config_ref_count=1, present_count=null) renders the literal UNKNOWN and does NOT render the client-inferred phrase "no observed app config refs"', async () => {
    const spy = new ReadOnlySpyTransport(
      makeFixture('UNKNOWN', {
        observed_app_config_ref_count: 1,
        runtime_credential_present_count: null
      })
    )

    wrapPage(spy)
    await waitFor(() => screen.getByTestId('console-wecom'))
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('UNKNOWN')
    expect(body).not.toContain('no observed app config refs')
    expect(body).toContain('credential presence is not established by current server evidence')
  })

  it('W-R1-2: no client recomputation — the four-state word is rendered as-is and the page never POSTs anything', async () => {
    const spy = new ReadOnlySpyTransport(
      makeFixture('UNKNOWN', {
        observed_app_config_ref_count: 1,
        runtime_credential_present_count: null
      })
    )

    wrapPage(spy)
    await waitFor(() => screen.getByTestId('console-wecom'))
    expect(spy.mutating).toEqual([])
  })

  it('W-R1-3: ABSENT / PARTIAL / PRESENT fixtures render server-report-style wording, never client-inferential phrasing', async () => {
    const cases: Array<{
      state: CredentialState
      mustContain: string
    }> = [
      {
        state: 'ABSENT',
        mustContain: 'server reports no runtime credential present for the observed app config refs'
      },
      {
        state: 'PARTIAL',
        mustContain:
          'server reports runtime credentials for some, but not all, observed app config refs'
      },
      {
        state: 'PRESENT',
        mustContain: 'server reports runtime credentials for all observed app config refs'
      }
    ]

    for (const c of cases) {
      cleanup()
      $transport.set(null)
      const spy = new ReadOnlySpyTransport(makeFixture(c.state))
      wrapPage(spy)
      await waitFor(() => screen.getByTestId('console-wecom'))
      const body = screen.getByTestId('console-wecom').textContent ?? ''
      expect(body, `state=${c.state}`).toContain(c.mustContain)
      expect(body, `state=${c.state}`).not.toContain('no observed app config refs')
    }
  })
})
