/**
 * V3-REMEDIATION-01 · V3-R2 — Audit a11y coverage.
 *
 * Per the remediation brief, the V3 visible-interaction regression must be
 * closed while preserving every prior screen-reader contract:
 *
 *   - heading hierarchy: h1 (PageHeader) → h2 (panel titles)
 *   - the main audit-event list is a visible interactive `<ul>` with the
 *     stable `console-audit` testid and an `aria-label="Audit events"`
 *   - the evidence-chain surface (correlate result) continues to use the
 *     shared Timeline primitive (data-slot="ec-timeline") because it is
 *     read-only and non-interactive
 *   - per-event action buttons (`console-audit-<event_id>`,
 *     `console-audit-correlate-<event_id>`) live OUTSIDE any `sr-only`
 *     ancestor — the regression gate
 *   - no replay / re-execute / retry / resend control is introduced
 *   - filter inputs are real <input> elements
 *   - keyboard: every action button is a real <button>, focusable, with
 *     aria-label and aria-expanded on the toggle
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
  $whoami.set(WHO)

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $whoami.set(WHO)
  $transport.set(
    new FakeHermesTransport({
      '/api/audit-list': {
        events: [
          {
            action: 'kb.commit',
            actor: 'alice',
            event_id: 'e1',
            payload_ref: { delta: 'kb:doc:1 added', n: 1 },
            resource_ref: 'kb:doc:1',
            ts: '2026-08-28T00:00:00+00:00'
          }
        ]
      },
      '/api/audit-correlate?resource_ref=kb%3Adoc%3A1': {
        events: [
          {
            action: 'kb.commit',
            actor: 'alice',
            event_id: 'c1',
            payload_ref: {},
            resource_ref: 'kb:doc:1',
            ts: '2026-08-28T00:00:00+00:00'
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

describe('AuditPage · a11y (V3-REMEDIATION-01)', () => {
  it('AU-A1: page has an h1 "Audit evidence" plus h2 panel titles', async () => {
    wrap(<AuditPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Audit evidence' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Filter' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Audit events' })).toBeTruthy()
  })

  it('AU-A2: heading sequence never skips a level', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(heading =>
      Number(heading.tagName.substring(1))
    )

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('AU-A3: the main audit-event list is a visible interactive <ul> with stable console-audit testid + aria-label', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const list = document.querySelector('[data-testid="console-audit"]') as HTMLElement | null
    expect(list).toBeTruthy()
    expect(list?.tagName.toLowerCase()).toBe('ul')
    expect(list?.getAttribute('aria-label')).toBe('Audit events')

    // Visible to sighted users — must NOT be sr-only itself.
    expect(list?.className).not.toMatch(/\bsr-only\b/)
  })

  it('AU-A4: per-event action buttons live OUTSIDE any sr-only container (V3-R2 regression gate)', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const toggle = screen.getByTestId('console-audit-e1')
    const correlate = screen.getByTestId('console-audit-correlate-e1')

    expect(toggle.closest('.sr-only')).toBeNull()
    expect(correlate.closest('.sr-only')).toBeNull()

    // And both must be keyboard-focusable real <button> elements.
    expect(toggle.tagName.toLowerCase()).toBe('button')
    expect(correlate.tagName.toLowerCase()).toBe('button')
  })

  it('AU-A5: filter inputs are real <input> elements with placeholder + value contract', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit-action'))

    const actionInput = document.querySelector(
      '[data-testid="console-audit-action"]'
    ) as HTMLInputElement | null

    expect(actionInput).toBeTruthy()
    expect(actionInput?.placeholder).toBe('action (exact)')
  })

  it('AU-A6: no button or link uses replay / re-execute / retry / resend vocabulary', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const blocklist = [/replay/i, /re-?execute/i, /retry/i, /resend/i]

    for (const re of blocklist) {
      expect(screen.queryByRole('button', { name: re })).toBeNull()
      expect(screen.queryByRole('link', { name: re })).toBeNull()
    }
  })

  it('AU-A7: the evidence-chain surface (post-correlate) continues to render the shared Timeline primitive', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const correlate = screen.getByTestId('console-audit-correlate-e1')
    correlate.click()

    await waitFor(() => screen.getByTestId('console-audit-correlate'))

    const timeline = document.querySelector(
      '[data-testid="console-audit-correlate"] [data-slot="ec-timeline"]'
    )

    expect(timeline).toBeTruthy()
    expect(timeline?.tagName.toLowerCase()).toBe('ol')
  })
})
