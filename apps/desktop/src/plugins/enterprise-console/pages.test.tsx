import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { HermesApiError } from './fetch-transport'
import { AlertsPage } from './page-alerts'
import { AuditPage } from './page-audit'
import { ConversationsPage } from './page-conversations'
import { FollowupPage } from './page-followup'
import { HandoffPage } from './page-handoff'
import { IdentityPage } from './page-identity'
import { KnowledgePage } from './page-knowledge'
import { ProviderPage } from './page-provider'
import { TasksPage } from './page-tasks'
import { UsagePage } from './page-usage'
import { WeComPage } from './page-wecom'
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

describe('TasksPage', () => {
  it('renders real biz-task rows and state', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/biz-tasks': {
          available: true,
          tasks: [
            {
              attempts: 1,
              carrier: 'device',
              max_retries: 3,
              state: 'running',
              task_id: 't1',
              title: 'Task One',
              ts_updated: 1_690_000_000
            }
          ]
        }
      })
    )
    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByTestId('console-tasks')).toBeTruthy())
    expect(screen.getByText('Task One')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    // Control actions present for a non-closed task.
    expect(screen.getByTestId('console-task-retry-t1')).toBeTruthy()
    expect(screen.getByTestId('console-task-close-t1')).toBeTruthy()
  })
})

describe('AlertsPage', () => {
  it('renders the alert message (server shape: level/code/message, not kind/detail)', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/metrics/alerts': {
          alerts: [{ code: 'backlog_over', level: 'crit', message: 'backlog is high', threshold: 3, value: 5 }],
          errors: {},
          generated_ts: 1
        }
      })
    )
    wrap(<AlertsPage />)

    await waitFor(() => expect(screen.getByText('backlog is high')).toBeTruthy())
    expect(screen.getByText('crit')).toBeTruthy()
  })
})

describe('ProviderPage', () => {
  it('shows configured status and marks the active provider (never a key)', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/providers': {
          active: 'openai',
          providers: [
            {
              api_key_env: 'OPENAI_API_KEY',
              configured: true,
              default_model: 'gpt',
              key: 'openai',
              kind: 'cloud',
              label: 'OpenAI'
            }
          ]
        }
      })
    )
    wrap(<ProviderPage />)

    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy())
    expect(screen.getByText('configured')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
  })
})

describe('KnowledgePage', () => {
  it('surfaces the DEV maturity (Capability Truth) and lists gaps', async () => {
    $whoami.set(who({ product_capabilities: { knowledge_rag: { enabled: false, status: 'DEV' } } }))
    $transport.set(
      new FakeHermesTransport({
        '/api/kb-gaps': {
          collections: [],
          count: 1,
          gaps: [
            {
              biz_line: null,
              gap_id: 'g1',
              hits: 2,
              query: 'how to X',
              signal: 'no_hit',
              status: 'new',
              ts_last: 1_690_000_000
            }
          ]
        }
      })
    )
    wrap(<KnowledgePage />)

    expect(screen.getByTestId('console-knowledge-dev').textContent).toContain('DEV')
    await waitFor(() => expect(screen.getByText('how to X')).toBeTruthy())
  })
})

class ModuleUnavailableTransport extends BaseHermesTransport {
  request<T>(): Promise<T> {
    return Promise.reject(new HermesApiError(501, 'not_implemented', 'module not available'))
  }
}

describe('HandoffPage', () => {
  it('shows an honest module-unavailable state on 501 (never faked)', async () => {
    $transport.set(new ModuleUnavailableTransport())
    wrap(<HandoffPage />)

    // usePluginI18n falls back to the raw key without a registered bundle.
    await waitFor(() => expect(screen.getByText('status.module')).toBeTruthy())
  })
})

describe('ConversationsPage (SC3, conversation.read)', () => {
  it('renders inbound rows with ISO timestamps (never fmtEpoch/1970)', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/conversations-inbound': {
          inbound: [
            {
              channel: 'wecom',
              external_chat_id: 'thr_x',
              inbound_id: 'in1',
              message_type: 'text',
              processed_ts: '2026-08-28T01:00:05+00:00',
              received_ts: '2026-08-28T01:00:00+00:00',
              state: 'processed',
              updated_ts: '2026-08-28T01:00:05+00:00'
            }
          ]
        },
        '/api/conversations-outbound': { outbound: [] }
      })
    )
    wrap(<ConversationsPage />)

    await waitFor(() => expect(screen.getByTestId('console-conv-inbound')).toBeTruthy())
    expect(screen.getByText('processed')).toBeTruthy()
    // ISO string rendered as a real local date, not the fmtEpoch(=*1000) 1970 trap.
    expect(screen.queryByText(/1970/)).toBeNull()
  })

  it('drills an outbound row into attempts by internal_message_id (no client owner filter)', async () => {
    const seen: string[] = []

    class Spy extends BaseHermesTransport {
      request<T>(path: string): Promise<T> {
        seen.push(path)

        if (path.startsWith('/api/conversations-outbound')) {
          return Promise.resolve({
            outbound: [
              {
                channel: 'wecom',
                created_ts: '2026-08-28T02:00:00+00:00',
                internal_message_id: 'om1',
                recipient_binding_id: 'b1',
                state: 'sent',
                updated_ts: '2026-08-28T02:00:00+00:00'
              }
            ]
          } as T)
        }

        if (path.startsWith('/api/conversations-attempts')) {
          return Promise.resolve({ attempts: [] } as T)
        }

        return Promise.resolve({ inbound: [] } as T)
      }
    }
    $transport.set(new Spy())
    wrap(<ConversationsPage />)

    fireEvent.click(screen.getByTestId('console-conv-tab-outbound'))
    await waitFor(() => expect(screen.getByTestId('console-outbound-om1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-outbound-om1'))
    await waitFor(() => expect(seen.some(p => p.startsWith('/api/conversations-attempts'))).toBe(true))
    const attemptsCall = seen.find(p => p.startsWith('/api/conversations-attempts'))!
    expect(attemptsCall).toContain('internal_message_id=om1')
    // Owner-scope is server-enforced; the request must not smuggle a scope filter.
    expect(attemptsCall).not.toMatch(/principal_id|role|tenant_id/)
  })
})

describe('IdentityPage (SC2)', () => {
  it('lists principals; hides the ChannelBinding controls without channel.binding.manage', async () => {
    $whoami.set(who({ effective_permissions: ['principal.crud'] }))
    $transport.set(
      new FakeHermesTransport({
        '/api/principals': {
          principals: [
            {
              created_ts: 1,
              last_seen_ts: 2,
              name: 'Bob',
              principal_id: 'p2',
              role: 'operator',
              status: 'active',
              tenant_id: 't1'
            }
          ]
        }
      })
    )
    wrap(<IdentityPage />)

    await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy())
    // No channel.binding.manage → the binding section (and its create control) is absent.
    expect(screen.queryByTestId('console-binding-create')).toBeNull()
    expect(screen.queryByTestId('console-channel-bindings')).toBeNull()
  })

  it('shows the ChannelBinding list + create/revoke for a channel.binding.manage holder', async () => {
    $whoami.set(who({ effective_permissions: ['principal.crud', 'channel.binding.manage'] }))
    $transport.set(
      new FakeHermesTransport({
        '/api/channel-bindings-list': {
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
        },
        '/api/principals': { principals: [] }
      })
    )
    wrap(<IdentityPage />)

    await waitFor(() => expect(screen.getByTestId('console-channel-bindings')).toBeTruthy())
    expect(screen.getByTestId('console-channel-bindings').textContent).toContain('app1:u1')
    expect(screen.getByTestId('console-binding-create')).toBeTruthy()
    expect(screen.getByTestId('console-binding-revoke-cb1')).toBeTruthy()
  })
})

describe('FollowupPage (SC1, read-only)', () => {
  it('renders follow-up rows (string amount, ISO dates) with no write control', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/followup-list': {
          followups: [
            {
              amount: '1234.56',
              business_subject: 'ACME receivable',
              business_team: null,
              created_ts: '2026-08-01T00:00:00+00:00',
              currency: 'CNY',
              expected_receive_date: '2026-09-01',
              followup_id: 'f1',
              followup_type: 'accounts_receivable_followup',
              next_followup_at: null,
              owner_principal_id: 'p1',
              received_at: null,
              status: 'open',
              updated_ts: '2026-08-02T00:00:00+00:00',
              version: 1
            }
          ]
        }
      })
    )
    wrap(<FollowupPage />)

    await waitFor(() => expect(screen.getByTestId('console-followups')).toBeTruthy())
    expect(screen.getByText('ACME receivable')).toBeTruthy()
    expect(screen.getByTestId('console-page-followup').textContent).toContain('1234.56')
    // Read-only: no create/confirm control on the page.
    expect(screen.queryByTestId('console-followup-create')).toBeNull()
  })

  it('surfaces an honest error on 503 (never a faked row)', async () => {
    class Unavailable extends BaseHermesTransport {
      request<T>(): Promise<T> {
        return Promise.reject(new HermesApiError(503, 'error', 'followup_console_unavailable'))
      }
    }
    $transport.set(new Unavailable())
    wrap(<FollowupPage />)

    await waitFor(() => expect(screen.getByText('status.error')).toBeTruthy())
    expect(screen.queryByTestId('console-followups')).toBeNull()
  })
})

describe('AuditPage (SC4, read-only evidence)', () => {
  it('renders events (ISO ts) and carries NO replay/re-execute control', async () => {
    $whoami.set(who({ effective_permissions: ['audit.read'] }))
    $transport.set(
      new FakeHermesTransport({
        '/api/audit-list': {
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
        }
      })
    )
    wrap(<AuditPage />)

    await waitFor(() => expect(screen.getByTestId('console-audit')).toBeTruthy())
    expect(screen.getByText('kb.commit')).toBeTruthy()
    expect(screen.queryByText(/1970/)).toBeNull()
    expect(screen.queryByRole('button', { name: /replay|re-?execute/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /replay|re-?execute/i })).toBeNull()
  })

  it('shows a pick-a-tenant notice for a bare super_admin (no tenant view), firing no request', async () => {
    const seen: string[] = []

    class Spy extends BaseHermesTransport {
      request<T>(path: string): Promise<T> {
        seen.push(path)

        return Promise.resolve({ events: [] } as T)
      }
    }
    $whoami.set(who({ effective_permissions: ['*'], role: 'super_admin', tenant_id: null }))
    $transport.set(new Spy())
    wrap(<AuditPage />)

    expect(screen.getByTestId('console-page-audit').textContent).toContain('pick a tenant')
    expect(seen.some(p => p.startsWith('/api/audit'))).toBe(false)
  })
})

describe('WeComPage (SC5, read-only status)', () => {
  it('renders PARTIAL credential state honestly and never asserts PRESENT from silence', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/wecom-status': {
          wecom: {
            association_state: 'BOUND',
            binding_count: 2,
            callback_health: 'unknown',
            last_delivery_outcome: 'transient',
            last_outbound_at: null,
            last_verified_inbound_at: '2026-08-28T09:00:00+00:00',
            observed_app_config_ref_count: 2,
            runtime_credential_present_count: 1,
            runtime_credential_state: 'PARTIAL'
          }
        }
      })
    )
    wrap(<WeComPage />)

    await waitFor(() => expect(screen.getByTestId('console-wecom')).toBeTruthy())
    const body = screen.getByTestId('console-wecom').textContent ?? ''
    expect(body).toContain('PARTIAL')
    expect(body).toContain('BOUND')
    expect(body).toContain('unknown')
    expect(body).not.toContain('PRESENT')
  })
})

describe('UsagePage (partial)', () => {
  it('shows the real budget and notes usage is unavailable', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/tenant-profile': { fields: { llm: { daily_budget_tokens: 5000 } }, tenant_id: 't1', version: 1 }
      })
    )
    wrap(<UsagePage />)

    await waitFor(() => expect(screen.getByTestId('console-budget-value').textContent).toContain('5,000'))
    expect(screen.getByTestId('console-page-usage').textContent).toContain('Real-time token usage')
  })
})
