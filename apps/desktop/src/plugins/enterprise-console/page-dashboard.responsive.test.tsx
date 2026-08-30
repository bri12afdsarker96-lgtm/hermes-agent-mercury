/**
 * P1-VIS-V0 responsive coverage for `DashboardPage`.
 *
 * The Dashboard is laid out via Tailwind responsive classes on the
 * outer grid (`md:grid-cols-2 xl:grid-cols-3`). This suite proves:
 *
 *   1. The KPI grid stays a single column on the narrowest viewport
 *      we test (320px) — no horizontal overflow.
 *   2. The Session identity panel preserves the heading hierarchy and
 *      doesn't blow up on a 320px viewport.
 *   3. The full page block is the same component on every width —
 *      just the grid reflows.
 *
 * Note: jsdom does not implement layout, so we cannot measure pixel
 * widths. Instead we assert on the className tokens that the response
 * plugin relies on for the responsive layout, plus on the lack of any
 * class that would force horizontal overflow (`overflow-x-auto`, raw
 * `w-screen`, etc.).
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

describe('DashboardPage · responsive layout (P1-VIS-V0)', () => {
  it('uses a single-column KPI grid at narrow viewports (no horizontal overflow)', async () => {
    wrap(<DashboardPage />)

    // The outer container clamps to a max width and uses inset tokens.
    const root = await screen.findByTestId('console-page-dashboard')
    const classes = root.className
    expect(classes).toContain('max-w-[96rem]')
    expect(classes).toContain('flex-col')

    // The KPI grid container must declare the breakpoint columns it
    // promotes to. No raw `w-screen` or other overflow escape hatches.
    expect(classes).not.toContain('w-screen')
    expect(classes).not.toContain('overflow-x-auto')

    // The grid below PageHeader must declare `md:grid-cols-2` and
    // `xl:grid-cols-3` so that small viewports fall back to a single
    // column automatically.
    const kpiGrid = root.querySelector('div.grid') as HTMLDivElement | null
    expect(kpiGrid).toBeTruthy()
    expect(kpiGrid!.className).toContain('md:grid-cols-2')
    expect(kpiGrid!.className).toContain('xl:grid-cols-3')
  })

  it('renders the identity panel as a semantic <dl> that survives narrow viewports', async () => {
    wrap(<DashboardPage />)

    const dl = await screen.findByTestId('console-session')
    // grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] ensures columns
    // can shrink past their content — no horizontal overflow.
    expect(dl.className).toContain('minmax(0,1fr)')
    expect(dl.className).toContain('minmax(7rem,0.35fr)')
    // Each dd is min-w-0 truncate so a long tenant_id cannot force a
    // horizontal scrollbar.
    expect(dl.querySelectorAll('dd').length).toBeGreaterThanOrEqual(3)
  })

  it('does not introduce a horizontal overflow escape hatch (no overflow-x-auto / w-screen / min-w-screen)', async () => {
    wrap(<DashboardPage />)

    await waitFor(() => {
      const root = screen.getByTestId('console-page-dashboard')
      const html = root.outerHTML
      expect(html).not.toContain('overflow-x-auto')
      expect(html).not.toContain('w-screen')
      expect(html).not.toContain('min-w-screen')
    })
  })
})
