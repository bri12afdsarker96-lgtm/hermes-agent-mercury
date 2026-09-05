/**
 * P1-VIS-V0 behavior coverage for `DashboardPage`.
 *
 * Enforces the four-state truth surface in the rendered output, with
 * one assertion per state. Each test fails when the view collapses two
 * different states into the same visual (e.g. "loading == down" or
 * "error == down"), which is the regression we want to guard against
 * for the lifetime of V1 / V2 / V3 visual work.
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
    biz_tasks: { enabled: true, status: 'LIVE' }
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
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('DashboardPage · behavior · healthState (P5)', () => {
  it('healthy → console-health-state === "healthy" + console-health-ok === "ok"', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': { alerts: [] }
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-state').textContent).toBe('healthy')
    })
    expect(screen.getByTestId('console-health-ok').textContent).toBe('ok')
  })

  it('down → console-health-state === "down" + console-health-ok === "down"', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: false },
        '/api/metrics': { alerts: [] }
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-state').textContent).toBe('down')
    })
    expect(screen.getByTestId('console-health-ok').textContent).toBe('down')
  })

  it('error (request refused) → console-health-state === "error" + NO console-health-ok', async () => {
    // No /api/health route → FakeHermesTransport rejects with a 404 HermesApiError
    $transport.set(
      new FakeHermesTransport({
        '/api/metrics': { alerts: [] }
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-state').textContent).toBe('error')
    })
    expect(screen.queryByTestId('console-health-ok')).toBeNull()
  })
})

describe('DashboardPage · behavior · metricsState (P5)', () => {
  it('idle (no alerts key) → console-metrics-state === "idle" + alerts panel renders EmptyState', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        // `metrics.alerts` key intentionally absent → `idle`
        '/api/metrics': {}
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-metrics-state').textContent).toBe('idle')
    })
    // The "Active alerts" panel must still show the EmptyState.
    expect(screen.getByText('no active alerts')).toBeTruthy()
  })

  it('loaded (alerts: []) → console-metrics-state === "loaded"', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': { alerts: [] }
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-metrics-state').textContent).toBe('loaded')
    })
  })

  it('loaded (alerts with rows) → console-metrics-state === "loaded" + rows render', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': {
          alerts: [
            { code: 'QUEUE_LATENCY', level: 'warn', message: 'queue latency above threshold' }
          ]
        }
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-metrics-state').textContent).toBe('loaded')
    })
    const list = await screen.findByTestId('console-alerts')
    expect(list.textContent).toContain('queue latency above threshold')
    expect(list.textContent).toContain('QUEUE_LATENCY')
    expect(list.textContent).toContain('warn')
  })

  it('error (request refused) → console-metrics-state === "error"', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true }
        // no /api/metrics → rejection
      })
    )
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-metrics-state').textContent).toBe('error')
    })
  })
})

describe('DashboardPage · behavior · capabilities / session presence', () => {
  it('renders the capabilities panel when whoami has server-declared caps', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': { alerts: [] }
      })
    )
    wrap(<DashboardPage />)

    const caps = await screen.findByTestId('console-capabilities')
    expect(caps.textContent).toContain('biz_tasks')
    expect(caps.textContent).toContain('LIVE')
  })

  it('omits the session panel when whoami is null (identityState === missing)', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/health': { auth_mode: 'strict', ok: true },
        '/api/metrics': { alerts: [] }
      })
    )
    $whoami.set(null)
    wrap(<DashboardPage />)

    // SessionCardView returns null when whoami is null. The dl testid
    // must therefore be absent.
    await waitFor(() => {
      expect(screen.queryByTestId('console-session')).toBeNull()
    })
  })
})
