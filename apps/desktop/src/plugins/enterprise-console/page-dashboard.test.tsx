import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { DashboardPage } from './page-dashboard'
import { $whoami } from './session'
import { $transport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: {
    biz_tasks: { enabled: true, status: 'LIVE' },
    knowledge_rag: { enabled: false, status: 'DEV' }
  },
  role: 'tenant_admin',
  tenant_id: 't1'
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  $whoami.set(WHO)
  $transport.set(
    new FakeHermesTransport({
      '/api/health': { auth_mode: 'strict', ok: true },
      '/api/metrics': { alerts: [] }
    })
  )
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('DashboardPage', () => {
  it('renders live health from the server', async () => {
    wrap(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('console-health-ok').textContent).toBe('ok')
    })
  })

  it('shows each capability with the server maturity — DEV never as live', async () => {
    wrap(<DashboardPage />)

    const caps = await screen.findByTestId('console-capabilities')
    expect(caps.textContent).toContain('knowledge_rag')
    expect(caps.textContent).toContain('DEV')
    expect(caps.textContent).toContain('LIVE')
  })

  it.each([
    ['operator', 'Operator Home'],
    ['supervisor', 'Supervisor Workspace'],
    ['tenant_admin', 'Tenant Admin Overview'],
    ['super_admin', 'Tenant Admin Overview']
  ])('maps server role %s to frozen workspace title', (role, title) => {
    $whoami.set({ ...WHO, role })
    wrap(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
  })

  it('uses a neutral workspace title for an unknown server role', () => {
    $whoami.set({ ...WHO, role: 'future_role' })
    wrap(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy()
  })
})
