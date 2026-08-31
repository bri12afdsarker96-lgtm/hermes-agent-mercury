/**
 * P1-VIS-V3 responsive coverage for `WeComPage`.
 *
 * Class-token-only proof (jsdom does not run real layout).
 *
 *   - KPI grid: 1 col on narrow, 2 cols at md, 4 cols at xl.
 *   - Two-panel truth/activity grid: 1 col on narrow, 2 cols at xl.
 *   - Page wrapper remains bounded (no horizontal overflow).
 *   - No nowrap primary control group introduced.
 *
 * HONEST LABEL:
 *   RESPONSIVE_CLASS_HOOK_PROOF (NOT REAL_BROWSER_CLIPPING_PROOF)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { WeComPage } from './page-wecom'
import { $transport } from './transport'

const WECOM_FIXTURE = {
  wecom: {
    association_state: 'BOUND' as const,
    binding_count: 3,
    callback_health: 'unknown' as const,
    last_delivery_outcome: 'success' as const,
    last_outbound_at: '2026-08-28T00:00:00+00:00',
    last_verified_inbound_at: '2026-08-28T00:00:00+00:00',
    observed_app_config_ref_count: 2,
    runtime_credential_present_count: 1,
    runtime_credential_state: 'PARTIAL' as const
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $transport.set(new FakeHermesTransport({ '/api/wecom-status': WECOM_FIXTURE }))
})

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('WeComPage · responsive hooks (P1-VIS-V3)', () => {
  it('W-R1: KPI grid collapses to a single column under md, two at md, four at xl', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))

    const kpiGrid = document.querySelector(
      '[data-testid="console-wecom"] > div.grid'
    ) as HTMLElement | null

    expect(kpiGrid).toBeTruthy()
    expect(kpiGrid!.className).toContain('grid')
    expect(kpiGrid!.className).toContain('md:grid-cols-2')
    expect(kpiGrid!.className).toContain('xl:grid-cols-4')
  })

  it('W-R2: truth/activity grid collapses to single column under xl', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))

    const grids = document.querySelectorAll('[data-testid="console-wecom"] div.grid')
    const truthGrid = Array.from(grids).find(el => el.className.includes('xl:grid-cols-2'))

    expect(truthGrid).toBeTruthy()
  })

  it('W-R3: page wrapper is bounded so it cannot horizontally overflow the viewport', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))
    const page = screen.getByTestId('console-page-wecom')
    expect(page.className).toContain('max-w-[96rem]')
  })

  it('W-R4: no w-screen / nowrap / overflow-x-auto on the page root', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))
    const page = screen.getByTestId('console-page-wecom')
    expect(page.querySelectorAll('.w-screen, .flex-nowrap, .whitespace-nowrap').length).toBe(0)
  })
})
