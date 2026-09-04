/**
 * Knowledge page — permission matrix test (W1-B2 §P25).
 *
 * Verifies that actions are NOT rendered for users lacking the
 * required permission. Uses REAL non-null whoami (NOT null, which
 * would be permissive per the shared test-compat seam).
 *
 * Page-level gating is implemented by the FormAction / ConfirmAction
 * components (which call hasPermission) — they return null when
 * permission is denied. This test confirms that gating still works
 * end-to-end after the controller / view-model / view split.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { KnowledgePage } from './page-knowledge'
import { $whoami } from './session'
import { $transport, BaseHermesTransport } from './transport'

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

const COLLECTIONS = { collections: ['colA'] }

const ENTRIES = { entries: [{ chunks: 3, source: 'doc-1.txt' }] }

const GAPS = {
  gaps: [
    {
      gap_id: 'g1',
      hits: 5,
      query: 'refund status',
      signal: 'human',
      status: 'new',
      ts_last: 1700000000,
    },
  ],
}

class T extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    const route = path.split('?')[0]

    const byFull = ({
      '/api/knowledge-uploads': STAGED_UPLOADS,
      '/api/knowledge-committed?collection=colA': ENTRIES,
    } as Record<string, unknown>)[path]

    if (byFull) {
      return byFull as T
    }

    return (({
      '/api/knowledge-uploads': STAGED_UPLOADS,
      '/api/knowledge-committed': COLLECTIONS,
      '/api/kb-gaps': GAPS,
    } as Record<string, unknown>)[route] as T) as T
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

describe('Knowledge permission matrix (W1-B2 §P25)', () => {
  it('with full permissions: all actions present', async () => {
    $whoami.set({
      id: 'admin',
      effective_permissions: ['kb.author', 'kb.upload', 'kb.commit', 'kb.delete'],
      product_capabilities: { knowledge_rag: 'DEV' },
    } as never)
    $transport.set(new T())
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-preview-u1')).toBeTruthy())
    expect(screen.getByTestId('kb-publish-u1')).toBeTruthy()
    expect(screen.getByTestId('kb-rollback-u1')).toBeTruthy()
    // upload panel present
    expect(screen.getByTestId('console-kb-upload-input')).toBeTruthy()
    // gap author/reject present
    expect(screen.getByTestId('kb-author-g1')).toBeTruthy()
    expect(screen.getByTestId('kb-reject-g1')).toBeTruthy()
  })

  it('without kb.author: Author/Reject absent', async () => {
    $whoami.set({
      id: 'reader',
      effective_permissions: ['kb.upload', 'kb.commit', 'kb.delete'],
      product_capabilities: { knowledge_rag: 'DEV' },
    } as never)
    $transport.set(new T())
    wrap(<KnowledgePage />)

    // Wait for the uploads section to render (uses kb.upload, not
    // kb.author).
    await waitFor(() => expect(screen.getByTestId('kb-publish-u1')).toBeTruthy())
    expect(screen.queryByTestId('kb-author-g1')).toBeNull()
    expect(screen.queryByTestId('kb-reject-g1')).toBeNull()
  })

  it('without kb.upload: Upload panel + Rollback absent', async () => {
    $whoami.set({
      id: 'reader',
      effective_permissions: ['kb.author', 'kb.commit', 'kb.delete'],
      product_capabilities: { knowledge_rag: 'DEV' },
    } as never)
    $transport.set(new T())
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-publish-u1')).toBeTruthy())
    expect(screen.queryByTestId('console-kb-upload-input')).toBeNull()
    expect(screen.queryByTestId('kb-rollback-u1')).toBeNull()
  })

  it('without kb.commit: Publish absent', async () => {
    $whoami.set({
      id: 'reader',
      effective_permissions: ['kb.author', 'kb.upload', 'kb.delete'],
      product_capabilities: { knowledge_rag: 'DEV' },
    } as never)
    $transport.set(new T())
    wrap(<KnowledgePage />)

    // Wait for the upload section to render (uses kb.upload).
    await waitFor(() => expect(screen.getByTestId('kb-rollback-u1')).toBeTruthy())
    expect(screen.queryByTestId('kb-publish-u1')).toBeNull()
  })

  it('without kb.delete: Withdraw absent', async () => {
    $whoami.set({
      id: 'reader',
      effective_permissions: ['kb.author', 'kb.upload', 'kb.commit'],
      product_capabilities: { knowledge_rag: 'DEV' },
    } as never)
    $transport.set(new T())
    wrap(<KnowledgePage />)

    // Select colA first to mount the entries list
    const select = (await screen.findByTestId(
      'console-kb-collection-select'
    )) as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'colA' } })

    await waitFor(() =>
      expect(screen.getByTestId('kb-entry-row-doc-1.txt')).toBeTruthy()
    )
    // Withdraw affordance must not exist
    expect(screen.queryByTestId('kb-withdraw-doc-1.txt')).toBeNull()
  })
})