import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowsPage } from './workflows-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('WorkflowsPage', () => {
  it('reads the authorized follow-up and history projections without writing workflow state', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/followup-list')
        return {
          followups: [
            { business_subject: '9 月回款', followup_id: 'fu-1', status: 'open', updated_ts: '2026-09-01T10:00:00Z' }
          ]
        }
      if (path === '/api/followup-history?followup_id=fu-1')
        return { history: [{ event_type: 'created', to_status: 'created' }] }
      throw new Error(`unexpected path: ${path}`)
    })
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<WorkflowsPage runtime={runtime} />)

    expect(await screen.findByText('9 月回款')).toBeTruthy()
    expect((await screen.findAllByText('created')).length).toBeGreaterThan(0)
    expect(get).toHaveBeenCalledWith('/api/followup-list')
    expect(get).toHaveBeenCalledWith('/api/followup-history?followup_id=fu-1')
  })
})
