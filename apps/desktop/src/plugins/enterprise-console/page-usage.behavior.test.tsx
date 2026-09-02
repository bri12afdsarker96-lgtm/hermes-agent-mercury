/**
 * P1-VIS-V3 behavior coverage for `UsagePage`.
 *
 * The page must remain Basic Usage only:
 *   - Budget value is read directly from the tenant profile server response
 *     (`fields.llm.daily_budget_tokens`) and never invented locally.
 *   - Real-time usage / spend is rendered as `—` and never as a fabricated
 *     number. There is no real-time spend backend authority in Phase-1.
 *   - When the tenant profile is absent the page shows the empty-state copy
 *     instead of any budget number.
 *   - The page never dispatches a non-GET to the transport.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UsagePage } from './page-usage'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'
import type { Whoami } from './types'

class SpyTransport extends BaseHermesTransport {
  readonly mutating: Array<{ body: unknown; method: string; path: string }> = []
  private profile: { fields: object; tenant_id: string; version: number } | 'OUTAGE' = {
    fields: { llm: { daily_budget_tokens: 5000 } },
    tenant_id: 't1',
    version: 1
  }

  setProfile(next: typeof this.profile) {
    this.profile = next
  }

  async request<T>(path: string, opts?: TransportRequest): Promise<T> {
    const method = opts?.method ?? 'GET'

    if (method !== 'GET') {
      this.mutating.push({ body: opts?.body, method, path })
    }

    if (path === '/api/tenant-profile' && this.profile !== 'OUTAGE') {
      return this.profile as T
    }

    throw new Error(`unexpected ${method} ${path}`)
  }
}

function wrapPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <UsagePage />
    </QueryClientProvider>
  )
}

let spy: SpyTransport

function who(perms: string[]): Whoami {
  return {
    capability_revision: 1,
    data_scope: { mode: 'tenant', scopes: ['tenant:t1'] },
    effective_permissions: perms,
    name: 'budget admin',
    principal_id: 'p1',
    product_capabilities: {},
    role: 'tenant_admin',
    tenant_id: 't1'
  }
}

beforeEach(() => {
  spy = new SpyTransport()
  $transport.set(spy)
  $whoami.set(who(['tenant.profile.read', 'tenant.profile.write']))
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('UsagePage · behavior (P1-VIS-V3)', () => {
  it('U-B1: budget value renders the literal daily_budget_tokens from the tenant profile', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const value = screen.getByTestId('console-budget-value').textContent ?? ''
    expect(value).toContain('5,000')
    expect(value).toContain('tokens/day')
  })

  it('U-B2: when the tenant profile omits llm.daily_budget_tokens the budget falls back to "default (server env)" and never invents a number', async () => {
    spy.setProfile({ fields: {}, tenant_id: 't1', version: 1 })
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const value = screen.getByTestId('console-budget-value').textContent ?? ''
    expect(value).toContain('default (server env)')
    expect(value).not.toMatch(/\b0 tokens\b/)
    expect(value).not.toMatch(/unlimited/i)
  })

  it('U-B3: real-time usage renders as "—" and never as 0 / healthy / spend value', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-realtime'))
    const realtime = screen.getByTestId('console-budget-realtime').textContent ?? ''
    expect(realtime).toContain('—')
    expect(realtime).not.toMatch(/\b0 tokens\b/)
    expect(realtime).not.toMatch(/healthy usage/i)
  })

  it('U-B4: page advertises data-page-status="partial" — Basic Usage is honest about its gap', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const page = screen.getByTestId('console-page-usage')
    expect(page.getAttribute('data-page-status')).toBe('partial')
  })

  it('U-B5: budget editor sends no write until the operator explicitly submits it', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-value'))
    expect(spy.mutating).toEqual([])

    fireEvent.click(screen.getByTestId('console-budget-edit'))
    expect(spy.mutating).toEqual([])
  })

  it('U-B6: submit sends the exact profile version and a server-authoritative budget body', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-edit'))

    fireEvent.click(screen.getByTestId('console-budget-edit'))
    fireEvent.change(screen.getByTestId('console-budget-input'), { target: { value: '1200' } })
    fireEvent.click(screen.getByTestId('console-budget-edit-submit'))

    await waitFor(() =>
      expect(spy.mutating).toEqual([
        {
          body: {
            expected_version: 1,
            fields: { llm: { daily_budget_tokens: 1200 } },
            tenant_id: 't1'
          },
          method: 'POST',
          path: '/api/tenant-profile'
        }
      ])
    )
  })

  it('U-B7: an empty editor value explicitly restores the server default through null', async () => {
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-edit'))

    fireEvent.click(screen.getByTestId('console-budget-edit'))
    fireEvent.change(screen.getByTestId('console-budget-input'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('console-budget-edit-submit'))

    await waitFor(() =>
      expect(spy.mutating[0]).toMatchObject({
        body: { fields: { llm: { daily_budget_tokens: null } } },
        method: 'POST',
        path: '/api/tenant-profile'
      })
    )
  })

  it('U-B8: a reader without tenant.profile.write is not offered the edit control', async () => {
    $whoami.set(who(['tenant.profile.read']))
    wrapPage()
    await waitFor(() => screen.getByTestId('console-budget-value'))

    expect(screen.queryByTestId('console-budget-edit')).toBeNull()
  })
})
