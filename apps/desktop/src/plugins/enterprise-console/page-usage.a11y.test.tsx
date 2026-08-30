/**
 * Usage / Budget page — a11y / keyboard test (LINE F · REMEDIATION-01).
 *
 * Per LINE F §17, prove:
 *   U-A1: Page has h1 "Usage & budget"
 *   U-A2: Budget figures region is a real <section> with
 *         aria-labelledby paired to a level-2 heading (no h1→h3 skip)
 *   U-A3: Daily token budget has a readable label
 *   U-A4: Real-time usage has a readable label
 *   U-A5: Unavailable value renders as "—" (no fabricated 0 tokens)
 *   U-A6: Availability disclaimer is readable inside its panel
 *   U-A7: Partial status remains honest (data-page-status="partial")
 *
 * No axe dependency.
 *
 * Pure render-only check via @testing-library/react. Uses the
 * existing FakeHermesTransport pattern (same as pages.test.tsx)
 * to set the tenant-profile response so useConsoleQuery resolves.
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

function setTenantProfile(budgetTokens: number | undefined) {
  const fields =
    budgetTokens === undefined
      ? {}
      : { llm: { daily_budget_tokens: budgetTokens } }

  $transport.set(
    new FakeHermesTransport({
      '/api/tenant-profile': { fields, tenant_id: 't1', version: 1 },
    }),
  )
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('Usage a11y (LINE F · REMEDIATION-01)', () => {
  it('U-A1: page has h1 "Usage & budget"', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const h1 = screen.getByRole('heading', { level: 1, name: 'Usage & budget' })
    expect(h1).toBeTruthy()
    expect(h1.tagName.toLowerCase()).toBe('h1')
  })

  it('U-A2: budget figures region is <section> with aria-labelledby + real h2 (no heading skip)', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const region = document.querySelector('[data-testid="console-budget"]') as HTMLElement
    expect(region).toBeTruthy()
    expect(region.tagName.toLowerCase()).toBe('section')
    expect(region.getAttribute('aria-labelledby')).toBe('console-budget-heading')

    const heading = document.getElementById('console-budget-heading') as HTMLElement
    expect(heading).toBeTruthy()
    expect(heading.tagName.toLowerCase()).toBe('h2')
    expect(heading.textContent).toBe('Budget figures')

    // After the page's h1 ("Usage & budget") this h2 is the next heading
    // level — no h1 → h3 skip.
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    const levelSequence = headings.map((h) => Number(h.tagName.substring(1)))

    for (let i = 1; i < levelSequence.length; i++) {
      expect(levelSequence[i] - levelSequence[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('U-A3: Daily token budget has a readable label', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => expect(screen.getByText('Daily token budget')).toBeTruthy())
  })

  it('U-A4: Real-time usage has a readable label', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => expect(screen.getByText('Real-time usage')).toBeTruthy())
  })

  it('U-A5: unavailable value renders as "—" — no fabricated 0', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => screen.getByTestId('console-budget-realtime'))
    const realtime = screen.getByTestId('console-budget-realtime')
    expect(realtime.textContent).toContain('—')
    expect(realtime.textContent).not.toMatch(/\b0 tokens\b/)
    expect(realtime.textContent).not.toMatch(/\b0 spend\b/)
    expect(realtime.textContent).not.toMatch(/healthy usage/i)
  })

  it('U-A6: availability disclaimer is readable inside its panel', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)

    const disclaimer = await waitFor(() =>
      screen.getByText(
        /Budget configuration is authoritative from the tenant profile/,
      ),
    )

    expect(disclaimer).toBeTruthy()
    expect(disclaimer.getAttribute('role')).toBe('status')
    expect(disclaimer.getAttribute('aria-live')).toBe('polite')
  })

  it('U-A7: partial status remains honest', async () => {
    setTenantProfile(5000)
    wrap(<UsagePage />)
    await waitFor(() => screen.getByTestId('console-budget-value'))
    const page = screen.getByTestId('console-page-usage')
    expect(page.getAttribute('data-page-status')).toBe('partial')
  })
})

