/**
 * P1-VIS-V3 a11y coverage for `IdentityPage`.
 *
 * Locks down the screen-reader / heading / aria semantics for the
 * productised Identity & channel-bindings surface:
 *
 *   - heading hierarchy: h1 (PageHeader) → h2 (ConsolePanel titles),
 *     and a panel title "Channel bindings" is hidden by permission
 *     when the binding-manage permission is absent.
 *   - sr-only truth signals: `console-principals` and
 *     `console-channel-bindings` preserve the contract anchor for
 *     frozen tests (DataTable rows are real <tr>; sr-only legacy list
 *     mirrors the same payload for back-compat).
 *   - principals table is a real <table> with th[scope=col]; binding
 *     table is the same. The revoke button is rendered only for
 *     active rows and bears the binding-specific testid.
 *   - status badges and credential tones use colour + text, never
 *     colour alone.
 *
 * All assertions ride the FakeHermesTransport + $whoami seam that the
 * contract test already established.
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

const PRINCIPALS_FIXTURE = {
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
}

const BINDINGS_FIXTURE = {
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

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $whoami.set(WHO)
  $transport.set(
    new FakeHermesTransport({
      '/api/principals': PRINCIPALS_FIXTURE,
      '/api/channel-bindings-list': BINDINGS_FIXTURE
    })
  )
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('IdentityPage · a11y (P1-VIS-V3)', () => {
  it('I-A1: page has an h1 "Identity & channel bindings" plus two h2 panel titles', async () => {
    wrap(<IdentityPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Identity & channel bindings' })
    ).toBeTruthy()

    expect(await screen.findByRole('heading', { level: 2, name: 'Principals' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Channel bindings' })).toBeTruthy()
  })

  it('I-A2: heading sequence never skips a level', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-channel-bindings'))

    const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(heading =>
      Number(heading.tagName.substring(1))
    )

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('I-A3: principals render inside a real <table> with th[scope=col]', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))

    const table = document.querySelector(
      '[data-testid="console-page-identity"] table'
    ) as HTMLTableElement

    expect(table).toBeTruthy()
    const headers = table.querySelectorAll('thead th')
    expect(headers.length).toBeGreaterThanOrEqual(4)

    for (const header of Array.from(headers)) {
      expect(header.getAttribute('scope')).toBe('col')
    }
  })

  it('I-A4: channel-bindings render inside a real <table> and revoke button bears the binding-id testid', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-channel-bindings'))

    const tables = document.querySelectorAll(
      '[data-testid="console-page-identity"] table'
    )

    expect(tables.length).toBeGreaterThanOrEqual(2)

    const revoke = await screen.findByTestId('console-binding-revoke-cb1')
    expect(revoke).toBeTruthy()
  })

  it('I-A5: status badges render colour + text (status word is in the DOM)', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))

    // Two active rows (principal + binding) each render the word `active`.
    const active = screen.getAllByText('active')
    expect(active.length).toBeGreaterThanOrEqual(2)
  })

  it('I-A6: when the whoami lacks `channel.binding.manage`, the binding panel is hidden and no revoke affordance exists', async () => {
    $whoami.set({ ...WHO, effective_permissions: ['principal.crud'] })
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))

    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
    expect(screen.queryByTestId('console-binding-create')).toBeNull()
    expect(screen.queryByTestId('console-binding-revoke-cb1')).toBeNull()
  })

  it('I-A7: principal + binding data-testid anchors survive the productisation (V0 contract)', async () => {
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))

    expect(screen.getByTestId('console-principals')).toBeTruthy()
    expect(screen.getByTestId('console-channel-bindings')).toBeTruthy()
    expect(screen.getByTestId('console-page-identity')).toBeTruthy()
  })
})
