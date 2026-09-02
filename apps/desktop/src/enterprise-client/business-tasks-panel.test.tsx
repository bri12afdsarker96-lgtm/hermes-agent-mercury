import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BusinessTasksPanel } from './business-tasks-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('BusinessTasksPanel', () => {
  it('uses the server-owned claim resolution endpoint only after the claimant explicitly acts', async () => {
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

    const post = vi.fn(async () => ({ state: 'closed', task_id: 'task-1' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<BusinessTasksPanel principalId="operator-1" runtime={runtime} />)

    expect(await screen.findByText('月末对账')).toBeTruthy()
    expect(await screen.findByText('operator-1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('处理说明'), { target: { value: '已完成核实' } })
    fireEvent.click(screen.getByRole('button', { name: '完成任务' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/biz-task-resolve', {
        action: 'close',
        note: '已完成核实',
        task_id: 'task-1'
      })
    )
    expect(get).toHaveBeenCalledWith('/api/biz-tasks')
    expect(get).toHaveBeenCalledWith('/api/biz-task-assignments?task_id=task-1')
  })
})
