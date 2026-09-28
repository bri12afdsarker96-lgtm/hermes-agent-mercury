import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeConflictsPanel } from './knowledge-conflicts-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('knowledge conflict review', () => {
  it('shows the existing text and resolves only the selected conflict through the authenticated runtime', async () => {
    const get = vi.fn(async () => ({
      conflicts: [
        {
          conflict_id: 'conflict-a',
          status: 'confirmed',
          counterpart: { text: '现有有效资料', topic: '员工手册', created_by_principal_id: 'author' }
        }
      ],
      permissions: ['kb.candidate.resolve_conflict'],
      principal_id: 'publisher'
    }))

    const post = vi.fn(async () => ({}))

    const runtime: EnterpriseClientRuntime = {
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>,
      disconnect: vi.fn(async () => undefined)
    }

    const onChanged = vi.fn(async () => undefined)
    render(
      <KnowledgeConflictsPanel candidateId="candidate-a" creatorId="author" onChanged={onChanged} runtime={runtime} />
    )
    await screen.findByText('现有有效资料')
    fireEvent.click(screen.getByRole('button', { name: '保留现有资料，结束重复候选' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith(
      '/api/knowledge-resolve-conflict',
      expect.objectContaining({ conflict_id: 'conflict-a', verdict: 'keep_existing' })
    )
  })
})
