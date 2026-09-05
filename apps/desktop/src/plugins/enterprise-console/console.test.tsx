import { host } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  it('shows the native-session unavailable gate until the server session is established', () => {
    $whoami.set(null)
    renderShell()

    // The disconnected bootstrap carries the enterprise-console testid so the
    // root takeover's first paint is provable, but the authenticated nav must
    // NOT exist before the native session is established.
    expect(screen.getByTestId('enterprise-console').getAttribute('data-session-state')).toBe('disconnected')
    expect(screen.queryByTestId('console-nav')).toBeNull()
    // R5-B: the Design-System Login surface is the unauthenticated first paint.
    expect(screen.queryByTestId('enterprise-login')).not.toBeNull()
  })

  it('renders a nav row for every non-legacy Phase-1 page once connected (admin sees all)', () => {
    $whoami.set(who({ effective_permissions: ['*'] }))
    renderShell()

    for (const page of CONSOLE_PAGES.filter(page => !page.hidden)) {
      expect(screen.queryByTestId(`console-nav-${page.id}`)).not.toBeNull()
    }

    // Legacy / P1.5 surfaces (provider, alerts) are excluded from the primary
    // authenticated nav — they are not P1 auth rows.
    for (const page of CONSOLE_PAGES.filter(page => page.hidden)) {
      expect(screen.queryByTestId(`console-nav-${page.id}`)).toBeNull()
    }
  })

  it('renders exactly the 10 P1 primary nav rows for an operator (audit row is admin-only)', () => {
    $whoami.set(
      who({
        effective_permissions: [
          'metrics.view',
          'channel.binding.manage',
          'principal.crud',
          'conversation.read',
          'biztask.read',
          'followup.read',
          'reminder.read',
          'kb.author',
          'inbox.list',
          'tenant.profile.read'
        ]
      })
    )
    renderShell()

    expect(screen.getAllByTestId(/^console-nav-/)).toHaveLength(10)
    expect(screen.queryByTestId('console-nav-audit')).toBeNull()
    expect(screen.queryByTestId('console-nav-provider')).toBeNull()
    expect(screen.queryByTestId('console-nav-alerts')).toBeNull()
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

  it('re-homes the Enterprise Assistant through the EXISTING chat route (runtime reuse, no second engine)', () => {
    const navigateSpy = vi.spyOn(host, 'navigate').mockImplementation(() => undefined)
    $whoami.set(who({ effective_permissions: ['*'] }))
    renderShell()

    fireEvent.click(screen.getByTestId('console-open-assistant'))

    expect(navigateSpy).toHaveBeenCalledWith('/')
    navigateSpy.mockRestore()
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
