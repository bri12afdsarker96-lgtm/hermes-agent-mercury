/**
 * ConsoleShell — a11y / landmark test (P1 Responsive/A11y, current head).
 *
 * The enterprise shell is the authenticated product frame; its landmark
 * structure and programmatic nav state are gate-level surfaces (P9.3):
 *  - one navigation landmark with an accessible name;
 *  - the active nav row is programmatically exposed via aria-current;
 *  - header identity and both header actions carry accessible names;
 *  - the assistant entry reuses the existing chat runtime seam.
 */

import { host } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $activePage, ConsoleShell } from './console'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'
import type { Whoami } from './types'

class PendingTransport extends BaseHermesTransport {
  request<T>(_path: string, _opts?: TransportRequest): Promise<T> {
    return new Promise<T>(() => undefined)
  }
}

function who(): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    effective_permissions: ['*'],
    name: 'alice',
    principal_id: 'p1',
    product_capabilities: { knowledge_rag: { enabled: false, status: 'DEV' } },
    role: 'super_admin',
    tenant_id: 't1'
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $transport.set(new PendingTransport())
  $whoami.set(who())
  $activePage.set('dashboard')
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
  $activePage.set('dashboard')
})

describe('ConsoleShell a11y (P1 Responsive/A11y)', () => {
  it('exposes exactly one navigation landmark with an accessible name', () => {
    wrap(<ConsoleShell />)

    const navs = screen.getAllByRole('navigation')
    expect(navs).toHaveLength(1)
    expect(navs[0].getAttribute('aria-label')).toBe('Enterprise console')
  })

  it('marks the active nav row programmatically with aria-current', () => {
    wrap(<ConsoleShell />)

    const active = screen.getByTestId('console-nav-dashboard')
    expect(active.getAttribute('aria-current')).toBe('page')
    const inactive = screen.getByTestId('console-nav-knowledge')
    expect(inactive.getAttribute('aria-current')).toBeNull()
  })

  it('switching pages moves aria-current to the newly active row', () => {
    wrap(<ConsoleShell />)

    fireEvent.click(screen.getByTestId('console-nav-knowledge'))

    expect(screen.getByTestId('console-nav-knowledge').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('console-nav-dashboard').getAttribute('aria-current')).toBeNull()
  })

  it('brand lockup carries the product accessible name', () => {
    wrap(<ConsoleShell />)

    expect(screen.getByLabelText('Hermes-企业助手')).not.toBeNull()
  })

  it('header identity and actions carry accessible names', () => {
    wrap(<ConsoleShell />)

    expect(screen.getByRole('button', { name: /AI 助理|assistant.open/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /session.disconnect|断开/ })).not.toBeNull()
    expect(screen.getByTestId('console-header-principal').textContent).toBe('alice')
  })

  it('assistant entry reuses the existing chat runtime navigation seam', () => {
    const navigateSpy = vi.spyOn(host, 'navigate').mockImplementation(() => undefined)
    wrap(<ConsoleShell />)

    fireEvent.click(screen.getByTestId('console-open-assistant'))

    expect(navigateSpy).toHaveBeenCalledWith('/')
    navigateSpy.mockRestore()
  })
})
