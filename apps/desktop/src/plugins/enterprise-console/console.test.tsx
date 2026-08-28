import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CONSOLE_PAGES } from './catalog'
import { $activePage, ConsoleShell } from './console'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'
import type { Whoami } from './types'

function renderShell(node: ReactNode = <ConsoleShell />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function who(partial: Partial<Whoami>): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    name: 'alice',
    principal_id: 'p1',
    product_capabilities: {
      knowledge_rag: { enabled: false, status: 'DEV' }
    },
    role: 'super_admin',
    tenant_id: 't1',
    ...partial
  }
}

/** Every Phase-1 page is now a real component that fetches on mount; a transport
 *  whose requests never resolve keeps each page in its Loader state so the shell
 *  renders without a live server (and never a "no active transport" throw). */
class PendingTransport extends BaseHermesTransport {
  request<T>(_path: string, _opts?: TransportRequest): Promise<T> {
    return new Promise<T>(() => undefined)
  }
}

beforeEach(() => {
  $transport.set(new PendingTransport())
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
  $activePage.set('dashboard')
})

describe('ConsoleShell', () => {
  it('shows the connect gate until the server session is established', () => {
    $whoami.set(null)
    renderShell()

    expect(screen.queryByTestId('console-connect')).not.toBeNull()
    expect(screen.queryByTestId('enterprise-console')).toBeNull()
  })

  it('renders a nav row for every Phase-1 page once connected (admin sees all)', () => {
    $whoami.set(who({ effective_permissions: ['*'] }))
    renderShell()

    for (const page of CONSOLE_PAGES) {
      expect(screen.queryByTestId(`console-nav-${page.id}`)).not.toBeNull()
    }
  })

  it('reflects an honest PARTIAL server-gap page, never a fake feature', () => {
    $whoami.set(who({ effective_permissions: ['*'] }))
    renderShell()

    fireEvent.click(screen.getByTestId('console-nav-usage'))
    const body = screen.getByTestId('console-page-usage')
    expect(body.getAttribute('data-page-status')).toBe('partial')
  })

  it('hides a tenant_admin-only nav row (audit) from a viewer who lacks the permission', () => {
    $whoami.set(who({ effective_permissions: ['metrics.view'], role: 'operator' }))
    renderShell()

    // hideWhenUnpermitted: no audit.read → the nav row is absent entirely.
    expect(screen.queryByTestId('console-nav-audit')).toBeNull()
    // A non-hidden page the operator also lacks still shows its row (deny-in-content).
    expect(screen.queryByTestId('console-nav-tasks')).not.toBeNull()
  })

  it('shows the audit nav row for a holder of audit.read', () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    renderShell()

    expect(screen.queryByTestId('console-nav-audit')).not.toBeNull()
  })

  it('denies a page in the UI when the session lacks its permission', () => {
    $whoami.set(who({ effective_permissions: [] })) // no biztask.read
    renderShell()

    fireEvent.click(screen.getByTestId('console-nav-tasks'))
    const body = screen.getByTestId('console-page-tasks')
    expect(body.getAttribute('data-page-status')).toBe('denied')
  })

  it('labels a DEV-backed page as in-development, not live (Capability Truth)', () => {
    $whoami.set(who({ effective_permissions: ['*'] }))
    renderShell()

    // PageStatusBadge falls back to the raw i18n key without a registered bundle.
    expect(screen.getByTestId('console-nav-knowledge').textContent).toContain('status.dev')
  })
})
