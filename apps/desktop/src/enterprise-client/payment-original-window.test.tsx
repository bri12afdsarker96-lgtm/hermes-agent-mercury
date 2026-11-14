import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'

import type { DoudianReply, DoudianTask } from '../../electron/doudian-types'

import { OriginalPaymentWindow } from './payment-original-window'
import type { EnterpriseClientRuntime } from './runtime'

function fixture(paymentUi = 1) {
  let task: DoudianTask = {
    taskId: null,
    kind: 'review',
    state: 'idle',
    saved: 0,
    summary: '',
    error: '',
    messages: []
  }

  const doudian = vi.fn(async (request: { action: string }): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {
      return {
        ok: true,
        capabilities: { protocol: 1, version: '1.0.54', authorized: false, paymentUi, chrome: true, spreadsheet: true }
      }
    }

    if (request.action === 'openPayment') {
      task = { ...task, kind: 'payment-window', taskId: 'a'.repeat(32), state: 'running' }
    }

    if (request.action === 'stop') {
      task = { ...task, state: 'stopping' }
    }

    return { ok: true, task }
  })

  return { runtime: { doudian } as unknown as EnterpriseClientRuntime, doudian,
    setTask: (next: DoudianTask) => { task = next } }
}

const view = (runtime: EnterpriseClientRuntime | null) =>
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <OriginalPaymentWindow runtime={runtime} />
    </I18nProvider>
  )

describe('original licensed payment window', () => {
  it.each([
    ['paused_balance', '因余额原因，打款已暂停。'],
    ['paused_review', '打款已暂停，需人工核验。'],
    ['stopped', '打款任务已停止。'],
    ['completed', '打款任务已完成。']
  ] as const)('shows terminal state %s from polling', async (state, label) => {
    const { runtime, doudian, setTask } = fixture()
    setTask({ kind: 'payment-window', taskId: 'a'.repeat(32), state, saved: 0, summary: '', error: '', messages: [] })
    view(runtime)
    await screen.findByText(label)
    expect(screen.queryByRole('button', { name: '停止并关闭打款窗口' })).toBeNull()
    expect(doudian.mock.calls.some(([request]) => ['openPayment', 'stop', 'startPayment'].includes(request.action))).toBe(false)
  })
  it('does not expose the native module without an enterprise session', () => {
    view(null)
    expect(screen.queryByRole('button', { name: '打开早鸟打款窗口' })).toBeNull()
    expect(screen.getByText('企业账号无访问权限')).toBeTruthy()
  })
  it('opens the original activation UI on explicit click, with no workbook/amount or CLI command', async () => {
    const { runtime, doudian } = fixture()
    view(runtime)
    await screen.findByText('原打款模块已就绪')
    expect(doudian.mock.calls.some(([request]) => request.action === 'openPayment')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '打开早鸟打款窗口' }))
    await screen.findByText('原版窗口已打开，打款操作在该窗口中完成。')
    expect(doudian.mock.calls.find(([request]) => request.action === 'openPayment')?.[0]).toEqual({
      action: 'openPayment'
    })
    fireEvent.click(screen.getByRole('button', { name: '停止并关闭打款窗口' }))
    await screen.findByText('正在安全停止并关闭窗口')
    expect(doudian.mock.calls.at(-1)?.[0]).toEqual({ action: 'stop', taskId: 'a'.repeat(32) })
  })
  it('does not pretend a review-only module supports payments', async () => {
    view(fixture(0).runtime)
    await screen.findByText('原打款模块未接入或版本不支持')
    expect((screen.getByRole('button', { name: '打开早鸟打款窗口' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not automatically retry an uncertain open result', async () => {
    const { runtime, doudian } = fixture()
    view(runtime)
    await screen.findByText('原打款模块已就绪')
    doudian.mockResolvedValueOnce({ ok: false, error: 'DOUDIAN_RESULT_UNKNOWN' })
    fireEvent.click(screen.getByRole('button', { name: '打开早鸟打款窗口' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(doudian.mock.calls.filter(([request]) => request.action === 'openPayment')).toHaveLength(1)
  })
})
