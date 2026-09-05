import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeGapsPanel } from './knowledge-gaps-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('KnowledgeGapsPanel', () => {
  it('reads authorized gaps and authors a selected gap only after explicit submission', async () => {
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

    const post = vi.fn(async () => ({ gap: { gap_id: 'gap-1', status: 'authored' } }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<KnowledgeGapsPanel runtime={runtime} />)

    expect(await screen.findByText('如何开具发票？')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('补充知识'), { target: { value: '在订单页申请电子发票。' } })
    fireEvent.change(screen.getByLabelText('目标知识集合'), { target: { value: 'enterprise-policy' } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充知识' }))

    await screen.findByRole('button', { name: '提交补充知识' })
    expect(post).toHaveBeenCalledWith('/api/kb-gap-author', {
      collection: 'enterprise-policy',
      gap_id: 'gap-1',
      text: '在订单页申请电子发票。'
    })
  })
})
