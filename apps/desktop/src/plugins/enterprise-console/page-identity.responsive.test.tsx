/**
 * P1-VIS-V3 responsive coverage for `IdentityPage`.
 *
 * Following the pattern of page-dashboard.responsive / page-usage.responsive:
 * pure class-token assertions (jsdom does not run real layout), proving
 * the productised layout collapses correctly on narrow widths and never
 * introduces horizontal overflow.
 *
 * Per P3-PRESENTATION / F:
 *   - The identity grid uses `xl:grid-cols-2` so the two panels collapse
 *     into a single column below 1280px.
 *   - The two DataTables (principals + channel-bindings) stay inside the
 *     shared `--ec-panel-pad` inset; no `w-screen`, no `min-w-` clobbers.
 *
 * HONEST LABEL:
 *   RESPONSIVE_CLASS_HOOK_PROOF (NOT REAL_BROWSER_CLIPPING_PROOF)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { IdentityPage } from './page-identity'
import { $whoami } from './session'
import { $transport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  effective_permissions: ['channel.binding.manage', 'principal.crud'],
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
      '/api/principals': {
        principals: [
          {
            created_ts: 1_700_000_000,
            last_seen_ts: 1_700_001_000,
            name: 'Bob',
            principal_id: 'p2',
            role: 'operator',
            status: 'active',
            tenant_id: 't1'
          }
        ]
      },
      '/api/channel-bindings-list': {
        bindings: [
          {
            binding_id: 'cb1',
            channel: 'wecom',
            created_ts: '2026-08-28T00:00:00+00:00',
            external_subject: 'app1:u1',
            principal_id: 'p2',
            revoked_by_principal_id: null,
            revoked_ts: null,
            status: 'active',
            updated_ts: '2026-08-28T00:00:00+00:00',
            version: 1
          }
        ]
      }
    })
  )
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('IdentityPage · responsive hooks (P1-VIS-V3)', () => {
  it('I-R1: outer page wrapper is bounded by max-w-[96rem] so no horizontal overflow is possible', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))
    const page = screen.getByTestId('console-page-identity')
    expect(page.className).toContain('max-w-[96rem]')
  })

  it('I-R2: principals + bindings grid collapses to one column under xl breakpoint', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-channel-bindings'))

    const grids = document.querySelectorAll(
      '[data-testid="console-page-identity"] > div.grid'
    )

    expect(grids.length).toBeGreaterThanOrEqual(1)

    for (const grid of Array.from(grids)) {
      expect(grid.className).toContain('grid')
      expect(grid.className).toContain('xl:grid-cols-2')
    }
  })

  it('I-R3: page never introduces w-screen or nowrap primary control group', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-channel-bindings'))

    const page = screen.getByTestId('console-page-identity')
    expect(page.querySelectorAll('.w-screen').length).toBe(0)
    expect(page.querySelectorAll('.flex-nowrap').length).toBe(0)
  })

  it('I-R4: principals and bindings DataTables use the shared table primitive (data-slot="data-table")', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-channel-bindings'))

    const tables = page_locals_tables()
    expect(tables.length).toBeGreaterThanOrEqual(2)

    for (const table of tables) {
      const slot = table.getAttribute('data-slot')
      expect(slot).toBe('data-table')
    }
  })
})

function page_locals_tables(): HTMLTableElement[] {
  const page = document.querySelector('[data-testid="console-page-identity"]') as HTMLElement | null

  if (!page) {
    return []
  }

  return Array.from(page.querySelectorAll('table'))
}
