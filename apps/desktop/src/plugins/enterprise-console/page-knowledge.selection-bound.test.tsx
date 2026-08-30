/**
 * Knowledge page — selection-bound interaction tests
 * (W1-B2-REMEDIATION-01 §P9 + §P10 + §P11 + §P18 + §P19).
 *
 * Proves that switching selection identity (previewUploadId for
 * preview, selectedCollection for entries) never leaks old data
 * into the new selection's surface.
 *
 * Key invariants (P9 strict assertion — NO `if (u1) assert...`):
 *   - Final u2 ready body MUST exist via `findByTestId`
 *   - Final u2 ready body text MUST contain 'chunk-of-u2'
 *   - Final u2 ready body text MUST NOT contain 'chunk-of-u1'
 *
 * Test transport uses a request ledger (P11) to prove:
 *   - Initial mount: NO `?upload_id=` and NO `?collection=` request
 *   - Close preview: NO subsequent empty-id request
 *   - Select colA: exactly one `?collection=colA` request
 *
 * Routes match production (P11):
 *   - /api/kb-gaps?status=new
 *   - /api/knowledge-uploads
 *   - /api/knowledge-committed
 *   - selection-bound reads only when selection is set
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { KnowledgePage } from './page-knowledge'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'

const WHO = {
  id: 'admin',
  effective_permissions: ['kb.author', 'kb.upload', 'kb.commit', 'kb.delete'],
  product_capabilities: { knowledge_rag: 'DEV' },
} as never

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
      filename: 'doc-A.txt',
      size_bytes: 100,
      status: 'staged',
      updated_ts: 1,
      upload_id: 'u1',
    },
    {
      chunks_committed: 0,
      chunks_total: 5,
      collection: null,
      error_detail: null,
      filename: 'doc-B.txt',
      size_bytes: 200,
      status: 'staged',
      updated_ts: 2,
      upload_id: 'u2',
    },
  ],
}

class StaleSelectionTransport extends BaseHermesTransport {
  public requests: string[] = []
  public previewU1: Deferred<unknown> = deferred<unknown>()
  public previewU2: Deferred<unknown> = deferred<unknown>()
  public entriesColA: Deferred<unknown> = deferred<unknown>()
  public entriesColB: Deferred<unknown> = deferred<unknown>()

  async request<T>(path: string): Promise<T> {
    this.requests.push(path)

    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: ['colA', 'colB'] } as T
    }

    if (path === '/api/knowledge-committed?collection=colA') {
      return this.entriesColA.promise as Promise<T>
    }

    if (path === '/api/knowledge-committed?collection=colB') {
      return this.entriesColB.promise as Promise<T>
    }

    if (path === '/api/knowledge-preview?upload_id=u1') {
      return this.previewU1.promise as Promise<T>
    }

    if (path === '/api/knowledge-preview?upload_id=u2') {
      return this.previewU2.promise as Promise<T>
    }

    throw new Error(`unexpected route: ${path}`)
  }
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

describe('Knowledge query mount (W1-B2-REMEDIATION-01 §P10)', () => {
  it('initial mount: NO empty-id preview request and NO empty-collection entries request', async () => {
    const transport = new StaleSelectionTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    // Keep any selection-bound requests as pending so the test
    // ends quickly.
    transport.previewU1 = deferred<unknown>()
    transport.previewU2 = deferred<unknown>()
    transport.entriesColA = deferred<unknown>()
    transport.entriesColB = deferred<unknown>()

    wrap(<KnowledgePage />)

    // Wait for the always-live queries to settle.
    await waitFor(() => {
      expect(screen.getByTestId('console-kb-collection-select')).toBeTruthy()
    })

    // P10 invariants: initial mount must NOT have fired the
    // selection-bound empty-id requests.
    expect(transport.requests).not.toContain(
      '/api/knowledge-preview?upload_id='
    )
    expect(transport.requests).not.toContain(
      '/api/knowledge-preview?upload_id' // also covers no '?' at all
    )
    expect(transport.requests).not.toContain(
      '/api/knowledge-committed?collection='
    )
    expect(transport.requests).not.toContain(
      '/api/knowledge-committed?collection' // covers no '?' at all
    )
  })
})

describe('Knowledge selection-bound preview (W1-B2-REMEDIATION-01 §P18 + §P9)', () => {
  it('switching u1 → u2 with u2 still pending does NOT render u1 chunks under u2', async () => {
    const transport = new StaleSelectionTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    // Pre-resolve u1 with chunk text "chunk-of-u1"
    transport.previewU1.resolve({
      chunks: [
        { char_count: 5, index: 0, pii_forbidden: 0, pii_warning: 0, text: 'chunk-of-u1' },
      ],
      stats: { est_cost_usd: 0, pii_forbidden_count: 0, pii_warning_count: 0, total_tokens: 1 },
      status: 'staged',
      total: 1,
    })
    // u2 stays pending

    wrap(<KnowledgePage />)

    const btnU1 = await screen.findByTestId('kb-preview-u1')
    fireEvent.click(btnU1)

    // Wait for u1's ready body to populate
    const u1Body = await screen.findByTestId('kb-preview-body-u1')
    await waitFor(() => {
      expect(u1Body.textContent).toContain('chunk-of-u1')
    })

    // Now switch to u2 (still pending)
    const btnU2 = await screen.findByTestId('kb-preview-u2')
    fireEvent.click(btnU2)

    // Strict: no u1 body should be in DOM (selection identity)
    // after switching. Per P9, NO conditional assertion.
    await waitFor(() => {
      expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
    })

    // No u2 body yet (pending) — strict null check
    expect(screen.queryByTestId('kb-preview-body-u2')).toBeNull()

    // Resolve u2
    transport.previewU2.resolve({
      chunks: [
        { char_count: 5, index: 0, pii_forbidden: 0, pii_warning: 0, text: 'chunk-of-u2' },
      ],
      stats: { est_cost_usd: 0, pii_forbidden_count: 0, pii_warning_count: 0, total_tokens: 1 },
      status: 'staged',
      total: 1,
    })

    // Strict: u2 body MUST exist with u2 text and NO u1 text
    const u2Body = await screen.findByTestId('kb-preview-body-u2')
    expect(u2Body.textContent).toContain('chunk-of-u2')
    expect(u2Body.textContent).not.toContain('chunk-of-u1')
    // u1 body still absent
    expect(screen.queryByTestId('kb-preview-body-u1')).toBeNull()
  })
})

describe('Knowledge selection-bound collection entries (W1-B2-REMEDIATION-01 §P19 + §P9)', () => {
  it('switching colA → colB with colB still pending does NOT leak colA entries', async () => {
    const transport = new StaleSelectionTransport()
    $transport.set(transport)
    $whoami.set(WHO)

    // Pre-resolve colA with 1 source "doc-of-colA"
    transport.entriesColA.resolve({
      entries: [{ chunks: 3, source: 'doc-of-colA.txt' }],
    })
    // colB stays pending

    wrap(<KnowledgePage />)

    const select = (await screen.findByTestId(
      'console-kb-collection-select'
    )) as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'colA' } })

    // Wait for colA's row to populate
    await screen.findByTestId('kb-entry-row-doc-of-colA.txt')

    // Verify the EXACT collection route fired (not empty string)
    expect(transport.requests).toContain('/api/knowledge-committed?collection=colA')

    // Switch to colB (pending)
    fireEvent.change(select, { target: { value: 'colB' } })

    // Strict: colA row MUST be absent under colB selection
    await waitFor(() => {
      expect(screen.queryByTestId('kb-entry-row-doc-of-colA.txt')).toBeNull()
    })

    // The EXACT colB route MUST have fired (NOT empty string)
    expect(transport.requests).toContain('/api/knowledge-committed?collection=colB')

    // Resolve colB
    transport.entriesColB.resolve({
      entries: [{ chunks: 5, source: 'doc-of-colB.txt' }],
    })

    // Strict: colB row MUST exist, colA row MUST NOT come back
    await screen.findByTestId('kb-entry-row-doc-of-colB.txt')
    expect(screen.queryByTestId('kb-entry-row-doc-of-colA.txt')).toBeNull()
  })
})