import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OperationsOverviewPanel } from './operations-overview-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('OperationsOverviewPanel', () => {
  it('shows only server-supplied management aggregates and keeps customer replies separate', async () => {
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        groups: [{ group_id: 'team-one', member_count: 1, name: '主管一组', owner_name: '主管一' }],
        knowledge: { pending_review: 3, published: 7 }, knowledge_available: true,
        reminders: [{ group_name: '主管一组', owner_name: '坐席一', reminder_id: 'r-one', scheduled_for: 2_000_000_000, status_label: '待提醒', title: '回访客户' }],
        scope: { operator_count: 1, read_only: true },
        staff: [{ group_name: '主管一组', login_name: 'seat.one', name: '坐席一', principal_id: 'seat-one', today_answers: 5, today_customer_replies: 2, today_questions: 3, total_answers: 20, total_customer_replies: 6, week_answers: 10 }],
        summary: { today_answers: 5, today_customer_replies: 2, today_questions: 3, total_answers: 20, total_customer_replies: 6, week_answers: 10 }
      })) as unknown as EnterpriseClientRuntime['get']
    }
    render(<OperationsOverviewPanel runtime={runtime} role="supervisor" />)
    expect((await screen.findAllByText('主管一组')).length).toBeGreaterThan(0)
    expect(screen.getByText('今日企业/知识提问')).toBeTruthy()
    expect(screen.getByText('今日客户回复生成')).toBeTruthy()
    expect(screen.getByText('坐席活跃度')).toBeTruthy()
    expect(runtime.get).toHaveBeenCalledWith('/api/operations-overview')
  })

  it('does not request management data for a seat account', () => {
    const runtime = { disconnect: vi.fn(), get: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<OperationsOverviewPanel runtime={runtime} role="operator" />)
    expect(screen.queryByTestId('operations-overview')).toBeNull()
    expect(runtime.get).not.toHaveBeenCalled()
  })
})
