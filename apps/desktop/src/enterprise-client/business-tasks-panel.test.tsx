import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BusinessTasksPanel } from './business-tasks-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('BusinessTasksPanel', () => {
  it('reads task and assignment projections without sending lifecycle commands', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/biz-tasks') {
        return {
          available: true,
          tasks: [{ carrier: 'workflow', state: 'escalated', task_id: 'task-1', title: '月末对账' }]
        }
      }

      if (path === '/api/biz-task-assignments?task_id=task-1') {
        return { assignments: [{ assignee_principal_id: 'operator-1', status: 'claimed' }] }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get']
    }

    render(<BusinessTasksPanel runtime={runtime} />)

    expect(await screen.findByText('月末对账')).toBeTruthy()
    expect(await screen.findByText('operator-1')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/biz-tasks')
    expect(get).toHaveBeenCalledWith('/api/biz-task-assignments?task_id=task-1')
  })
})
