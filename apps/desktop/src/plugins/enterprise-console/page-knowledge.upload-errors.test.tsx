/**
 * Knowledge page — upload error mapping test
 * (W1-B2-REMEDIATION-01 §P6 + §P18.E).
 *
 * Verifies that the Upload path reuses the shared `actionError`
 * mapper from `./actions` (not a local reimplementation).
 *
 * The exact mapping is unit-tested in actions.test.ts; here we only
 * prove the Upload catch block calls `actionError(err)`.
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
  uploads: [],
}

class UploadErrorTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    throw new HermesApiError(401, 'unauthorized', 'auth required')
  }
}

class UploadNetworkErrorTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    throw new HermesApiError(0, 'network', 'cannot reach the server')
  }
}

class UploadNotImplementedTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    throw new HermesApiError(501, 'not_implemented', 'upload_module_unavailable')
  }
}

class UploadForbiddenTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    throw new HermesApiError(403, 'forbidden', 'not permitted')
  }
}

class UploadConflictTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    // The actionError function checks status === 409 (regardless of
    // code). So any HermesErrorCode with status 409 triggers the
    // conflict message.
    throw new HermesApiError(409, 'error', 'some other error message')
  }
}

class UploadUnknownTransport extends BaseHermesTransport {
  async request<T>(path: string): Promise<T> {
    if (path === '/api/kb-gaps?status=new') {
      return { gaps: [] } as T
    }

    if (path === '/api/knowledge-uploads') {
      return STAGED_UPLOADS as T
    }

    if (path === '/api/knowledge-committed') {
      return { collections: [] } as T
    }

    throw new Error(`unexpected route: ${path}`)
  }
  async upload<T>(): Promise<T> {
    throw new Error('plain error')
  }
}

afterEach(() => {
  cleanup()
  $transport.set(null)
  $whoami.set(null)
})

describe('Knowledge upload error mapping (W1-B2-REMEDIATION-01 §P6 + §P18.E)', () => {
  it('unauthorized → actionError("authentication required")', async () => {
    $transport.set(new UploadErrorTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'authentication required'
      )
    )
  })

  it('forbidden → actionError("not permitted")', async () => {
    $transport.set(new UploadForbiddenTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'not permitted'
      )
    )
  })

  it('not_implemented → actionError("server module unavailable")', async () => {
    $transport.set(new UploadNotImplementedTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'server module unavailable'
      )
    )
  })

  it('network → actionError("cannot reach the server")', async () => {
    $transport.set(new UploadNetworkErrorTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'cannot reach the server'
      )
    )
  })

  it('409 → actionError("conflict — the server rejected this state change")', async () => {
    $transport.set(new UploadConflictTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'conflict — the server rejected this state change'
      )
    )
  })

  it('unknown plain Error → actionError("action failed")', async () => {
    $transport.set(new UploadUnknownTransport())
    $whoami.set(WHO)
    wrap(<KnowledgePage />)

    const input = await screen.findByTestId('console-kb-upload-input')

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.txt', {
      type: 'text/plain',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId('console-kb-upload-error').textContent).toBe(
        'action failed'
      )
    )
  })
})