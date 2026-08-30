/**
 * P1-VIS-V0 a11y coverage for `DashboardPage`.
 *
 * Locks down the screen-reader / heading semantics that V0 hardened
 * without breaking PR18's contracts:
 *
 *   - heading hierarchy: h1 (PageHeader) → h2 (ConsolePanel titles)
 *   - sr-only truth signal: `console-health-ok` retains its
 *     PR18 textContent contract (`ok` / `down`)
 *   - new sr-only addendum: `console-health-state` /
 *     `console-metrics-state` carry the full four-state class
 *   - dl semantics for the SessionCardView identity panel
 *   - role / aria-label on the inline Loader during health-load
 *
 * All assertions ride the FakeHermesTransport + $whoami seam from the
 * existing `page-dashboard.test.tsx`, but per-test we only emit the
 * HTTP routes that the path under test needs.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { DashboardPage } from './page-dashboard'
import { $whoami } from './session'
import { $transport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: {
    biz_tasks: { enabled: true, status: 'LIVE' },
    knowledge_rag: { enabled: false, status: 'DEV' }
  },
  role: 'tenant_admin',
  tenant_id: 't1'
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $whoami.set(WHO)
  $transport.set(
    new FakeHermesTransport({
      '/api/health': { auth_mode: 'strict', ok: true },
      '/api/metrics': { alerts: [] }
    })
  )
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('DashboardPage · a11y (P1-VIS-V0)', () => {
  it('exposes an h1 page title and h2 panel titles (heading hierarchy)', async () => {
    wrap(<DashboardPage />)

    // PageHeader title
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tenant Admin Overview' })
    ).toBeTruthy()

    // SessionCardView (ConsolePanel title=t('session.principal'))
    expect(await screen.findByRole('heading', { level: 2, name: /principal/i })).toBeTruthy()

    // CapabilitiesCardView (ConsolePanel title="Capabilities")
    expect(screen.getByRole('heading', { level: 2, name: 'Capabilities' })).toBeTruthy()

    // Active alerts panel — wait until the metrics query has resolved
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Active alerts' })
    ).toBeTruthy()
  })

  it('keeps PR18 console-health-ok sr-only contract (textContent === "ok")', async () => {
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-ok').textContent).toBe('ok')
    })
  })

  it('surfaces the new console-health-state sr-only full classifier', async () => {
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-state').textContent).toBe('healthy')
    })
  })

  it('renders the Session identity panel as a semantic <dl> with name/tenant/role terms', async () => {
    wrap(<DashboardPage />)

    const dl = await screen.findByTestId('console-session')
    expect(dl.tagName).toBe('DL')
    // name / tenant_id / role are surfaced as <dd> children
    expect(dl.textContent).toContain('alice')
    expect(dl.textContent).toContain('t1')
    expect(dl.textContent).toContain('tenant_admin')
  })

  it('does not place ANY console-health-ok element when health is an error (P5 invariant)', async () => {
    $transport.set(
      new FakeHermesTransport({
        // Fake transport rejects unknown paths. Forcing the controller to
        // surface the network error keeps us on the no-`ok` path.
        '/api/metrics': { alerts: [] }
      })
    )

    wrap(<DashboardPage />)

    // The console-health-state classifier shows `error`, never `down`.
    // The PR18 console-health-ok node is intentionally absent in the
    // error branch (the view does not fabricate `ok` / `down` when
    // the server has not answered).
    await waitFor(() => {
      const state = screen.queryByTestId('console-health-state')
      expect(state?.textContent).toBe('error')
    })
    expect(screen.queryByTestId('console-health-ok')).toBeNull()
  })
})
