import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'

import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'

import { PaymentPage } from './payment-page'
import type { EnterpriseClientRuntime } from './runtime'

const prepared: DoudianTask = {
  kind: 'payment',
  taskId: 'c'.repeat(32),
  state: 'awaiting_confirmation',
  saved: 0,
  summary: '模拟准备结果',
  error: '',
  messages: []
}

const capability = (authorized = true, authorizationMode?: string): DoudianReply => ({
  ok: true,
  capabilities: { protocol: 1, version: '1.0.54', authorized, chrome: true, spreadsheet: true, authorizationMode }
})

function setup(initialCapability = capability(true, 'enterprise-session-v1'), initialTask?: DoudianTask) {
  let cap = initialCapability
  let task = initialTask

  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {return cap}

    if (request.action === 'chooseWorkbook') {return { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }}

    if (request.action === 'preparePayment') {task = prepared}

    if (request.action === 'startPayment') {task = { ...prepared, state: 'running', summary: '模拟运行' }}

    if (request.action === 'stop' && task) {task = { ...task, state: 'stopped' }}

    return { ok: true, task }
  })

  const runtime = { doudian: send } as unknown as EnterpriseClientRuntime

  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PaymentPage runtime={runtime} />
    </I18nProvider>
  )

  return {
    send,
    view,
    setCapability: (next: DoudianReply) => {
      cap = next
    },
    setTask: (next: DoudianTask) => {
      task = next
    }
  }
}

async function chooseAndFill(amount = '3.25', startRow = '1', maxRows = '0', mode = 'standard') {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
  await screen.findByText('副本.xlsx')
  fireEvent.change(screen.getByLabelText('模式'), { target: { value: mode } })
  fireEvent.change(screen.getByLabelText('金额'), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText('起始行'), { target: { value: startRow } })
  fireEvent.change(screen.getByLabelText('最多行（0 表示不限）'), { target: { value: maxRows } })
}

describe('payment page offline', () => {
  it('reports an unavailable local security environment and blocks payment', async () => {
    const { send } = setup({ ok: false, error: 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' })
    await screen.findByText('本地安全环境尚未就绪，暂时无法运行。')
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect(send.mock.calls.some(([request]) => ['preparePayment', 'startPayment'].includes(request.action))).toBe(false)
  })
  it('closes the payment gate if isolation becomes unavailable during preparation', async () => {
    const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') return capability(true, 'enterprise-session-v1')
      if (request.action === 'chooseWorkbook') return { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }
      if (request.action === 'preparePayment') return { ok: false, error: 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' }
      return { ok: true }
    })
    render(<I18nProvider configClient={null} initialLocale="zh"><PaymentPage runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    await chooseAndFill()
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('status').textContent).toBe('本地安全环境尚未就绪，暂时无法运行。')
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(true)
    expect(send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
  })
  it('offers payment without an activation-code form or activation request', async () => {
    const { send } = setup()
    await chooseAndFill()
    expect(screen.queryByText(/激活码/)).toBeNull()
    expect(send.mock.calls.some(([request]) => ['activateLicense', 'resumeLicense', 'licenseStatus'].includes(request.action))).toBe(false)
  })
  it.each([
    ['standard', '0.01', '1', '0'],
    ['new-order', '+100,000.00', '2147483647', '2147483647']
  ])(
    'prepares exact %s parameters and starts only after explicit confirmation',
    async (mode, amount, startRow, maxRows) => {
      const { send } = setup()
      await chooseAndFill(amount, startRow, maxRows, mode)
      expect(
        send.mock.calls.some(([request]) => request.action === 'preparePayment' || request.action === 'startPayment')
      ).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
      await screen.findByText('模拟准备结果')
      expect(send).toHaveBeenCalledWith({
        action: 'preparePayment',
        workbookId: 'b'.repeat(32),
        amount,
        startRow,
        maxRows,
        mode
      })
      expect(send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
      fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
      await screen.findByText('模拟运行')
      expect(send.mock.calls.filter(([request]) => request.action === 'startPayment')).toEqual([
        [{ action: 'startPayment', taskId: prepared.taskId }]
      ])
      expect(send.mock.calls.some(([request]) => request.action === 'openPayment')).toBe(false)
    }
  )

  it.each([
    ['old host', capability()],
    ['unknown marker', capability(true, 'enterprise-session-v2')],
    ['false authorization', capability(false, 'enterprise-session-v1')],
    ['failed capability request', { ok: false, error: 'DOUDIAN_FORBIDDEN' }]
  ])('blocks preparation and start with %s', async (_label, reply) => {
    const { send } = setup(reply, prepared)
    await waitFor(() => expect(screen.queryByText('正在检查执行模块')).toBeNull())
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    expect(
      send.mock.calls.some(([request]) => ['preparePayment', 'startPayment', 'openPayment'].includes(request.action))
    ).toBe(false)
  })

  it('rechecks authorization immediately before prepare and start', async () => {
    const fixture = setup()
    await chooseAndFill()
    fixture.setCapability(capability(false, 'enterprise-session-v1'))
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByRole('alert')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
  })

  it('blocks confirmation if the marker is lost after preparing', async () => {
    const fixture = setup()
    await chooseAndFill()
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText('模拟准备结果')
    fixture.setCapability(capability())
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    await screen.findByRole('alert')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
  })

  it('does not start when the task changed before confirmation', async () => {
    const fixture = setup()
    await chooseAndFill()
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText('模拟准备结果')
    fixture.setTask({ ...prepared, taskId: 'd'.repeat(32) })
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    await screen.findByRole('alert')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
  })

  it('stops an existing payment task even without the activation marker', async () => {
    const running: DoudianTask = { ...prepared, state: 'running', summary: '模拟运行' }
    const { send } = setup(capability(), running)
    await screen.findByText('模拟运行')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await screen.findByText('任务已停止。')
    expect(send).toHaveBeenCalledWith({ action: 'stop', taskId: running.taskId })
  })

  it('never starts a task of another kind or state', async () => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, kind: 'review' })
    await waitFor(() => expect(send.mock.calls.some(([request]) => request.action === 'status')).toBe(true))
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(true)
    expect(send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
  })
  it.each([
    ['paused_balance', '因余额原因，打款已暂停。'],
    ['paused_review', '打款已暂停，需人工核验。'],
    ['stopped', '任务已停止。'],
    ['completed', '任务已完成。']
  ] as const)('shows terminal state %s without starting or stopping', async (state, label) => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state })
    await screen.findByText(label)
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(send.mock.calls.some(([request]) => ['startPayment', 'stop'].includes(request.action))).toBe(false)
  })
})
