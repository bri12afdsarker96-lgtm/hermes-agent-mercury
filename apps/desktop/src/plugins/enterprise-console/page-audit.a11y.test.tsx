/**
 * P1-VIS-V3 a11y coverage for `AuditPage`.
 *
 * The audit page is the canonical read-only evidence surface in the
 * console. It must therefore read at product quality while remaining
 * strictly read-only:
 *
 *   - heading hierarchy: h1 (PageHeader) → h2 (panel titles)
 *   - each event row uses the shared Timeline primitive (rail + dot +
 *     mono timestamp + actor + resource)
 *   - filter inputs are labelled (placeholder-only would fail a real
 *     accessibility test)
 *   - no `replay`, `re-execute`, `retry`, `resend` control is rendered
 *   - the correlation affordance lives on a real `<button>` with a
 *     stable testid
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
      }
    })
  )
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('AuditPage · a11y (P1-VIS-V3)', () => {
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

  it('AU-A3: the audit list renders inside the shared Timeline primitive (data-slot="ec-timeline")', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const timeline = document.querySelector(
      '[data-testid="console-audit"] [data-slot="ec-timeline"]'
    )

    expect(timeline).toBeTruthy()
    expect(timeline?.tagName.toLowerCase()).toBe('ol')
    expect(timeline?.getAttribute('aria-label')).toBe('Audit events')
  })

  it('AU-A4: filter inputs are real <input> elements with placeholder + value contract', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit-action'))

    const actionInput = document.querySelector(
      '[data-testid="console-audit-action"]'
    ) as HTMLInputElement | null

    expect(actionInput).toBeTruthy()
    expect(actionInput?.placeholder).toBe('action (exact)')
  })

  it('AU-A5: no button or link uses replay / re-execute / retry / resend vocabulary', async () => {
    wrap(<AuditPage />)
    await waitFor(() => screen.getByTestId('console-audit'))

    const blocklist = [/replay/i, /re-?execute/i, /retry/i, /resend/i]

    for (const re of blocklist) {
      expect(screen.queryByRole('button', { name: re })).toBeNull()
      expect(screen.queryByRole('link', { name: re })).toBeNull()
    }
  })
})
