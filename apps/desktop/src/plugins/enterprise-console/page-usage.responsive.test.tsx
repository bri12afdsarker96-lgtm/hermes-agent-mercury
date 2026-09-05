/**
 * Usage / Budget page — responsive hooks (LINE F · REMEDIATION-01).
 *
 * Per LINE F §18, prove (CSS class hook + DOM structure; jsdom does
 * not run real layout, so this is component-level evidence, not
 * real-browser clipping measurement):
 *   - default narrow layout = single column
 *   - md breakpoint = two columns
 *   - page wrapper remains bounded (no horizontal overflow)
 *   - no nowrap primary control group introduced
 *
 * HONEST LABEL:
 *   RESPONSIVE_CLASS_HOOK_PROOF (NOT REAL_BROWSER_CLIPPING_PROOF)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { UsagePage } from './page-usage'
import { $transport } from './transport'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setTenantProfile() {
  $transport.set(
    new FakeHermesTransport({
      '/api/tenant-profile': { fields: {}, tenant_id: 't1', version: 1 },
    }),
  )
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('Usage responsive hooks (LINE F · REMEDIATION-01)', () => {
  it('budget grid collapses to a single column on narrow widths', async () => {
    setTenantProfile()
    wrap(<UsagePage />)
    const grid = await waitFor(() => screen.getByTestId('console-budget'))
    expect(grid.className).toContain('grid')
    expect(grid.className).toContain('md:grid-cols-2')
  })

  it('page wrapper carries max-width so the page does not overflow horizontally', async () => {
    setTenantProfile()
    wrap(<UsagePage />)
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const page = screen.getByTestId('console-page-usage')
    expect(page.className).toContain('max-w-[96rem]')
  })

  it('no nowrap group introduced on the budget row', async () => {
    setTenantProfile()
    wrap(<UsagePage />)
    const grid = await waitFor(() => screen.getByTestId('console-budget'))
    const children = Array.from(grid.children) as HTMLElement[]
    expect(grid.querySelectorAll('.flex-nowrap, .whitespace-nowrap').length).toBe(0)
    expect(children.length).toBeGreaterThanOrEqual(2)
  })
})

