import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'

import type { DoudianReply, DoudianRequest } from '../../electron/doudian-types'

import { PaymentPage } from './payment-page'
import type { EnterpriseClientRuntime } from './runtime'

function setup(status?: DoudianReply['task']) {
  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {
      return {
        ok: true,
        capabilities: { protocol: 1, version: '1.0.54', authorized: true, chrome: true, spreadsheet: true }
      }
    }

    if (request.action === 'chooseWorkbook') {
      return { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }
    }

    if (request.action === 'stop') {
      return { ok: true, task: { ...status!, state: 'stopped' } }
    }

    return { ok: true, task: status }
  })

  const runtime = { doudian: send } as unknown as EnterpriseClientRuntime
  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PaymentPage runtime={runtime} />
    </I18nProvider>
  )

  return { send, view }
}

describe('payment page offline', () => {
  it('accepts both modes and existing input forms but blocks preparation and payment without activation verification', async () => {
    const { send } = setup()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    fireEvent.change(screen.getByLabelText('模式'), { target: { value: 'new-order' } })
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '+100,000.00' } })
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '2147483647' } })
    fireEvent.change(screen.getByLabelText('最多行（0 表示不限）'), { target: { value: '0' } })
    expect((screen.getByLabelText('模式') as HTMLSelectElement).value).toBe('new-order')
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/原激活授权尚无法核验/)).toBeTruthy()
    expect(
      send.mock.calls.every(([request]) => ['capabilities', 'status', 'chooseWorkbook'].includes(request.action))
    ).toBe(true)
  })

  it('displays and stops only an existing payment task', async () => {
    const task = {
      kind: 'payment' as const,
      taskId: 'c'.repeat(32),
      state: 'running' as const,
      saved: 2,
      summary: '模拟进度',
      error: '',
      messages: []
    }
    const { send } = setup(task)
    await screen.findByText('模拟进度')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await screen.findByText('stopped')
    expect(send).toHaveBeenCalledWith({ action: 'stop', taskId: task.taskId })
    expect(
      send.mock.calls.some(([request]) => request.action === 'startPayment' || request.action === 'openPayment')
    ).toBe(false)
  })

  it('does not treat enterprise authorization as proof of original activation', async () => {
    const task = {
      kind: 'payment' as const,
      taskId: 'c'.repeat(32),
      state: 'awaiting_confirmation' as const,
      saved: 0,
      summary: '模拟准备',
      error: '',
      messages: []
    }
    const { send } = setup(task)
    await screen.findByText('模拟准备')
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    expect(send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
  })
})
