/**
 * P1-VIS-V3 behavior coverage for `IdentityPage`.
 *
 * Exercises the only two write affordances the productised page exposes:
 *
 *   - Create channel binding — fires FormAction submit with the exact
 *     frozen body shape `{ channel, external_subject, principal_id }` and
 *     triggers the authoritative refetch against `/api/channel-bindings-list`.
 *
 *   - Revoke channel binding — opens ConfirmAction, confirms, fires POST
 *     to `/api/channel-binding-revoke` with `{ binding_id }`, triggers the
 *     authoritative refetch.
 *
 * Permission affordance is also re-verified here (not just in the contract
 * test) so that the productised layout's permission gate is exercised
 * end-to-end through the rendered DOM.
 *
 * No new server capability is exercised. No secret / credential is
 * accepted by the form. No replay / retry surface is introduced.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { IdentityPage } from './page-identity'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'
import type { Whoami } from './types'

const WHO_BINDING_MANAGER: Whoami = {
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

const WHO_NO_BINDING_MANAGE: Whoami = {
  ...WHO_BINDING_MANAGER,
  effective_permissions: ['principal.crud']
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

interface RequestLog {
  body?: unknown
  method?: string
  path: string
}

class SpyTransport extends BaseHermesTransport {
  readonly requests: RequestLog[] = []
  private bindingRows: unknown[] = []

  setBindingRows(rows: unknown[]) {
    this.bindingRows = rows
  }

  async request<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    this.requests.push({ body: opts?.body, method: opts?.method, path })

    if (path === '/api/principals') {
      return {
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
      } as T
    }

    if (path === '/api/channel-bindings-list') {
      return { bindings: this.bindingRows } as T
    }

    if (path === '/api/channel-binding-create') {
      // After create, authoritative refetch must reflect the new binding.
      this.bindingRows = [
        {
          binding_id: 'cb-new',
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

      return { ok: true } as T
    }

    if (path === '/api/channel-binding-revoke') {
      this.bindingRows = []

      return { ok: true } as T
    }

    throw new Error(`unexpected route ${path}`)
  }
}

beforeEach(() => {
  $whoami.set(WHO_BINDING_MANAGER)
  $transport.set(new SpyTransport())
})

afterEach(() => {
  cleanup()
  $whoami.set(null)
  $transport.set(null)
})

describe('IdentityPage · behavior (P1-VIS-V3)', () => {
  it('I-B1: create-channel-binding submits the exact frozen body and authoritative-refetches', async () => {
    const spy = new SpyTransport()
    $transport.set(spy)
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-binding-create'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('console-binding-create'))
    })
    await waitFor(() => screen.getByTestId('console-binding-create-channel'))

    await act(async () => {
      fireEvent.change(screen.getByTestId('console-binding-create-channel'), {
        target: { value: 'wecom' }
      })
      fireEvent.change(screen.getByTestId('console-binding-create-subject'), {
        target: { value: 'app1:u1' }
      })
      fireEvent.change(screen.getByTestId('console-binding-create-principal'), {
        target: { value: 'p2' }
      })
      fireEvent.click(screen.getByTestId('console-binding-create-submit'))
    })

    // Authoritative refetch: the create must trigger at least 2 list calls.
    await waitFor(() => {
      const listCalls = spy.requests.filter(r => r.path === '/api/channel-bindings-list').length
      expect(listCalls).toBeGreaterThanOrEqual(2)
    })

    const createCall = spy.requests.find(r => r.path === '/api/channel-binding-create')
    expect(createCall).toBeTruthy()
    expect(createCall?.method).toBe('POST')
    expect(createCall?.body).toEqual({
      channel: 'wecom',
      external_subject: 'app1:u1',
      principal_id: 'p2'
    })
  })

  it('I-B2: revoke-channel-binding submits { binding_id } and authoritative-refetches', async () => {
    const spy = new SpyTransport()
    spy.setBindingRows([
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
    ])
    $transport.set(spy)
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-binding-revoke-cb1'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('console-binding-revoke-cb1'))
    })

    const confirmBtn = await screen.findByRole('button', { name: /confirm/i })

    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    await waitFor(() => {
      const listCalls = spy.requests.filter(r => r.path === '/api/channel-bindings-list').length
      expect(listCalls).toBeGreaterThanOrEqual(2)
    })

    const revokeCall = spy.requests.find(r => r.path === '/api/channel-binding-revoke')
    expect(revokeCall).toBeTruthy()
    expect(revokeCall?.method).toBe('POST')
    expect(revokeCall?.body).toEqual({ binding_id: 'cb1' })
  })

  it('I-B3: without `channel.binding.manage` the page hides the binding panel and every binding-affordance testid', async () => {
    $whoami.set(WHO_NO_BINDING_MANAGE)
    wrap(<IdentityPage />)
    await waitFor(() => screen.getByTestId('console-principals'))

    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
    expect(screen.queryByTestId('console-binding-create')).toBeNull()
    expect(screen.queryByTestId('console-binding-revoke-cb1')).toBeNull()
  })
})
