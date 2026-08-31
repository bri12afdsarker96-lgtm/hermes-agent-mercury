/**
 * P1-VIS-V3 a11y coverage for `WeComPage`.
 *
 * Locks the screen-reader / heading / status semantics for the
 * productised WeCom status surface:
 *
 *   - heading hierarchy: h1 (PageHeader) → h2 (ConsolePanel titles)
 *     with no level skip.
 *   - The four-state credential string is present in the rendered DOM
 *     (the SC5 contract test enforces this literally, but here we
 *     also assert it lives in a region accessible to assistive tech).
 *   - `callback_health` reads as `unknown · not actively probed` —
 *     it is never silently rewritten to a positive state.
 *   - No button or aria-label exposes the words `credential`,
 *     `secret`, `token`, `rotate`, `reissue`, `install`, or `configure`.
 *   - The page itself advertises a no-write status: no
 *     `data-page-status` value other than the readonly union.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { WeComPage } from './page-wecom'
import { $transport } from './transport'

const WECOM_PARTIAL = {
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
  $transport.set(new FakeHermesTransport({ '/api/wecom-status': WECOM_PARTIAL }))
})

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('WeComPage · a11y (P1-VIS-V3)', () => {
  it('W-A1: page has an h1 "WeCom status" plus h2 panel titles "Integration truth" and "Recent activity"', async () => {
    wrap(<WeComPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'WeCom status' })
    ).toBeTruthy()
    // Wait for the data to resolve before asserting on the panels.
    await screen.findByRole('heading', { level: 2, name: 'Integration truth' })
    expect(screen.getByRole('heading', { level: 2, name: 'Recent activity' })).toBeTruthy()
  })

  it('W-A2: heading sequence never skips a level', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))

    const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(heading =>
      Number(heading.tagName.substring(1))
    )

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('W-A3: four-state credential word "PARTIAL" appears; callback health reads "unknown · not actively probed"', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))

    expect(screen.getAllByText('PARTIAL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/unknown · not actively probed/i)).toBeTruthy()
  })

  it('W-A4: no button or aria-label exposes credential / secret / token / configure / rotate / reissue / install vocabulary', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))

    const blocklist = ['credential', 'secret', 'token', 'rotate', 'reissue', 'configure', 'install']

    for (const term of blocklist) {
      const re = new RegExp(term, 'i')
      expect(screen.queryByRole('button', { name: re })).toBeNull()
    }

    const labels = Array.from(document.querySelectorAll('[aria-label]'))
      .map(el => (el.getAttribute('aria-label') ?? '').toLowerCase())
      .join(' ')

    for (const term of blocklist) {
      expect(labels).not.toContain(term)
    }
  })

  it('W-A5: page wrapper advertises data-page-status="ready" (read-only)', async () => {
    wrap(<WeComPage />)
    await waitFor(() => screen.getByTestId('console-wecom'))
    const page = screen.getByTestId('console-page-wecom')
    expect(page.getAttribute('data-page-status')).toBe('ready')
  })
})
