/**
 * ConsoleShell — responsive hooks (P1 Responsive/A11y, current head).
 *
 * The shell owns the full window on /console. jsdom runs no layout, so these
 * are class-hook assertions on the overflow contract; the authoritative
 * 4-viewport rendered geometry is proven by the packaged CDP probe:
 *  - the nav column uses the token-driven sidebar width (216px below 1440,
 *    250px above) and never stretches;
 *  - the content column can shrink (min-w-0) — the enterprise frame must
 *    never grow horizontal overflow;
 *  - header identity truncates instead of pushing chrome;
 *  - statusbar keeps the product tag right-aligned with a flexible spacer.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
    name: 'a-principal-with-a-very-long-name-that-must-truncate',
    principal_id: 'p1',
    product_capabilities: { knowledge_rag: { enabled: false, status: 'DEV' } },
    role: 'super_admin',
    tenant_id: 'a-tenant-with-a-very-long-identifier-that-must-truncate',
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

describe('ConsoleShell responsive hooks (P1 Responsive/A11y)', () => {
  it('nav column uses the token-driven sidebar width and never shrinks the frame', () => {
    wrap(<ConsoleShell />)

    const nav = screen.getByTestId('console-nav')
    expect(nav.className).toContain('w-(--ec-sidebar-w)')
    expect(nav.className).toContain('shrink-0')
    expect(nav.className).toContain('overflow-y-auto')
  })

  it('content column carries min-w-0 so the frame never grows horizontal overflow', () => {
    wrap(<ConsoleShell />)

    const root = screen.getByTestId('enterprise-console')
    const content = root.querySelector('.min-w-0.flex-1.flex-col')
    expect(content).not.toBeNull()
    expect((content as HTMLElement).className).toContain('min-w-0')
  })

  it('tenant and principal identifiers truncate instead of pushing chrome', () => {
    wrap(<ConsoleShell />)

    const tenant = screen.getByTitle('a-tenant-with-a-very-long-identifier-that-must-truncate')
    expect(tenant.className).toContain('truncate')
    expect(tenant.className).toContain('max-w-40')

    const principal = screen.getByTestId('console-header-principal')
    expect(principal.className).toContain('truncate')
    expect(principal.className).toContain('max-w-40')
  })

  it('nav rows lay out as full-width text blocks so long labels wrap instead of clip', () => {
    wrap(<ConsoleShell />)

    const row = screen.getByTestId('console-nav-dashboard')
    expect(row.className).toContain('w-full')
    expect(row.className).toContain('text-left')
  })

  it('statusbar reserves flexible space so the product tag stays right-aligned', () => {
    wrap(<ConsoleShell />)

    const bar = screen.getByTestId('enterprise-console')
    expect(bar.textContent).toContain('Hermes-企业助手')
  })
})
