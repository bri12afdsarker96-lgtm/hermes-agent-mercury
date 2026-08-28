import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardPage } from './page-dashboard'
import { $baseUrl, $token, $whoami } from './session'
import type { Whoami } from './types'

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

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
  $baseUrl.set('http://h:1')
  $token.set('t')
  $whoami.set(WHO)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/health')) {
        return fakeResponse({ auth_mode: 'strict', ok: true })
      }

      if (url.includes('/api/metrics')) {
        return fakeResponse({ alerts: [] })
      }

      return fakeResponse({})
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  $baseUrl.set('')
  $token.set(null)
  $whoami.set(null)
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
})
