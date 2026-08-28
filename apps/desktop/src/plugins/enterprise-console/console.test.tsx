import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CONSOLE_PAGES } from './catalog'
import { $activePage, ConsoleShell } from './console'
import { $whoami } from './session'
import type { Whoami } from './types'

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

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $activePage.set('dashboard')
})

describe('ConsoleShell', () => {
  it('shows the connect gate until the server session is established', () => {
    $whoami.set(null)
    render(<ConsoleShell />)

    expect(screen.queryByTestId('console-connect')).not.toBeNull()
    expect(screen.queryByTestId('enterprise-console')).toBeNull()
  })

  it('renders a nav row for every Phase-1 page once connected', () => {
    $activePage.set('audit') // keep content off the dashboard (which fetches)
    $whoami.set(who({ effective_permissions: ['*'] }))
    render(<ConsoleShell />)

    for (const page of CONSOLE_PAGES) {
      expect(screen.queryByTestId(`console-nav-${page.id}`)).not.toBeNull()
    }
  })

  it('shows a blocked server-gap page honestly, never a fake feature', () => {
    $activePage.set('audit')
    $whoami.set(who({ effective_permissions: ['*'] }))
    render(<ConsoleShell />)

    fireEvent.click(screen.getByTestId('console-nav-audit'))
    const body = screen.getByTestId('console-page-audit')
    expect(body.getAttribute('data-page-status')).toBe('blocked')
  })

  it('denies a page in the UI when the session lacks its permission', () => {
    $activePage.set('audit')
    $whoami.set(who({ effective_permissions: [] })) // no biztask.read
    render(<ConsoleShell />)

    fireEvent.click(screen.getByTestId('console-nav-tasks'))
    const body = screen.getByTestId('console-page-tasks')
    expect(body.getAttribute('data-page-status')).toBe('denied')
  })

  it('labels a DEV-backed page as in-development, not live (Capability Truth)', () => {
    $activePage.set('audit')
    $whoami.set(who({ effective_permissions: ['*'] }))
    render(<ConsoleShell />)

    // PageStatusBadge falls back to the raw i18n key without a registered bundle.
    expect(screen.getByTestId('console-nav-knowledge').textContent).toContain('status.dev')
  })
})
