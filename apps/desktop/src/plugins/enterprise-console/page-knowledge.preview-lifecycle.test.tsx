/**
 * Knowledge page — preview lifecycle / error / empty / not_implemented
 * tests (W1-B2-REMEDIATION-01 §P4 + §P18 + §P14).
 *
 * Each test exercises a single server response for the preview
 * container and asserts the exact QueryBody semantics:
 *   - pending:     Loader (NO kb-preview-body-<id> testid in DOM)
 *   - error:       ErrorState (NO kb-preview-body-<id> testid in DOM)
 *   - not_implemented: EmptyState 'status.module' / 'status.moduleBody'
 *                     (NO kb-preview-body-<id> testid in DOM)
 *   - empty chunks: EmptyState 'no chunks'
 *                  (NO kb-preview-body-<id> testid in DOM)
 *   - ready:       kb-preview-body-<id> testid IS in DOM
 *
 * Pre-split parity: the body testid only exists in the ready branch
 * of QueryBody, never during loading.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { KnowledgePage } from './page-knowledge'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'

const WHO = {
  id: 'admin',
  effective_permissions: ['kb.author', 'kb.upload', 'kb.commit', 'kb.delete'],
  product_capabilities: { knowledge_rag: 'DEV' },
} as never

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const STAGED_UPLOADS = {
  uploads: [
    {
      chunks_committed: 0,
      chunks_total: 5,
      collection: null,
      error_detail: null,
      filename: 'doc.txt',
      size_bytes: 100,
      status: 'staged',
      updated_ts: 1,
      upload_id: 'u1',
    },
  ],
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  promise.catch(() => undefined)

  return { promise, resolve, reject }
}

class PreviewLifecycleTransport extends BaseHermesTransport {
  public preview: Deferred<unknown> = deferred<unknown>()
  public requests: string[] = []

  async request<T>(path: string): Promise<T> {
    this.requests.push(path)

    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    if (path === '/api/knowledge-preview?upload_id=u1') {
      return this.preview.promise as Promise<T>
    }

    throw new Error(`unexpected route: ${path}`)
  }
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

describe('Knowledge preview lifecycle (W1-B2-REMEDIATION-01 §P18)', () => {
  it('pending: body testid absent during loading', async () => {
    const transport = new PreviewLifecycleTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    wrap(<KnowledgePage />)

    const btn = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btn)

    // preview still pending — body testid MUST NOT exist yet
    await waitFor(() => {
      expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
    })

    // The preview request MUST have fired (with upload_id=u1, not empty)
    expect(transport.requests).toContain('/api/knowledge-preview?upload_id=u1')
  })

  it('not_implemented: EmptyState status.module, no body testid', async () => {
    const transport = new PreviewLifecycleTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    transport.preview.reject(
      new HermesApiError(501, 'not_implemented', 'preview_module_unavailable')
    )

    wrap(<KnowledgePage />)

    const btn = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btn)

    // not_implemented → EmptyState with i18n key 'status.module'
    await screen.findByText('status.module')
    expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
  })

  it('ordinary error: ErrorState status.error, no body testid', async () => {
    const transport = new PreviewLifecycleTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    transport.preview.reject(new Error('boom preview'))

    wrap(<KnowledgePage />)

    const btn = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btn)

    await screen.findByText('status.error')
    expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
  })

  it('empty chunks: EmptyState no chunks, no body testid', async () => {
    const transport = new PreviewLifecycleTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    transport.preview.resolve({
      chunks: [],
      stats: { est_cost_usd: 0, pii_forbidden_count: 0, pii_warning_count: 0, total_tokens: 0 },
      status: 'staged',
      total: 0,
    })

    wrap(<KnowledgePage />)

    const btn = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btn)

    // empty → 'no chunks' EmptyState
    await screen.findByText('no chunks')
    // CRITICAL: body testid MUST NOT be in the DOM for the empty
    // branch (this is the pre-split parity check). P4 4.1.
    expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
  })

  it('ready: body testid present, exact pre-split visible copy', async () => {
    const transport = new PreviewLifecycleTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    transport.preview.resolve({
      chunks: [
        { char_count: 5, index: 0, pii_forbidden: 0, pii_warning: 0, text: 'hello world' },
      ],
      stats: { est_cost_usd: 0, pii_forbidden_count: 0, pii_warning_count: 1, total_tokens: 42 },
      status: 'staged',
      total: 3,
    })

    wrap(<KnowledgePage />)

    const btn = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btn)

    const body = await screen.findByTestId('kb-preview-body-u1')
    // Pre-split exact copy: 'N chunks · N tokens · PII forbidden N / warning N'
    // (no est_cost_usd)
    await waitFor(() => {
      expect(body.textContent).toContain('3 chunks')
      expect(body.textContent).toContain('42 tokens')
      expect(body.textContent).toContain('PII forbidden 0')
      expect(body.textContent).toContain('warning 1')
    })
    expect(body.textContent).not.toContain('est_cost_usd')
    // hello world chunk rendered
    expect(screen.getByText('hello world')).toBeTruthy()
  })
})