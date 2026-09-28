import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeGapsPanel } from './knowledge-gaps-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('KnowledgeGapsPanel', () => {
  it('keeps existing gaps readable while the learning submission is frozen', async () => {
    const get = vi.fn(async () => ({
      collections: ['enterprise-policy'],
      gaps: [
        {
          gap_id: 'gap-1',
          query: '如何开具发票？',
          signal: 'no_hit'
        }
      ]
    }))

    const post = vi.fn(async () => ({ candidate_id: 'candidate-1', status: 'needs_review', retrievable: false }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<KnowledgeGapsPanel runtime={runtime} />)

    expect(await screen.findByText('如何开具发票？')).toBeTruthy()
    expect(screen.queryByLabelText('补充知识')).toBeNull()
    expect(screen.queryByRole('button', { name: '提交补充知识审核' })).toBeNull()
    expect(screen.getByText(/请通过知识库上传补充资料/)).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
  })
})
