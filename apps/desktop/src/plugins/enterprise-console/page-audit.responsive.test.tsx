/**
 * P1-VIS-V3 responsive coverage for `AuditPage`.
 *
 * Class-token proof:
 *   - page wrapper bounded by max-w-[96rem]
 *   - filter inputs sit inside a flex-wrap row so they collapse to one
 *     per line on narrow widths
 *   - Timeline rail width is bounded by its own shared primitive (no
 *     w-screen, no min-w- clobber)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { AuditPage } from './page-audit'
import { $whoami } from './session'
import { $transport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  effective_permissions: ['audit.read'],
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
  $transport.set(new FakeHermesTransport({ '/api/audit-list': { events: [] } }))
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('AuditPage · responsive hooks (P1-VIS-V3)', () => {
  it('AU-R1: page wrapper is bounded so it cannot horizontally overflow the viewport', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-page-audit'))
    // AuditFrame wraps the page; it carries the max-w-[96rem] cap.
    const page = screen.getByTestId('console-page-audit')
    const outer = page.parentElement as HTMLElement
    expect(outer.className).toContain('max-w-[96rem]')
  })

  it('AU-R2: filter row is a flex-wrap container, never a nowrap primary control group', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit-action'))
    const actionInput = screen.getByTestId('console-audit-action')
    const row = actionInput.parentElement as HTMLElement
    expect(row.className).toContain('flex-wrap')
    expect(row.className).not.toContain('flex-nowrap')
  })

  it('AU-R3: page never introduces w-screen or nowrap classes', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-page-audit'))
    const page = screen.getByTestId('console-page-audit')
    expect(page.querySelectorAll('.w-screen, .flex-nowrap, .whitespace-nowrap').length).toBe(0)
  })
})
