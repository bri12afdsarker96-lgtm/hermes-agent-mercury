import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { HandoffPage } from './page-handoff'
import { KnowledgePage } from './page-knowledge'
import { ProviderPage } from './page-provider'
import { RemindersPage } from './page-reminders'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest } from './transport'
import type { Whoami } from './types'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

class RecordingTransport extends BaseHermesTransport {
  readonly requests: Array<{ opts?: TransportRequest; path: string }> = []
  readonly #responses: Record<string, unknown>

  constructor(responses: Record<string, unknown> = {}) {
    super()
    this.#responses = responses
  }

  request<T>(path: string, opts?: TransportRequest): Promise<T> {
    this.requests.push({ opts, path })
    const key = path.split('?')[0]

    return Promise.resolve((this.#responses[key] ?? {}) as T)
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function who(partial: Partial<Whoami> = {}): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    effective_permissions: ['*'],
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

describe('Knowledge review flow (author)', () => {
  it('posts kb-gap-author with the typed answer (real server route, authoritative refetch)', async () => {
    const transport = new RecordingTransport({
      '/api/kb-gaps': {
        collections: [],
        count: 1,
        gaps: [
          { biz_line: null, gap_id: 'g1', hits: 1, query: 'how to X', signal: 'no_hit', status: 'new', ts_last: 1 }
        ]
      }
    })

    $whoami.set(who({ product_capabilities: { knowledge_rag: { enabled: false, status: 'DEV' } } }))
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-author-g1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('kb-author-g1'))
    fireEvent.change(screen.getByTestId('kb-author-text-g1'), { target: { value: 'the answer' } })
    fireEvent.click(screen.getByTestId('kb-author-g1-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/kb-gap-author')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/kb-gap-author')
    expect((req?.opts?.body as { gap_id: string; text: string }).gap_id).toBe('g1')
    expect((req?.opts?.body as { text: string }).text).toBe('the answer')
  })
})

describe('Human handoff flow (reply)', () => {
  it('posts handoff-reply for a claimed handoff', async () => {
    const transport = new RecordingTransport({
      '/api/handoffs': {
        available: true,
        handoffs: [
          {
            agent_id: 'me',
            claim_age_s: 5,
            expires_in_s: 100,
            msg_id: 'm1',
            state: 'escalated',
            status: 'claimed',
            text: 'customer needs help',
            thread_id: 'th1'
          }
        ]
      }
    })

    $transport.set(transport)
    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByTestId('console-handoff-reply-m1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-handoff-reply-m1'))
    fireEvent.change(screen.getByTestId('console-handoff-reply-text-m1'), { target: { value: 'on it' } })
    fireEvent.click(screen.getByTestId('console-handoff-reply-m1-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/handoff-reply')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/handoff-reply')
    expect(req?.opts?.body as { msg_id: string; text: string }).toEqual({ msg_id: 'm1', text: 'on it' })
  })
})

describe('Provider set-key (secret hygiene)', () => {
  function providerTransport() {
    return new RecordingTransport({
      '/api/providers': {
        active: 'openai',
        providers: [
          {
            api_key_env: 'OPENAI_API_KEY',
            configured: false,
            default_model: 'gpt',
            key: 'openai',
            kind: 'cloud',
            label: 'OpenAI'
          }
        ]
      }
    })
  }

  it('renders the api key as a password field (never displayed)', async () => {
    const transport = providerTransport()

    $whoami.set(who({ role: 'super_admin' }))
    $transport.set(transport)
    wrap(<ProviderPage />)

    await waitFor(() => expect(screen.getByTestId('console-provider-setkey-openai')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-provider-setkey-openai'))

    const input = screen.getByTestId('console-provider-apikey-openai') as HTMLInputElement
    expect(input.type).toBe('password')
  })

  it('erases the provider secret from renderer state after the dialog closes on success', async () => {
    const transport = providerTransport()

    $whoami.set(who({ role: 'super_admin' }))
    $transport.set(transport)
    wrap(<ProviderPage />)

    await waitFor(() => expect(screen.getByTestId('console-provider-setkey-openai')).toBeTruthy())
    fireEvent.click(screen.getByTestId('console-provider-setkey-openai'))
    fireEvent.change(screen.getByTestId('console-provider-apikey-openai'), { target: { value: 'sk-sensitive-value' } })
    fireEvent.click(screen.getByTestId('console-provider-setkey-openai-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/set-provider-key')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/set-provider-key')
    expect((req?.opts?.body as { api_key: string }).api_key).toBe('sk-sensitive-value')

    await waitFor(() => expect(screen.queryByTestId('console-provider-apikey-openai')).toBeNull())
    fireEvent.click(screen.getByTestId('console-provider-setkey-openai'))
    expect((screen.getByTestId('console-provider-apikey-openai') as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toContain('sk-sensitive-value')
  })
})

describe('Reminder create flow (timezone coherence)', () => {
  it('sends a UTC epoch derived from datetime-local with the matching browser IANA timezone', async () => {
    const transport = new RecordingTransport({ '/api/reminders': { available: true, reminders: [] } })
    const when = '2030-01-02T03:04'
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

    $whoami.set(who({ effective_permissions: ['reminder.read', 'reminder.write'] }))
    $transport.set(transport)
    wrap(<RemindersPage />)

    fireEvent.click(screen.getByTestId('console-reminder-create'))
    expect(screen.getByTestId('console-reminder-timezone').textContent).toContain(timezone)
    fireEvent.change(screen.getByTestId('console-reminder-subject'), { target: { value: 'task-123' } })
    fireEvent.change(screen.getByTestId('console-reminder-when'), { target: { value: when } })
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/reminder-create')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/reminder-create')
    const body = req?.opts?.body as { scheduled_for: number; subject_id: string; timezone: string }
    expect(body.subject_id).toBe('task-123')
    expect(body.timezone).toBe(timezone)
    expect(body.scheduled_for).toBe(Math.floor(new Date(when).getTime() / 1000))
  })
})
