import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgePage } from './knowledge-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('KnowledgePage', () => {
  it('reads committed collections and selected entries through the product runtime adapter', async () => {
    const get = vi.fn(async <T,>(path: string) => {
      if (path === '/api/knowledge-committed') {
        return { collections: ['policies'] } as T
      }

      if (path === '/api/knowledge-committed?collection=policies') {
        return { entries: [{ chunks: 12, source: 'policy-handbook.pdf' }] } as T
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = { disconnect: vi.fn(async () => undefined), get }

    render(<KnowledgePage runtime={runtime} />)

    expect((await screen.findByRole('button', { name: 'policies' })).getAttribute('aria-current')).toBe('true')
    expect((await screen.findByText('policy-handbook.pdf')).textContent).toBe('policy-handbook.pdf')
    expect(screen.getByText('12').textContent).toBe('12')
    expect(get).toHaveBeenCalledWith('/api/knowledge-committed')
    expect(get).toHaveBeenCalledWith('/api/knowledge-committed?collection=policies')
  })
})
