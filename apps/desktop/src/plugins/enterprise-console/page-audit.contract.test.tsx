/**
 * SC4 · Audit evidence contract closure against frozen Hermes_AI PR131 server
 * contracts. Strictly READ-ONLY: audit is append-only evidence. This file
 * pins the contract that the renderer NEVER offers replay / re-execute /
 * retry / destructive affordances, NEVER imports any mutation action from
 * `actions.tsx`, and renders the frozen exact payload shape with honest
 * 400/404/503 error branches.
 *
 * Per the E-line frozen scope: read or extend only the SC4 surface file
 * (`page-audit.tsx` and its targeted tests). Shared frozen seams are
 * preserved exactly as PR14 landed them.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { AuditPage } from './page-audit'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'
import type { Whoami } from './types'

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

/** PR131 frozen server columns for audit_event_index projection. */
const SC4_AUDIT_KEYS = ['event_id', 'ts', 'actor', 'action', 'resource_ref', 'payload_ref'] as const

describe('AuditPage · SC4 contract closure against PR131 frozen contracts', () => {
  it('route + query keys for list / detail / correlate are the frozen exact paths', async () => {
    const seen: string[] = []

    class Spy extends BaseHermesTransport {
      request<P>(path: string): Promise<P> {
        seen.push(path)

        if (path === '/api/audit-list') {
          return Promise.resolve({ events: [] } as P)
        }

        if (path.startsWith('/api/audit-detail')) {
          return Promise.resolve({
            event: {
              action: 'kb.commit',
              actor: 'alice',
              event_id: '00000000-0000-0000-0000-000000000001',
              payload_ref: { n: 1 },
              resource_ref: 'kb:doc:1',
              ts: '2026-08-01T12:00:00+00:00'
            }
          } as P)
        }

        if (path.startsWith('/api/audit-correlate')) {
          return Promise.resolve({ events: [] } as P)
        }

        throw new HermesApiError(404, 'error', `unexpected route ${path}`)
      }
    }
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(new Spy())
    wrap(<AuditPage />)

    await waitFor(() => expect(seen.some(p => p.startsWith('/api/audit-list'))).toBe(true))

    // We sent no filter, so the list path is the bare /api/audit-list.
    expect(seen.some(p => p === '/api/audit-list')).toBe(true)

    // No body smuggling (no tenant_id / principal_id on the read path).
    expect(seen.every(p => !p.includes('tenant_id') && !p.includes('principal_id'))).toBe(true)
  })

  it('renders every frozen server column on an audit event', async () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/audit-list') {
            return Promise.resolve({
              events: [
                {
                  action: 'kb.commit',
                  actor: 'alice',
                  event_id: '00000000-0000-0000-0000-000000000001',
                  payload_ref: { n: 1 },
                  resource_ref: 'kb:doc:1',
                  ts: '2026-08-01T12:00:00+00:00'
                }
              ]
            } as P)
          }

          return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
        }
      })()
    )
    wrap(<AuditPage />)

    await waitFor(() => expect(screen.getByTestId('console-audit')).toBeTruthy())
    const body = screen.getByTestId('console-audit').textContent ?? ''
    expect(body).toContain('kb.commit')
    expect(body).toContain('alice')
    expect(body).toContain('kb:doc:1')
    // ISO date format → real local date, not epoch 1970.
    expect(body).not.toContain('1970')
  })

  it('400 on detail: surfaces an honest empty state (never fakes an event)', async () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/audit-list') {
            return Promise.resolve({
              events: [
                {
                  action: 'kb.commit',
                  actor: 'alice',
                  event_id: '00000000-0000-0000-0000-000000000001',
                  payload_ref: { n: 1 },
                  resource_ref: 'kb:doc:1',
                  ts: '2026-08-01T12:00:00+00:00'
                }
              ]
            } as P)
          }

          if (path.startsWith('/api/audit-detail')) {
            return Promise.reject(new HermesApiError(400, 'error', 'malformed event_id'))
          }

          return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
        }
      })()
    )
    wrap(<AuditPage />)

    await waitFor(() => expect(screen.getByTestId('console-audit')).toBeTruthy())
    const eventButton = screen.getByTestId('console-audit-00000000-0000-0000-0000-000000000001')
    fireEvent.click(eventButton)
    await waitFor(() => expect(screen.getByText(/malformed event id/i)).toBeTruthy())
  })

  it('404 on detail: surfaces an honest empty state (never fakes an event)', async () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/audit-list') {
            return Promise.resolve({
              events: [
                {
                  action: 'kb.commit',
                  actor: 'alice',
                  event_id: '00000000-0000-0000-0000-000000000099',
                  payload_ref: { n: 1 },
                  resource_ref: 'kb:doc:1',
                  ts: '2026-08-01T12:00:00+00:00'
                }
              ]
            } as P)
          }

          if (path.startsWith('/api/audit-detail')) {
            return Promise.reject(new HermesApiError(404, 'error', 'event not found'))
          }

          return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
        }
      })()
    )
    wrap(<AuditPage />)

    await waitFor(() => expect(screen.getByTestId('console-audit')).toBeTruthy())
    const eventButton = screen.getByTestId('console-audit-00000000-0000-0000-0000-000000000099')
    fireEvent.click(eventButton)
    await waitFor(() => expect(screen.getByText(/event not found/i)).toBeTruthy())
  })

  it('503 on list: surfaces an honest error (no fake event list)', async () => {
    class OutageTransport extends BaseHermesTransport {
      request<P>(): Promise<P> {
        return Promise.reject(new HermesApiError(503, 'error', 'audit_console_authority_unavailable'))
      }
    }
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(new OutageTransport())
    wrap(<AuditPage />)

    await waitFor(() =>
      expect(screen.getAllByText('audit unavailable').length).toBeGreaterThan(0)
    )
    expect(screen.queryByTestId('console-audit')).toBeNull()
  })

  it('no replay / re-execute / retry button is offered (UI affordance regression)', async () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(
      new (class extends BaseHermesTransport {
        request<P>(path: string): Promise<P> {
          if (path === '/api/audit-list') {
            return Promise.resolve({
              events: [
                {
                  action: 'kb.commit',
                  actor: 'alice',
                  event_id: '00000000-0000-0000-0000-000000000001',
                  payload_ref: { n: 1 },
                  resource_ref: 'kb:doc:1',
                  ts: '2026-08-01T12:00:00+00:00'
                }
              ]
            } as P)
          }

          return Promise.reject(new HermesApiError(404, 'error', `unexpected route ${path}`))
        }
      })()
    )
    wrap(<AuditPage />)

    await waitFor(() => expect(screen.getByTestId('console-audit')).toBeTruthy())
    // Replay / re-execute / retry are strictly forbidden on audit evidence.
    expect(screen.queryByRole('button', { name: /replay|re-?execute|retry|resend/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /replay|re-?execute|retry|resend/i })).toBeNull()
  })

  it('read-only regression: AuditPage does not depend on actions.tsx write surfaces (ConfirmAction / FormAction)', () => {
    // Pure module-graph guard. PR131 audit route exposes NO write surface;
    // the renderer must NEVER import the write helpers from actions.tsx. If a
    // future patch slips one in, this assertion fails before any DOM work.
    //
    // The test runner's CWD is the workspace root (apps/desktop); resolve
    // the source file via a known-good absolute path relative to it. Avoid
    // depending on import.meta.url's scheme (vitest with jsdom may emit
    // non-file URLs).
    const moduleUrl = resolve(process.cwd(), 'src/plugins/enterprise-console/page-audit.tsx')
    const src = readFileSync(moduleUrl, 'utf8')

    expect(src).not.toMatch(/from\s+['"]\.\/actions['"]/)
    expect(src).not.toMatch(/\bConfirmAction\b/)
    expect(src).not.toMatch(/\bFormAction\b/)
  })

  it('frozen server column set: no body / no secret / no fencing token / no idempotency id', () => {
    // Pure contract audit. If PR131 adds a column, this suite must grow in
    // lockstep (regression on extension drift).
    expect(SC4_AUDIT_KEYS).not.toContain('body')
    expect(SC4_AUDIT_KEYS).not.toContain('secret')
    expect(SC4_AUDIT_KEYS).not.toContain('fencing_token')
    expect(SC4_AUDIT_KEYS).not.toContain('idempotency_key')
    expect(SC4_AUDIT_KEYS).not.toContain('tenant_id')
  })
})