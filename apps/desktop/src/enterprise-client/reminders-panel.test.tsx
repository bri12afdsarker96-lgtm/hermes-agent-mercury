import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RemindersPanel } from './reminders-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('RemindersPanel', () => {
  it('reads server reminders and only creates one after an explicit form submission', async () => {
    const get = vi.fn(async () => ({
      available: true,
      reminders: [
        {
          reminder_id: 'rem-1',
          scheduled_for: 1_800_000_000,
          state: 'active',
          subject_id: 'task-1',
          subject_type: 'biz_task',
          timezone: 'Asia/Shanghai',
          title: '回款跟进'
        }
      ]
    }))

    const post = vi.fn(async () => ({ reminder_id: 'rem-2', state: 'active' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<RemindersPanel runtime={runtime} />)

    expect(await screen.findByText('回款跟进')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('关联事项'), { target: { value: 'task-2' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '2027-01-01T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '创建提醒' }))

    await screen.findByRole('button', { name: '创建提醒' })
    expect(post).toHaveBeenCalledWith(
      '/api/reminder-create',
      expect.objectContaining({ subject_id: 'task-2', subject_type: 'biz_task', timezone: 'Asia/Shanghai' })
    )
  })
})
