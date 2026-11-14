import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { OriginalDoudianWindow } from './doudian-original-window'
import { ReviewCapturePage } from './review-capture-page'
import type { EnterpriseClientRuntime } from './runtime'
import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'

const caps = {
  protocol: 1,
  version: '1.0.54',
  authorized: false,
  chrome: true,
  spreadsheet: true,
  reviewUi: 1,
  paymentUi: 1
}
const idle: DoudianTask = { taskId: null, state: 'idle', saved: 0, summary: '', error: '', messages: [] }
function fixture(feature: 'review', capability: DoudianReply = { ok: true, capabilities: caps }) {
  let task = { ...idle }
  const doudian = vi.fn(async (r: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (r.action === 'capabilities') return capability
    if (r.action === 'openReview')
      task = { ...idle, taskId: 'a'.repeat(32), kind: `${feature}-window`, state: 'running' }
    if (r.action === 'stop') task = { ...task, state: 'stopped' }
    return { ok: true, task }
  })
  return {
    runtime: { doudian } as unknown as EnterpriseClientRuntime,
    doudian,
    setTask: (value: DoudianTask) => {
      task = value
    }
  }
}
function view(feature: 'review', runtime: EnterpriseClientRuntime | null) {
  return render(
    <I18nProvider initialLocale="zh" configClient={null}>
      <OriginalDoudianWindow feature={feature} runtime={runtime} />
    </I18nProvider>
  )
}
for (const feature of ['review'] as const)
  describe(`original ${feature}`, () => {
    const label = '打开订单截图'
    it('allows the original activation dialog, not a fake activated state', async () => {
      const f = fixture(feature)
      view(feature, f.runtime)
      await screen.findByText('原版模块已就绪')
      expect(screen.getByText(/打开后验证原激活码/)).toBeTruthy()
      await waitFor(() => expect(f.doudian).toHaveBeenCalledWith({ action: 'status' }))
      expect(f.doudian.mock.calls.some(([r]) => r.action.startsWith('open'))).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: label }))
      await screen.findByText('原版窗口已打开')
      expect(f.doudian).toHaveBeenCalledWith({ action: 'openReview' })
      expect(f.doudian.mock.calls.some(([r]) => ['start', 'openPayment', 'manageShops'].includes(r.action))).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: '停止并关闭当前窗口' }))
      await screen.findByText('原版窗口已关闭')
      expect(f.doudian).toHaveBeenCalledWith({ action: 'stop', taskId: 'a'.repeat(32) })
    })
    it.each([undefined, 0, 2])('requires exact native feature capability %s', async value => {
      const f = fixture(feature, {
        ok: true,
        capabilities: { ...caps, reviewUi: value }
      })
      view(feature, f.runtime)
      await screen.findByText('原版模块未就绪')
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    })
    it('rejects a changed original module version', async () => {
      view(feature, fixture(feature, { ok: true, capabilities: { ...caps, version: '0.0' } }).runtime)
      await screen.findByText('原版模块未就绪')
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    })
    it('does not let enterprise denied users open the native activation route', async () => {
      view(feature, fixture(feature, { ok: false, error: 'DOUDIAN_FORBIDDEN' }).runtime)
      await screen.findByText('企业账号无访问权限')
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    })
    it('does not control another native feature task', async () => {
      const f = fixture(feature)
      f.setTask({ ...idle, kind: 'payment-window', taskId: 'b'.repeat(32), state: 'running' })
      view(feature, f.runtime)
      await screen.findByText('其他早鸟功能正在使用，请先关闭当前功能窗口')
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.queryByRole('button', { name: '停止并关闭当前窗口' })).toBeNull()
    })
    it('clears old account results and ignores late capabilities', async () => {
      let resolve!: (r: DoudianReply) => void
      const runtime = {
        doudian: () =>
          new Promise<DoudianReply>(r => {
            resolve = r
          })
      } as unknown as EnterpriseClientRuntime
      const mounted = view(feature, runtime)
      mounted.rerender(
        <I18nProvider initialLocale="zh" configClient={null}>
          <OriginalDoudianWindow feature={feature} runtime={null} />
        </I18nProvider>
      )
      await act(async () => resolve({ ok: true, capabilities: caps }))
      expect(screen.getByText('企业账号无访问权限')).toBeTruthy()
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    })
  })
it.each(['review'] as const)(
  'retains stop when a capability retry fails during a running %s window',
  async feature => {
    const label = '打开订单截图'
    const f = fixture(feature)
    const original = f.doudian.getMockImplementation()!
    let offline = false
    f.doudian.mockImplementation(async request => {
      if (offline && request.action !== 'stop') return { ok: false, error: 'OFFLINE' }
      return original(request)
    })
    view(feature, f.runtime)
    await screen.findByText('原版模块已就绪')
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText('原版窗口已打开')
    offline = true
    await screen.findByRole('alert', {}, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    await screen.findByText('原版模块未就绪')
    fireEvent.click(screen.getByRole('button', { name: '停止并关闭当前窗口' }))
    await screen.findByText('原版窗口已关闭')
    expect(f.doudian).toHaveBeenCalledWith({ action: 'stop', taskId: 'a'.repeat(32) })
  }
)
it('the review window does not invent workbook controls', async () => {
  const review = fixture('review')
  render(
    <I18nProvider initialLocale="zh" configClient={null}>
      <OriginalDoudianWindow feature="review" runtime={review.runtime} />
    </I18nProvider>
  )
  await screen.findByRole('button', { name: '打开订单截图' })
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
  expect(screen.queryByTestId('doudian-workbench')).toBeNull()
})

it('the review entry defaults to the native workbench and can fall back to the original window', async () => {
  const review = fixture('review')
  render(
    <I18nProvider initialLocale="zh" configClient={null}>
      <ReviewCapturePage runtime={review.runtime} />
    </I18nProvider>
  )
  await screen.findByTestId('doudian-workbench')
  fireEvent.click(screen.getByRole('button', { name: '原版窗口' }))
  await screen.findByRole('button', { name: '打开订单截图' })
})

it('a late open from the old account cannot keep the new account busy or replace its task', async () => {
  const previous = fixture('review')
  const next = fixture('review')
  let finish!: (reply: DoudianReply) => void
  const original = previous.doudian.getMockImplementation()!
  previous.doudian.mockImplementation(request =>
    request.action === 'openReview'
      ? new Promise<DoudianReply>(resolve => {
          finish = resolve
        })
      : original(request)
  )
  const mounted = view('review', previous.runtime)
  fireEvent.click(await screen.findByRole('button', { name: '打开订单截图' }))
  mounted.rerender(
    <I18nProvider initialLocale="zh" configClient={null}>
      <OriginalDoudianWindow feature="review" runtime={next.runtime} />
    </I18nProvider>
  )
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '打开订单截图' }) as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: '打开订单截图' }))
  await screen.findByText('原版窗口已打开')
  await act(async () =>
    finish({ ok: true, task: { ...idle, taskId: 'b'.repeat(32), kind: 'review-window', state: 'running' } })
  )
  fireEvent.click(screen.getByRole('button', { name: '停止并关闭当前窗口' }))
  await screen.findByText('原版窗口已关闭')
  expect(next.doudian).toHaveBeenCalledWith({ action: 'stop', taskId: 'a'.repeat(32) })
})
