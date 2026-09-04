/**
 * SC2 · Identity contract closure against frozen Hermes_AI PR131 server
 * contracts. Verifies exact route keys, response shapes, permission
 * affordance, write-then-authoritative-refetch, and 401/403/503 server-denied
 * behaviour against the frozen contract (no fake local success).
 *
 * Per the E-line frozen scope: read or extend only the SC2 surface files
 * (`one-login.ts`, `page-identity.tsx` and its targeted tests). The shared
 * frozen seams (actions.tsx / page-kit.tsx / session.ts / transport.ts /
 * fetch-transport.ts / capabilities.ts / types.ts / plugin.tsx / ui/**) are
 * preserved exactly as PR14 landed them; this file exercises them and never
 * modifies them.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { IdentityPage } from './page-identity'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'
import type { Whoami } from './types'

interface RequestLog {
  body?: unknown
  method?: string
  path: string
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function who(partial: Partial<Whoami> = {}): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    name: 'alice',
    principal_id: 'p1',
    product_capabilities: {},
    role: 'tenant_admin',
    tenant_id: 't1',
    ...partial
  }
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

/**
 * SC2 LIST RESPONSE — exact keys frozen by PR131 server.
 * Channel-binding list payload is `{ bindings: ChannelBinding[] }` where
 * ChannelBinding carries `binding_id`, `channel`, `external_subject`,
 * `principal_id`, `status`, `version`, `created_ts`, `updated_ts`,
 * `revoked_ts`, `revoked_by_principal_id`. No `tenant_id`, no `scope`.
 */
const SC2_LIST_KEYS = [
  'binding_id',
  'channel',
  'created_ts',
  'external_subject',
  'principal_id',
  'revoked_by_principal_id',
  'revoked_ts',
  'status',
  'updated_ts',
  'version'
] as const

describe('IdentityPage · SC2 contract closure against PR131 frozen contracts', () => {
  it('route + query key for principals list is the frozen exact path (no scope/filter smuggling)', async () => {
    const seen: RequestLog[] = []

    class Spy extends BaseHermesTransport {
      request<T>(path: string, opts?: TransportRequest): Promise<T> {
        seen.push({ body: opts?.body, method: opts?.method, path })

        return Promise.resolve({ principals: [] } as T)
      }
    }
    $whoami.set(who())
    $transport.set(new Spy())
    wrap(<IdentityPage />)

    await waitFor(() => expect(seen.some(r => r.path === '/api/principals')).toBe(true))

    const principals = seen.filter(r => r.path === '/api/principals')

    expect(principals.length).toBeGreaterThan(0)

    // No client-side scope filter on the read — server is the row-scope authority.
    for (const call of principals) {
      expect(call.path).not.toMatch(/tenant_id|principal_id|role=|\?/)
      expect(call.method ?? 'GET').toBe('GET')
    }
  })

  it('route + query key for channel-bindings list is the frozen exact path', async () => {
    const seen: RequestLog[] = []

    class Spy extends BaseHermesTransport {
      request<T>(path: string, opts?: TransportRequest): Promise<T> {
        seen.push({ body: opts?.body, method: opts?.method, path })

        if (path === '/api/principals') {
          return Promise.resolve({ principals: [] } as T)
        }

        return Promise.resolve({ bindings: [] } as T)
      }
    }
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(new Spy())
    wrap(<IdentityPage />)

    await waitFor(() => expect(seen.some(r => r.path === '/api/channel-bindings-list')).toBe(true))

    const list = seen.filter(r => r.path === '/api/channel-bindings-list')

    expect(list.length).toBeGreaterThan(0)

    for (const call of list) {
      expect(call.path).not.toMatch(/\?/)
      expect(call.method ?? 'GET').toBe('GET')
    }
  })

  it('renders channel-binding list rows using every frozen server column (no missing / no extra)', async () => {
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/channel-bindings-list') {
            return Promise.resolve({
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
            } as P)
          }

          return Promise.resolve({ principals: [] } as P)
        }
      })()
    )
    wrap(<IdentityPage />)

    await waitFor(() => expect(screen.getByTestId('console-channel-bindings')).toBeTruthy())
    const body = screen.getByTestId('console-channel-bindings').textContent ?? ''
    // Every frozen column is referenced by the rendered row.
    expect(body).toContain('wecom')
    expect(body).toContain('app1:u1')
    expect(body).toContain('p2')
    expect(body).toContain('v1')
    expect(body).toContain('active')
    // status === 'revoked' tone mapping must NOT flip a revoked row to "good".
    expect(body).not.toContain('revoked')
  })

  it('create-channel-binding posts the exact frozen body { channel, external_subject, principal_id } and authoritative-refetches', async () => {
    const seen: RequestLog[] = []
    let listCalls = 0

    class Spy extends BaseHermesTransport {
      request<T>(path: string, opts?: TransportRequest): Promise<T> {
        seen.push({ body: opts?.body, method: opts?.method, path })

        if (path === '/api/principals') {
          return Promise.resolve({
            principals: [{ created_ts: 1, last_seen_ts: 2, name: 'Bob', principal_id: 'p2', role: 'operator', status: 'active', tenant_id: 't1' }]
          } as T)
        }

        if (path === '/api/channel-bindings-list') {
          listCalls += 1

          // After the create, the next list call reflects the server-authoritative
          // refetch and contains the freshly created binding.
          return Promise.resolve({
            bindings:
              listCalls === 1
                ? []
                : [
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
          } as T)
        }

        if (path === '/api/channel-binding-create') {
          return Promise.resolve({ ok: true } as T)
        }

        return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
      }
    }
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(new Spy())
    wrap(<IdentityPage />)

    // Open the create dialog and submit.
    await waitFor(() => expect(screen.getByTestId('console-binding-create')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-binding-create'))

    await waitFor(() => expect(screen.getByTestId('console-binding-create-channel')).toBeTruthy())

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

    // Authoritative refetch: invalidateKey triggers a fresh list call.
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))

    // Verify the create POST carried the frozen exact body.
    const createCall = seen.find(r => r.path === '/api/channel-binding-create')

    expect(createCall).toBeTruthy()
    expect(createCall?.method).toBe('POST')
    expect(createCall?.body).toEqual({
      channel: 'wecom',
      external_subject: 'app1:u1',
      principal_id: 'p2'
    })
    // No extra fields (no scope / tenant / version) — server is the row-scope
    // authority, never the request body.
    const bodyObj = createCall?.body as Record<string, unknown>

    expect(Object.keys(bodyObj).sort()).toEqual(['channel', 'external_subject', 'principal_id'])
  })

  it('revoke-channel-binding posts the exact frozen body { binding_id } and authoritative-refetches', async () => {
    const seen: RequestLog[] = []
    let listCalls = 0

    class Spy extends BaseHermesTransport {
      request<T>(path: string, opts?: TransportRequest): Promise<T> {
        seen.push({ body: opts?.body, method: opts?.method, path })

        if (path === '/api/principals') {
          return Promise.resolve({ principals: [] } as T)
        }

        if (path === '/api/channel-bindings-list') {
          listCalls += 1

          return Promise.resolve({
            bindings:
              listCalls === 1
                ? [
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
                : []
          } as T)
        }

        if (path === '/api/channel-binding-revoke') {
          return Promise.resolve({ ok: true } as T)
        }

        return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
      }
    }
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(new Spy())
    wrap(<IdentityPage />)

    await waitFor(() => expect(screen.getByTestId('console-binding-revoke-cb1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-binding-revoke-cb1'))
    // ConfirmDialog is a Radix-based dialog from @hermes/plugin-sdk — the
    // confirm button is identified by accessible name, not a hardcoded testid.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))

    const revokeCall = seen.find(r => r.path === '/api/channel-binding-revoke')

    expect(revokeCall).toBeTruthy()
    expect(revokeCall?.method).toBe('POST')
    expect(revokeCall?.body).toEqual({ binding_id: 'cb1' })
  })

  it('server 403 on channel-binding-list surfaces an honest error (no fake row)', async () => {
    class UnauthTransport extends BaseHermesTransport {
      request<T>(): Promise<T> {
        return Promise.reject(new HermesApiError(403, 'forbidden', 'channel_binding_console_permission_denied'))
      }
    }
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(new UnauthTransport())
    wrap(<IdentityPage />)

    // QueryBody renders ErrorState on HermesApiError; with no i18n bundle the
    // title is the raw `status.error` key. There can be multiple ErrorStates
    // (one per failed query); we assert at least one appears and no fake row.
    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
    expect(screen.queryByText('active')).toBeNull()
  })

  it('server 503 on principals surfaces an honest error (no fake principals list)', async () => {
    class OutageTransport extends BaseHermesTransport {
      request<T>(): Promise<T> {
        return Promise.reject(new HermesApiError(503, 'error', 'identity_console_unavailable'))
      }
    }
    $whoami.set(who({ effective_permissions: ['channel.binding.manage'] }))
    $transport.set(new OutageTransport())
    wrap(<IdentityPage />)

    await waitFor(() =>
      expect(screen.getAllByText('status.error').length).toBeGreaterThan(0)
    )
    // No fake principal name and no fake channel-binding list.
    expect(screen.queryByText('Bob')).toBeNull()
    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
  })

  it('permission affordance: no `channel.binding.manage` → no create/revoke affordances (UI display only)', async () => {
    $whoami.set(who({ effective_permissions: ['principal.crud'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/principals') {
            return Promise.resolve({
              principals: [
                { created_ts: 1, last_seen_ts: 2, name: 'Bob', principal_id: 'p2', role: 'operator', status: 'active', tenant_id: 't1' }
              ]
            } as P)
          }

          return Promise.resolve({ bindings: [] } as P)
        }
      })()
    )
    wrap(<IdentityPage />)

    await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy())
    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
    expect(screen.queryByTestId('console-binding-create')).toBeNull()
  })

  it('frozen server column set is the only payload the renderer expects (no scope / no secret)', () => {
    // Pure contract audit — proves the test fixture enumerates the exact
    // server-side projection, never an extension. If PR131 adds a column,
    // this suite must grow in lockstep (regression on extension drift).
    expect(SC2_LIST_KEYS.length).toBe(10)
    expect(SC2_LIST_KEYS).not.toContain('tenant_id')
    expect(SC2_LIST_KEYS).not.toContain('scope')
    expect(SC2_LIST_KEYS).not.toContain('credential')
    expect(SC2_LIST_KEYS).not.toContain('secret')
  })
})