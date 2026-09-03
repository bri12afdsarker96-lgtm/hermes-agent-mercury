import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { WorkflowsPage } from './workflows-page'

describe('WorkflowsPage', () => {
  it('reads the authorized follow-up and history projections without writing workflow state', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/followup-list') {
        return {
          followups: [
            { business_subject: '9 月回款', followup_id: 'fu-1', status: 'open', updated_ts: '2026-09-01T10:00:00Z' }
          ]
        }
      }

      if (path === '/api/followup-history?followup_id=fu-1') {
        return { history: [{ event_type: 'created', to_status: 'created' }] }
      }

      if (path === '/api/followup-detail?followup_id=fu-1') {
        return { followup: { followup_id: 'fu-1', owner_principal_id: 'operator-1' } }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<WorkflowsPage role="operator" runtime={runtime} />)

    expect(await screen.findByRole('heading', { name: '我的任务' })).toBeTruthy()
    expect(await screen.findByText('9 月回款')).toBeTruthy()
    expect((await screen.findAllByText('created')).length).toBeGreaterThan(0)
    expect(get).toHaveBeenCalledWith('/api/followup-list')
    expect(get).toHaveBeenCalledWith('/api/followup-detail?followup_id=fu-1')
    expect(get).toHaveBeenCalledWith('/api/followup-history?followup_id=fu-1')
  })
})
