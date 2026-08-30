import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { HermesApiError } from './fetch-transport'
import { DashboardPage } from './page-dashboard'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'
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

describe('DashboardPage', () => {
  it('renders live health from the server', async () => {
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-ok').textContent).toBe('ok')
    })
  })

  it('shows each capability with the server maturity — DEV never as live', async () => {
    wrap(<DashboardPage />)

    const caps = await screen.findByTestId('console-capabilities')
    expect(caps.textContent).toContain('knowledge_rag')
    expect(caps.textContent).toContain('DEV')
    expect(caps.textContent).toContain('LIVE')
  })

  it.each([
    ['operator', 'Operator Home'],
    ['supervisor', 'Supervisor Workspace'],
    ['tenant_admin', 'Tenant Admin Overview'],
    ['super_admin', 'Tenant Admin Overview']
  ])('maps server role %s to frozen workspace title', (role, title) => {
    $whoami.set({ ...WHO, role })
    wrap(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
  })

  it('uses a neutral workspace title for an unknown server role', () => {
    $whoami.set({ ...WHO, role: 'future_role' })
    wrap(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy()
  })
})

/**
 * Phase-1.5 Alerts Summary — Overview embed render tests (REMEDIATION-01).
 *
 * CORE TRUTH GUARDS:
 *   - "NO DATA != ZERO ALERTS" — `metrics == null` surfaces
 *     `server-unavailable`, never `available-empty` (REMEDIATION-01 §9).
 *   - "ERROR MAP KEYS != ACTUAL SOURCE ERRORS" — the real healthy
 *     server runtime shape `{audit:null, inbox:null, kbgaps:null}`
 *     must NOT count as 3 source errors (REMEDIATION-01 §7, §15).
 *
 * Coverage:
 *   - panel exists in the DOM (overview embed, not a separate page)
 *   - tile figures match the real server runtime shape exactly
 *   - state machine renders the correct chip / trailer / note
 *   - unknown / missing alert levels are NOT inflated into Critical /
 *     Warning tiles
 *   - raw alerts with 0 recognized crit/warn still yields
 *     `available-alerts`, not `available-empty`
 *   - we never fabricate a "0" while the query is pending / null /
 *     errored / permission-denied
 */
describe('DashboardPage — Overview Alerts Summary (REMEDIATION-01)', () => {
  // The Alerts Summary reacts to the same `canRead` verdict the
  // dashboard's permission seam surfaces, which requires the WHO
  // fixture to hold `metrics.view` (or the super-wildcard `*`). The
  // base WHO does NOT carry permissions — it is intentionally
  // permissionless so the existing tests can assert the no-permission
  // state without help. We grant `*` here so the panel can actually
  // render its three populated states.
  const PERMITTED_WHO: Whoami = {
    ...WHO,
    effective_permissions: ['*'],
  }

  beforeEach(() => {
    $whoami.set(PERMITTED_WHO)
  })

  it('renders the Alerts Summary panel inside the Overview', async () => {
    wrap(<DashboardPage />)

    // The panel mounts immediately (even while queries are pending) —
    // the Overview shows it from first paint so the operator knows
    // there is an alerts surface to watch.
    await waitFor(() =>
      expect(screen.getByTestId('console-overview-alerts-summary')).toBeTruthy()
    )
  })

  it('on the ACTUAL healthy server payload shows state=available-empty with 0/0/0', async () => {
    // REMEDIATION-01 §15 — the real contract: three null-valued
    // source entries are NOT three source errors.
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [],
          errors: { audit: null, inbox: null, kbgaps: null },
        },
      })
    )
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('available-empty'), { timeout: 2000 })

    const tiles = ['critical', 'warning', 'source-errors'].map((slot) => {
      const wrapper = screen.getByTestId(`console-alerts-summary-${slot}`)
      const figure = wrapper.querySelector('[data-ec-figure]')

      return figure?.textContent ?? ''
    })

    expect(tiles).toEqual(['0', '0', '0'])
  })

  it('on crit + warn (clean source data) shows state=available-alerts with separated counts', async () => {
    // REMEDIATION-01 §19 — 2 crit + 1 warn, sources all null.
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [
            { code: 'A', level: 'crit', message: 'a' },
            { code: 'B', level: 'crit', message: 'b' },
            { code: 'C', level: 'warn', message: 'c' },
          ],
          errors: { audit: null, inbox: null, kbgaps: null },
        },
      })
    )
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('available-alerts'), { timeout: 2000 })

    const tiles = ['critical', 'warning', 'source-errors'].map((slot) => {
      const wrapper = screen.getByTestId(`console-alerts-summary-${slot}`)
      const figure = wrapper.querySelector('[data-ec-figure]')

      return figure?.textContent ?? ''
    })

    expect(tiles).toEqual(['2', '1', '0'])
  })

  it('on crit + warn + degraded sources shows state=source-errors with counts AND the degraded marker', async () => {
    // REMEDIATION-01 §16, §20 — real degraded contract: 2 audit sources
    // report non-null error strings. Counts render but the operator
    // must see the explicit "SOURCE DATA DEGRADED" marker.
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [
            { code: 'A', level: 'crit', message: 'a' },
            { code: 'B', level: 'crit', message: 'b' },
            { code: 'C', level: 'warn', message: 'c' },
          ],
          errors: { audit: 'missing', inbox: null, kbgaps: 'error: unavailable' },
        },
      })
    )
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('source-errors'), { timeout: 2000 })

    const tiles = ['critical', 'warning', 'source-errors'].map((slot) => {
      const wrapper = screen.getByTestId(`console-alerts-summary-${slot}`)
      const figure = wrapper.querySelector('[data-ec-figure]')

      return figure?.textContent ?? ''
    })

    expect(tiles).toEqual(['2', '1', '2'])

    // §13 — explicit degraded marker, NOT a "healthy" trailer.
    expect(screen.getByTestId('console-alerts-summary-trailer').textContent).toBe(
      'SOURCE DATA DEGRADED'
    )
    expect(screen.getByTestId('console-alerts-summary-degraded-note').textContent).toContain(
      'degraded'
    )
  })

  it('ignores unknown / missing alert levels (no fabrication into Critical/Warning)', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [
            { code: 'A', level: 'info', message: 'a' },
            { code: 'B', message: 'b' }, // level undefined
            { code: 'C', level: 'crit', message: 'c' },
          ],
          errors: { audit: null, inbox: null, kbgaps: null },
        },
      })
    )
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('available-alerts'), { timeout: 2000 })

    const critical = screen.getByTestId('console-alerts-summary-critical')
    const warning = screen.getByTestId('console-alerts-summary-warning')
    expect(critical.querySelector('[data-ec-figure]')?.textContent).toBe('1')
    // No `warn` in the payload → 0, NOT the count of all 3 rows.
    expect(warning.querySelector('[data-ec-figure]')?.textContent).toBe('0')
  })

  it('raw alerts with 0 recognized crit/warn → available-alerts, NOT available-empty (with honest unclassified note)', async () => {
    // REMEDIATION-01 §14 — the operator must NOT see a "0 alerts"
    // surface when the server actually handed us unread alert rows.
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [
            { code: 'A', level: 'info', message: 'a' },
            { code: 'B', level: 'debug', message: 'b' },
          ],
          errors: { audit: null, inbox: null, kbgaps: null },
        },
      })
    )
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('available-alerts'), { timeout: 2000 })

    // The unclassified note surfaces the truth without inflating the
    // Critical / Warning tiles.
    expect(screen.getByTestId('console-alerts-summary-unclassified-note').textContent).toContain(
      '2 unclassified alerts'
    )
  })

  it('on metrics query failure shows state=server-unavailable with em-dashes and an honest note', async () => {
    class MetricsDown extends BaseHermesTransport {
      override request<T>(path: string): Promise<T> {
        if (path.startsWith('/api/health')) {
          return Promise.resolve({ auth_mode: 'strict', ok: true } as T)
        }

        if (path.startsWith('/api/metrics')) {
          return Promise.reject(new HermesApiError(503, 'error', 'metrics_unavailable'))
        }

        // Unused surface in this test — return an empty default rather
        // than chaining into the abstract base method (which TypeScript
        // treats as inaccessible via `super`).
        return Promise.resolve({} as T)
      }
    }
    $transport.set(new MetricsDown())
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('server-unavailable'), { timeout: 2000 })

    // Each tile renders an em-dash (the KpiCard null handling) — the
    // honest "no number to give" symbol, NEVER a fabricated 0.
    const tiles = ['critical', 'warning', 'source-errors'].map((slot) => {
      const wrapper = screen.getByTestId(`console-alerts-summary-${slot}`)
      const figure = wrapper.querySelector('[data-ec-figure]')

      return figure?.textContent ?? ''
    })

    expect(tiles).toEqual(['—', '—', '—'])

    // Honest non-fabricated note appears, so the operator sees WHY the
    // numbers are missing.
    expect(screen.getByTestId('console-alerts-summary-note').textContent).toContain(
      'metrics query unavailable'
    )
  })

  it('on viewer lacking metrics.view shows state=permission-unavailable with em-dashes and an honest note', async () => {
    // Reset the granted permission — this test deliberately exercises
    // the gate being closed. The operator sees the honest verdict.
    $whoami.set(WHO)
    wrap(<DashboardPage />)

    const summary = await screen.findByTestId('console-alerts-summary', {}, { timeout: 2000 })
    await waitFor(() => expect(summary.getAttribute('data-state')).toBe('permission-unavailable'), { timeout: 2000 })

    const tiles = ['critical', 'warning', 'source-errors'].map((slot) => {
      const wrapper = screen.getByTestId(`console-alerts-summary-${slot}`)
      const figure = wrapper.querySelector('[data-ec-figure]')

      return figure?.textContent ?? ''
    })

    expect(tiles).toEqual(['—', '—', '—'])

    expect(screen.getByTestId('console-alerts-summary-note').textContent).toContain(
      'permission required'
    )
  })
})
