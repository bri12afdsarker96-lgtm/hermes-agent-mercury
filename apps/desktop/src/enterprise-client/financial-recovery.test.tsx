import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'

import {
  $enterprisePackageInstallFrozen,
  prepareEnterprisePackageInstall,
  releaseEnterprisePackageInstall
} from './enterprise-install-readiness'
import { ReceivableLedger } from './receivable-ledger'
import {
  clearPendingOperation,
  readPendingOperation,
  readPendingReceivable,
  savePendingOperation
} from './receivable-pending'
import type { ReminderCenterTask } from './reminder-state'
import type { EnterpriseClientRuntime } from './runtime'
import { ReceivableWriteoff } from './workspace/receivable-writeoff'
import { WebTaskDetails } from './workspace/task-details'

const balance = {
  available: true,
  can_record_receipt: true,
  can_correct_receipt: false,
  can_add_note: false,
  transfer_targets: [],
  received_amount: '0.00',
  remaining_amount: '100.00',
  receipts: [],
  history: [],
  can_write_off: true,
  version: 3,
  original_amount: '100.00',
  currency: 'CNY',
  writeoffs: []
}

const task = {
  source_type: 'receivable_followup',
  source_id: 'f',
  business_subject: '测试应收款',
  status: 'open',
  task_status: 'pending',
  owner_principal_id: 'p',
  owner_name: 'P',
  overdue: false,
  allowed_actions: ['reschedule']
} as ReminderCenterTask

const receiptKey = 'hermes:receivable-pending:audit:f'
const taskKey = 'hermes:web-task-action:audit:receivable_followup:f'

const original = {
  action: 'receipt' as const,
  followup_id: 'f',
  idempotency_key: 'original-request',
  amount: '20.00',
  received_at: '2026-01-01T01:00:00Z'
}

const api = (
  get: ReturnType<typeof vi.fn> = vi.fn(async () => balance),
  post: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true }))
) => ({ get, post, disconnect: vi.fn() }) as unknown as EnterpriseClientRuntime

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  releaseEnterprisePackageInstall()
  cleanup()
  vi.restoreAllMocks()
})

it('preserves an unconfirmed receipt across loss of tab storage and retries its exact facts', async () => {
  const post = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ ok: true })
  const runtime = api(undefined, post)
  const view = render(<ReceivableLedger followupId="f" runtime={runtime} scope="audit" />)
  fireEvent.change(await screen.findByLabelText('本次收款金额'), { target: { value: '20.00' } })
  fireEvent.change(screen.getByLabelText('实际到账时间'), { target: { value: '2026-01-01T09:00' } })
  fireEvent.click(screen.getByRole('button', { name: '确认登记收款' }))
  await screen.findByRole('button', { name: '重试原提交' })
  const request = post.mock.calls[0][1]
  expect(JSON.parse(localStorage.getItem(receiptKey)!)).toEqual(request)
  view.unmount()
  sessionStorage.clear()
  render(<ReceivableLedger followupId="f" runtime={runtime} scope="audit" />)
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }))
  await screen.findByText('已保存到服务端。')
  expect(post.mock.calls[1]).toEqual(['/api/receivable-receipt-action', request])
  expect(localStorage.getItem(receiptKey)).toBeNull()
})

it('migrates a legacy pending receipt before tab storage disappears', () => {
  sessionStorage.setItem(receiptKey, JSON.stringify(original))
  expect(readPendingReceivable(receiptKey, 'f')).toEqual(original)
  sessionStorage.clear()
  expect(readPendingReceivable(receiptKey, 'f')).toEqual(original)
  clearPendingOperation(receiptKey)
  expect(readPendingOperation(receiptKey)).toBeNull()
})

it('does not overwrite another unconfirmed operation or leak it into another authority scope', () => {
  savePendingOperation(receiptKey, original)
  expect(() => savePendingOperation(receiptKey, { ...original, idempotency_key: 'new' })).toThrow()
  expect(readPendingReceivable(receiptKey, 'f')).toEqual(original)
  expect(readPendingReceivable('hermes:receivable-pending:another-tenant:f', 'f')).toBeNull()
  expect(() => readPendingReceivable(receiptKey, 'another-record')).toThrow()
})

it('retains a durable request when clearing the legacy store fails', () => {
  savePendingOperation(receiptKey, original)
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('legacy store unavailable') })
  expect(() => clearPendingOperation(receiptKey)).toThrow()
  expect(readPendingReceivable(receiptKey, 'f')).toEqual(original)
})

it('retains legacy evidence when durable migration fails', () => {
  sessionStorage.setItem(receiptKey, JSON.stringify(original))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('storage unavailable')
  })
  expect(() => readPendingOperation(receiptKey)).toThrow()
  expect(sessionStorage.getItem(receiptKey)).toBe(JSON.stringify(original))
})

it('does not post a receipt if its recovery journal cannot be persisted', async () => {
  const runtime = api()
  render(<ReceivableLedger followupId="f" runtime={runtime} scope="audit" />)
  fireEvent.change(await screen.findByLabelText('本次收款金额'), { target: { value: '20.00' } })
  fireEvent.change(screen.getByLabelText('实际到账时间'), { target: { value: '2026-01-01T09:00' } })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('storage unavailable')
  })
  fireEvent.click(screen.getByRole('button', { name: '确认登记收款' }))
  await screen.findByRole('button', { name: '重试原提交' })
  expect(runtime.post).not.toHaveBeenCalled()
})

it('blocks installation during a receipt draft', async () => {
  render(<ReceivableLedger followupId="f" runtime={api()} scope="audit" />)
  fireEvent.change(await screen.findByLabelText('本次收款金额'), { target: { value: '20' } })
  expect((await prepareEnterprisePackageInstall('receipt-draft')).ready).toBe(false)
})

it('blocks installation until an in-flight receipt response is confirmed', async () => {
  const post = vi.fn(() => new Promise(() => {}))
  render(<ReceivableLedger followupId="f" runtime={api(undefined, post)} scope="audit" />)
  fireEvent.change(await screen.findByLabelText('本次收款金额'), { target: { value: '20' } })
  fireEvent.change(screen.getByLabelText('实际到账时间'), { target: { value: '2026-01-01T09:00' } })
  fireEvent.click(screen.getByRole('button', { name: '确认登记收款' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect((await prepareEnterprisePackageInstall('receipt-busy')).ready).toBe(false)
})

it('blocks installation for a restored pending request', async () => {
  savePendingOperation(receiptKey, original)
  render(<ReceivableLedger followupId="f" runtime={api()} scope="audit" />)
  await screen.findByRole('button', { name: '重试原提交' })
  expect((await prepareEnterprisePackageInstall('receipt-uncertain')).ready).toBe(false)
})

it('freezes receipt controls and refuses a form submission during install preparation', async () => {
  const runtime = api()
  render(<ReceivableLedger followupId="f" runtime={runtime} scope="audit" />)
  const input = (await screen.findByLabelText('本次收款金额')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.change(screen.getByLabelText('实际到账时间'), { target: { value: '2026-01-01T09:00' } })
  act(() => $enterprisePackageInstallFrozen.set(true))
  expect(input.disabled).toBe(true)
  fireEvent.submit(input.closest('form')!)
  expect(runtime.post).not.toHaveBeenCalled()
})

it('blocks installation while a task action is being edited', async () => {
  const get = vi.fn(async (url: string) =>
    url.startsWith('/api/business-followup-history') ? balance : { followup: task }
  )

  render(
    <I18nProvider initialLocale="zh">
      <WebTaskDetails onClose={() => {}} runtime={api(get)} scope="audit" task={task} />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: '改期跟进' }))
  expect((await prepareEnterprisePackageInstall('task-draft')).ready).toBe(false)
})

it('keeps the task dialog open while its receipt is in flight', async () => {
  const get = vi.fn(async (url: string) =>
    url.startsWith('/api/business-followup-history') ? balance : { followup: task }
  )

  const post = vi.fn(() => new Promise(() => {}))
  const onClose = vi.fn()
  render(
    <I18nProvider initialLocale="zh">
      <WebTaskDetails onClose={onClose} runtime={api(get, post)} scope="audit" task={task} />
    </I18nProvider>
  )
  fireEvent.change(await screen.findByLabelText('本次收款金额'), { target: { value: '20' } })
  fireEvent.change(screen.getByLabelText('实际到账时间'), { target: { value: '2026-01-01T09:00' } })
  fireEvent.click(screen.getByRole('button', { name: '确认登记收款' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: '改期跟进' }) as HTMLButtonElement).disabled).toBe(true)
})

it('blocks installation while a writeoff reason is being edited', async () => {
  render(
    <ReceivableWriteoff
      disabled={false}
      followupId="f"
      onBusy={() => {}}
      onChanged={() => {}}
      onLock={() => {}}
      refreshKey={0}
      runtime={api()}
      scope="audit"
      subject="测试应收款"
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: '冲销未收余额' }))
  fireEvent.change(screen.getByLabelText('冲销原因（必填）'), { target: { value: '确认无法收回' } })
  expect((await prepareEnterprisePackageInstall('writeoff-draft')).ready).toBe(false)
})

it('settles a committed reschedule retry and displays a subsequent change from another client', async () => {
  // Legacy backend responses confirm the exact request with ok and return the
  // latest record, whose date can differ from the historical confirmed action.
  sessionStorage.setItem(
    taskKey,
    JSON.stringify({
      action: 'reschedule',
      followup_id: 'f',
      idempotency_key: 'original-request',
      expected_receive_date: '2026-10-10'
    })
  )
  const current = { ...task, expected_receive_date: '2026-10-15' }

  const get = vi.fn(async (url: string) =>
    url.startsWith('/api/business-followup-history') ? balance : { followup: current }
  )

  const post = vi.fn(async () => ({ ok: true, followup: current }))
  render(
    <I18nProvider initialLocale="zh">
      <WebTaskDetails onClose={() => {}} runtime={api(get, post)} scope="audit" task={task} />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }))
  await screen.findByText('当前任务已更新。')
  expect(post).toHaveBeenCalledWith(
    '/api/business-followup-action',
    expect.objectContaining({ idempotency_key: 'original-request', expected_receive_date: '2026-10-10' })
  )
  expect(readPendingOperation(taskKey)).toBeNull()
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull()
  expect(screen.getByText('2026-10-15')).toBeTruthy()
})
