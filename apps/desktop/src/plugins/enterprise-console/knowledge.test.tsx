import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { KnowledgePage } from './page-knowledge'
import { $whoami } from './session'
import { $transport, BaseHermesTransport, type TransportRequest, type UploadFile } from './transport'
import type { Whoami } from './types'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

class KnowledgeTransport extends BaseHermesTransport {
  readonly requests: Array<{ opts?: TransportRequest; path: string }> = []
  readonly uploads: Array<{ file: UploadFile; path: string }> = []
  readonly #responses: Record<string, unknown>

  constructor(responses: Record<string, unknown> = {}) {
    super()
    this.#responses = responses
  }

  #resolve(path: string): unknown {
    return this.#responses[path] ?? this.#responses[path.split('?')[0]] ?? {}
  }

  request<T>(path: string, opts?: TransportRequest): Promise<T> {
    this.requests.push({ opts, path })

    return Promise.resolve(this.#resolve(path) as T)
  }

  upload<T>(path: string, file: UploadFile): Promise<T> {
    this.uploads.push({ file, path })

    return Promise.resolve(this.#resolve(path) as T)
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const WHO: Whoami = {
  capability_revision: 0,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  effective_permissions: ['*'],
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: { knowledge_rag: { enabled: false, status: 'DEV' } },
  role: 'tenant_admin',
  tenant_id: 't1'
}

const STAGED_UPLOADS = {
  uploads: [
    {
      chunks_committed: 0,
      chunks_total: 3,
      collection: null,
      error_detail: null,
      filename: 'doc.txt',
      size_bytes: 10,
      status: 'staged',
      updated_ts: 1,
      upload_id: 'u1'
    }
  ]
}

function baseTransport(extra: Record<string, unknown> = {}) {
  return new KnowledgeTransport({
    '/api/kb-gaps': { gaps: [] },
    '/api/knowledge-committed': { collections: ['colA'], count: 1 },
    '/api/knowledge-uploads': STAGED_UPLOADS,
    ...extra
  })
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

describe('Knowledge — full control', () => {
  it('uploads a file via the multipart transport and refetches', async () => {
    const transport = baseTransport({ '/api/knowledge-upload': { upload_id: 'u2' } })
    $whoami.set(WHO)
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('console-kb-upload-input')).toBeTruthy())
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('console-kb-upload-input'), { target: { files: [file] } })

    await waitFor(() => expect(transport.uploads.length).toBe(1))
    expect(transport.uploads[0].path).toBe('/api/knowledge-upload')
    expect(transport.uploads[0].file.filename).toBe('doc.txt')
  })

  it('publishes (commits) a staged upload to a collection', async () => {
    const transport = baseTransport({ '/api/knowledge-commit': { status: 'committed', upload_id: 'u1' } })
    $whoami.set(WHO)
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-publish-u1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('kb-publish-u1'))
    fireEvent.change(screen.getByTestId('kb-publish-collection-u1'), { target: { value: 'colA' } })
    fireEvent.click(screen.getByTestId('kb-publish-u1-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/knowledge-commit')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/knowledge-commit')
    expect(req?.opts?.body).toEqual({ collection: 'colA', upload_id: 'u1' })
  })

  it('rolls back a staged upload (destructive confirm)', async () => {
    const transport = baseTransport({ '/api/knowledge-rollback': { status: 'rolled_back', upload_id: 'u1' } })
    $whoami.set(WHO)
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-rollback-u1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('kb-rollback-u1'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/knowledge-rollback')).toBe(true))
  })

  it('previews chunks + stats for a staged upload', async () => {
    const transport = baseTransport({
      '/api/knowledge-preview?upload_id=u1': {
        chunks: [{ char_count: 5, index: 0, pii_forbidden: 0, pii_warning: 0, text: 'hello world' }],
        stats: { est_cost_usd: 0, pii_forbidden_count: 0, pii_warning_count: 1, total_tokens: 42 },
        status: 'staged',
        total: 3
      }
    })

    $whoami.set(WHO)
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('kb-preview-u1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('kb-preview-u1'))

    await waitFor(() => expect(screen.getByTestId('kb-preview-body-u1')).toBeTruthy())
    await waitFor(() => {
      expect(
        screen.getByTestId('kb-preview-body-u1').textContent
      ).toContain('42 tokens')
    })
    expect(screen.getByText('hello world')).toBeTruthy()
  })

  it('withdraws a committed source with a reason (destructive)', async () => {
    const transport = baseTransport({
      '/api/knowledge-committed?collection=colA': { entries: [{ chunks: 2, source: 's1' }] },
      '/api/knowledge-delete': { collection: 'colA', rowcount: 2, source: 's1' }
    })

    $whoami.set(WHO)
    $transport.set(transport)
    wrap(<KnowledgePage />)

    await waitFor(() => expect(screen.getByTestId('console-kb-collection-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('console-kb-collection-select'), { target: { value: 'colA' } })

    await waitFor(() => expect(screen.getByTestId('kb-withdraw-s1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('kb-withdraw-s1'))
    fireEvent.change(screen.getByTestId('kb-withdraw-reason-s1'), { target: { value: 'outdated' } })
    fireEvent.click(screen.getByTestId('kb-withdraw-s1-submit'))

    await waitFor(() => expect(transport.requests.some(r => r.path === '/api/knowledge-delete')).toBe(true))
    const req = transport.requests.find(r => r.path === '/api/knowledge-delete')
    expect(req?.opts?.body).toEqual({ collection: 'colA', reason: 'outdated', source: 's1' })
  })
})
