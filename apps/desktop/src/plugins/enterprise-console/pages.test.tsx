import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { HermesApiError } from './fetch-transport'
import { AlertsPage } from './page-alerts'
import { ConversationsPage } from './page-conversations'
import { HandoffPage } from './page-handoff'
import { IdentityPage } from './page-identity'
import { KnowledgePage } from './page-knowledge'
import { ProviderPage } from './page-provider'
import { TasksPage } from './page-tasks'
import { UsagePage } from './page-usage'
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

describe('ConversationsPage (partial)', () => {
  it('renders outbox metrics with the server key remapping and calls out the inbound gap', async () => {
    $transport.set(
      new FakeHermesTransport({
        '/api/delivery-outbox': {
          available: true,
          metrics: {
            cancelled_total: 0,
            delivered_total: 7,
            outbox_delivering: 1,
            outbox_pending: 2,
            outbox_retrying: 1,
            permanent_failure_total: 3,
            unknown_delivery_total: 1
          },
          outbox: [
            {
              attempts: 2,
              channel: 'wecom',
              intent_id: 'i1',
              kind: 'reply',
              last_error_class: null,
              next_retry_at: null,
              state: 'sent',
              updated_at: 1_690_000_000
            }
          ]
        }
      })
    )
    wrap(<ConversationsPage />)

    await waitFor(() => expect(screen.getByTestId('console-outbox-metrics')).toBeTruthy())
    const metrics = screen.getByTestId('console-outbox-metrics')
    expect(metrics.textContent).toContain('delivered')
    expect(metrics.textContent).toContain('unknown')
  })
})

describe('IdentityPage (partial)', () => {
  it('lists principals and notes the missing ChannelBinding API', async () => {
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
    expect(screen.getByTestId('console-page-identity').textContent).toContain('ChannelBinding')
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
