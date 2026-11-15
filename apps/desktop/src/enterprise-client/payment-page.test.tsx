import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'
import { shopBrowserCopy } from '@/i18n/shop-browser'
import type { Locale } from '@/i18n/types'

import type { DoudianReply, DoudianRequest, DoudianShop, DoudianTask } from '../../electron/doudian-types'

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

const profileShop: DoudianShop = {
  id: 'e641158c-bb4a-4a9c-98e1-faf88f0cf965',
  browserProfileId: 'e641158c-bb4a-4a9c-98e1-faf88f0cf965',
  name: '已登录店铺',
  platformId: '1234567890123456789',
  status: 'verified'
}

const legacyShop: DoudianShop = { id: 'a'.repeat(32), name: '旧 TD 店铺', platformId: '123', status: 'Valid' }

const capability = (authorized = true, authorizationMode?: string, embeddedBrowser?: number): DoudianReply => ({
  ok: true,
  capabilities: { protocol: 1, version: '1.0.54', authorized, chrome: true, spreadsheet: true, authorizationMode, paymentControls: 1, paymentCdp: 1, embeddedBrowser }
})

function setup(
  initialCapability = capability(true, 'enterprise-session-v1'),
  initialTask?: DoudianTask,
  locale: Locale = 'zh',
  shops: DoudianShop[] = []
) {
  let cap = initialCapability
  let task = initialTask

  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {return cap}

    if (request.action === 'shops') {return { ok: true, shops }}

    if (request.action === 'chooseWorkbook') {return { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }}

    if (request.action === 'preparePayment') {task = prepared}

    if (request.action === 'startPayment') {task = { ...prepared, state: 'running', summary: '模拟运行' }}

    if (request.action === 'pausePayment' && task) {task = { ...task, state: 'pausing' }}

    if (request.action === 'resumePayment' && task) {task = { ...task, state: 'running' }}

    if (request.action === 'stop' && task) {task = { ...task, state: 'stopped' }}

    return { ok: true, task }
  })

  const runtime = { doudian: send } as unknown as EnterpriseClientRuntime

  const view = render(
    <I18nProvider configClient={null} initialLocale={locale}>
      <PaymentPage runtime={runtime} />
    </I18nProvider>
  )

  return {
    send,
    runtime,
    view,
    setCapability: (next: DoudianReply) => {
      cap = next
    },
    setTask: (next: DoudianTask) => {
      task = next
    }
  }
}

function deferredReply() {
  let resolve!: (reply: DoudianReply) => void

  const promise = new Promise<DoudianReply>(complete => {
    resolve = complete
  })

  return { promise, resolve }
}

function expectParametersLocked() {
  for (const label of ['操作方式', '模式', '金额', '起始行', '最多行（0 表示不限）']) {
    expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).disabled).toBe(true)
  }

  for (const name of ['选择工作簿', '检查并准备', '确认开始打款']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  }
}

async function chooseAndFill(amount = '3.25', startRow = '1', maxRows = '0', mode = 'standard') {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
  await screen.findByText('副本.xlsx')
  fireEvent.change(screen.getByLabelText('操作方式'), { target: { value: 'desktop' } })
  fireEvent.change(screen.getByLabelText('模式'), { target: { value: mode } })
  fireEvent.change(screen.getByLabelText('金额'), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText('起始行'), { target: { value: startRow } })
  fireEvent.change(screen.getByLabelText('最多行（0 表示不限）'), { target: { value: maxRows } })
}

describe('payment page offline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to CDP with an empty editable amount and the exact payment-record rule', async () => {
    const { send } = setup()
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByLabelText('操作方式') as HTMLSelectElement).value).toBe('cdp')
    expect((screen.getByLabelText('金额') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('金额') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('模式') as HTMLSelectElement).value).toBe('standard')
    expect((screen.getByLabelText('模式') as HTMLSelectElement).disabled).toBe(true)
    const explanation = screen.getByText(/仅在款项记录精确匹配/).textContent!
    expect(explanation).toContain('暂无记录，每个订单最多打款5次')
    expect(explanation).toContain('不读取聊天内容')
    expect(explanation).toContain('D 列')
    expect(send.mock.calls.some(([request]) => ['preparePayment', 'startPayment', 'openPayment'].includes(request.action))).toBe(false)
  })

  it('waits for embedded profile discovery before polling the exclusive execution host', async () => {
    const fixture = setup(capability(true, 'enterprise-session-v1', 1))
    const profiles = deferredReply()
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(request => request.action === 'shops' ? profiles.promise : implementation(request))
    await waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ action: 'shops' }))
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'status')).toBe(false)
    await act(async () => profiles.resolve({ ok: true, shops: [profileShop] }))
    await waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ action: 'status' }))
    expect(screen.queryByText(/TASK_BUSY/)).toBeNull()
  })

  it('retains the current view when background status temporarily reports a busy host', async () => {
    const fixture = setup()
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async request => request.action === 'status'
      ? { ok: false, error: 'TASK_BUSY' }
      : implementation(request))
    await waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ action: 'status' }))
    expect(screen.queryByText(/TASK_BUSY/)).toBeNull()
  })

  it.each(['0.01', '7.50', '+100,000.00'])('requires an explicit embedded profile and preserves the entered amount %s', async amount => {
    const { send } = setup(capability(true, 'enterprise-session-v1', 1), undefined, 'zh', [legacyShop, profileShop])
    await screen.findByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })
    const profile = screen.getByRole('combobox', { name: shopBrowserCopy.zh.profile }) as HTMLSelectElement
    expect(profile.value).toBe('')
    expect(screen.queryByRole('option', { name: `${legacyShop.name} (${legacyShop.platformId})` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    expect((screen.getByLabelText('金额') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: amount } })
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('最多行（0 表示不限）'), { target: { value: '13' } })
    const prepare = screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement
    expect(prepare.disabled).toBe(true)
    fireEvent.click(prepare)
    expect(send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
    fireEvent.change(profile, { target: { value: profileShop.browserProfileId } })
    expect(prepare.disabled).toBe(false)
    fireEvent.click(prepare)
    await screen.findByText(prepared.summary)
    expect(send).toHaveBeenCalledWith({
      action: 'preparePayment', workbookId: 'b'.repeat(32), amount, startRow: '7', maxRows: '13',
      mode: 'standard', transport: 'cdp', browserProfileId: profileShop.browserProfileId
    })
    expect(profile.disabled).toBe(true)
    expect(send.mock.calls.some(([request]) => ['startPayment', 'openPayment', 'openFeige'].includes(request.action))).toBe(false)
  })

  it('keeps desktop preparation parameters intact after selecting an embedded profile', async () => {
    const { send } = setup(capability(true, 'enterprise-session-v1', 1), undefined, 'zh', [profileShop])
    await screen.findByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })
    fireEvent.change(screen.getByLabelText(shopBrowserCopy.zh.profile), { target: { value: profileShop.browserProfileId } })
    await chooseAndFill('+100,000.00', '2147483647', '2147483647', 'new-order')
    expect(screen.queryByLabelText(shopBrowserCopy.zh.profile)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(send).toHaveBeenCalledWith({
      action: 'preparePayment', workbookId: 'b'.repeat(32), amount: '+100,000.00',
      startRow: '2147483647', maxRows: '2147483647', mode: 'new-order', transport: 'desktop'
    })
  })

  it.each(['empty', 'failed', 'rejected'] as const)('blocks profile CDP preparation with an %s profile list and keeps desktop usable', async result => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), undefined, 'zh', [legacyShop])
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '3.25' } })
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async request => {
      if (request.action === 'shops') {
        if (result === 'rejected') { throw new Error('offline profile failure') }

        return result === 'failed' ? { ok: false, error: 'DOUDIAN_FORBIDDEN' } : { ok: true, shops: [legacyShop] }
      }

      return implementation(request)
    })
    fixture.setCapability(capability(true, 'enterprise-session-v1', 1))
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByRole('option', { name: shopBrowserCopy.zh.empty })
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
    fireEvent.change(screen.getByLabelText('操作方式'), { target: { value: 'desktop' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(fixture.send).toHaveBeenCalledWith({
      action: 'preparePayment', workbookId: 'b'.repeat(32), amount: '3.25', startRow: '1', maxRows: '0',
      mode: 'standard', transport: 'desktop'
    })
  })

  it.each([undefined, 0, 2])('preserves the old CDP path with embedded browser capability %s', async embeddedBrowser => {
    const { send } = setup(capability(true, 'enterprise-session-v1', embeddedBrowser), undefined, 'zh', [profileShop])
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByLabelText(shopBrowserCopy.zh.profile)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '3.25' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(send).toHaveBeenCalledWith({
      action: 'preparePayment', workbookId: 'b'.repeat(32), amount: '3.25', startRow: '1', maxRows: '0',
      mode: 'standard', transport: 'cdp'
    })
    expect(send.mock.calls.some(([request]) => request.action === 'shops')).toBe(false)
  })

  it('clears the selected profile and workbook on runtime changes and requires a new selection', async () => {
    const fixture = setup(capability(true, 'enterprise-session-v1', 1), undefined, 'zh', [profileShop])
    await screen.findByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })
    fireEvent.change(screen.getByLabelText(shopBrowserCopy.zh.profile), { target: { value: profileShop.browserProfileId } })
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    const pending = deferredReply()

    const nextSend = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') { return capability(true, 'enterprise-session-v1', 1) }

      if (request.action === 'shops') { return pending.promise }

      if (request.action === 'chooseWorkbook') { return { ok: true, workbook: { id: 'd'.repeat(32), name: '新租户副本.xlsx' } } }

      if (request.action === 'preparePayment') { return { ok: true, task: prepared } }

      return { ok: true }
    })

    fixture.view.rerender(<I18nProvider configClient={null} initialLocale="zh"><PaymentPage runtime={{ doudian: nextSend } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    expect(screen.queryByText('副本.xlsx')).toBeNull()
    expect(screen.queryByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })).toBeNull()
    await waitFor(() => expect(nextSend).toHaveBeenCalledWith({ action: 'shops' }))
    expect((screen.getByLabelText(shopBrowserCopy.zh.profile) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('新租户副本.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '2.50' } })
    await act(async () => { pending.resolve({ ok: true, shops: [profileShop] }) })
    const profile = screen.getByLabelText(shopBrowserCopy.zh.profile) as HTMLSelectElement
    expect(profile.value).toBe('')
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(profile, { target: { value: profileShop.browserProfileId } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(nextSend).toHaveBeenCalledWith({
      action: 'preparePayment', workbookId: 'd'.repeat(32), amount: '2.50', startRow: '1', maxRows: '0',
      mode: 'standard', transport: 'cdp', browserProfileId: profileShop.browserProfileId
    })
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
  })

  it('ignores a late profile list from the previous runtime', async () => {
    const pending = deferredReply()

    const oldSend = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') { return capability(true, 'enterprise-session-v1', 1) }

      if (request.action === 'shops') { return pending.promise }

      return { ok: true }
    })

    const view = render(<I18nProvider configClient={null} initialLocale="zh"><PaymentPage runtime={{ doudian: oldSend } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    await waitFor(() => expect(oldSend).toHaveBeenCalledWith({ action: 'shops' }))
    const nextShop: DoudianShop = { ...profileShop, id: 'f'.repeat(32), browserProfileId: 'f'.repeat(32), name: '当前租户店铺' }

    const nextSend = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') { return capability(true, 'enterprise-session-v1', 1) }

      if (request.action === 'shops') { return { ok: true, shops: [nextShop] } }

      return { ok: true }
    })

    view.rerender(<I18nProvider configClient={null} initialLocale="zh"><PaymentPage runtime={{ doudian: nextSend } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    await screen.findByRole('option', { name: `${nextShop.name} (${nextShop.platformId})` })
    fireEvent.change(screen.getByLabelText(shopBrowserCopy.zh.profile), { target: { value: nextShop.browserProfileId } })
    await act(async () => { pending.resolve({ ok: true, shops: [profileShop] }) })
    expect(screen.queryByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })).toBeNull()
    expect((screen.getByLabelText(shopBrowserCopy.zh.profile) as HTMLSelectElement).value).toBe(nextShop.browserProfileId)
  })

  it('requires profile selection if embedded browser support appears during capability revalidation', async () => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), undefined, 'zh', [profileShop])
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '3.25' } })
    fixture.setCapability(capability(true, 'enterprise-session-v1', 1))
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })
    expect((await screen.findByRole('alert')).textContent).toContain(shopBrowserCopy.zh.selectProfile)
    expect((screen.getByLabelText(shopBrowserCopy.zh.profile) as HTMLSelectElement).value).toBe('')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
    fireEvent.change(screen.getByLabelText(shopBrowserCopy.zh.profile), { target: { value: profileShop.browserProfileId } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({ action: 'preparePayment', browserProfileId: profileShop.browserProfileId, amount: '3.25' }))
  })

  it.each(['preparing', 'awaiting_confirmation', 'running', 'pausing', 'paused', 'stopping', 'unknown'] as const)(
    'locks the profile selection for an active %s task', async state => {
      setup(capability(true, 'enterprise-session-v1', 1), { ...prepared, state }, 'zh', [profileShop])
      await screen.findByText(prepared.summary)
      await screen.findByRole('option', { name: `${profileShop.name} (${profileShop.platformId})` })
      expect((screen.getByLabelText(shopBrowserCopy.zh.profile) as HTMLSelectElement).disabled).toBe(true)
    }
  )

  it.each(['zh', 'zh-hant', 'en', 'ja', 'ar'] as const)('uses localized profile and empty labels for %s', async locale => {
    const { send } = setup(capability(true, 'enterprise-session-v1', 1), undefined, locale, [legacyShop])
    await screen.findByRole('option', { name: shopBrowserCopy[locale].empty })
    expect((screen.getByLabelText(shopBrowserCopy[locale].profile) as HTMLSelectElement).value).toBe('')
    expect(send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
  })

  it.each(['3.25', '7.50'])('prepares the manually entered CDP amount %s and starts only on confirmation', async amount => {
    const { send } = setup()
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: amount } })
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('最多行（0 表示不限）'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(send).toHaveBeenCalledWith({ action: 'preparePayment', workbookId: 'b'.repeat(32), amount, startRow: '2', maxRows: '4', mode: 'standard', transport: 'cdp' })

    for (const label of ['操作方式', '模式', '金额', '起始行', '最多行（0 表示不限）']) {
      expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).disabled).toBe(true)
    }

    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '确认开始打款' }) as HTMLButtonElement).disabled).toBe(false)
    expect(send.mock.calls.some(([request]) => request.action === 'startPayment')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    await screen.findByText('模拟运行')
    expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '停止' }) as HTMLButtonElement).disabled).toBe(false)
    expect(send.mock.calls.filter(([request]) => request.action === 'startPayment')).toEqual([[{ action: 'startPayment', taskId: prepared.taskId }]])
    expect(send.mock.calls.every(([request]) => ['capabilities', 'status', 'chooseWorkbook', 'preparePayment', 'startPayment'].includes(request.action))).toBe(true)
  })

  it('keeps desktop amounts and modes editable when switching explicitly', async () => {
    setup()
    await chooseAndFill('3.25', '2', '3', 'new-order')
    expect((screen.getByLabelText('金额') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('模式') as HTMLSelectElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('操作方式'), { target: { value: 'cdp' } })
    expect((screen.getByLabelText('金额') as HTMLInputElement).value).toBe('3.25')
    expect((screen.getByLabelText('金额') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('模式') as HTMLSelectElement).value).toBe('standard')
    fireEvent.change(screen.getByLabelText('操作方式'), { target: { value: 'desktop' } })
    expect((screen.getByLabelText('金额') as HTMLInputElement).value).toBe('3.25')
    expect((screen.getByLabelText('模式') as HTMLSelectElement).value).toBe('new-order')
    expect((screen.getByLabelText('起始行') as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('最多行（0 表示不限）') as HTMLInputElement).value).toBe('3')
  })

  it.each([undefined, 0, 2])('rejects CDP capability %s without automatically switching to desktop', async paymentCdp => {
    const reply = capability(true, 'enterprise-session-v1')
    reply.capabilities!.paymentCdp = paymentCdp
    const { send } = setup(reply)
    await screen.findByText('执行模块尚不支持 CDP 打款，请更新执行模块或手动选择原桌面兼容。')
    expect((screen.getByLabelText('操作方式') as HTMLSelectElement).value).toBe('cdp')
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    expect(send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
    fireEvent.change(screen.getByLabelText('操作方式'), { target: { value: 'desktop' } })
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '3.25' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await screen.findByText(prepared.summary)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: 'preparePayment', transport: 'desktop', amount: '3.25' }))
  })

  it('rechecks CDP capability before preparing and keeps the CDP selection on failure', async () => {
    const fixture = setup()
    await waitFor(() => expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择工作簿' }))
    await screen.findByText('副本.xlsx')
    const changed = capability(true, 'enterprise-session-v1')
    changed.capabilities!.paymentCdp = undefined
    fixture.setCapability(changed)
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '3.25' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并准备' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByLabelText('操作方式') as HTMLSelectElement).value).toBe('cdp')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'preparePayment')).toBe(false)
    expect(screen.getAllByText(/执行模块尚不支持 CDP 打款/).length).toBeGreaterThan(0)
  })

  it('waits for the host to pause and resumes the same task and step only on a click', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    const running: DoudianTask = {
      ...prepared,
      state: 'running',
      saved: 4,
      summary: '当前步骤：提交后核验',
      error: '提交结果待核验',
      messages: ['订单已提交，待人工核验。']
    }

    const fixture = setup(capability(true, 'enterprise-session-v1'), running)
    await screen.findByText('正在打款')
    expect(fixture.send.mock.calls.some(([request]) => ['pausePayment', 'resumePayment'].includes(request.action))).toBe(false)

    const pause = screen.getByRole('button', { name: '暂停' })
    fireEvent.click(pause)
    fireEvent.click(pause)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '正在保存并暂停' }) as HTMLButtonElement).disabled).toBe(true)
    )
    expectParametersLocked()
    expect(screen.getByText('保存数量: 4')).toBeTruthy()
    expect(screen.getByText(running.summary)).toBeTruthy()
    expect(screen.getByText(running.error)).toBeTruthy()
    expect(screen.getByText(running.messages[0])).toBeTruthy()
    expect(fixture.send.mock.calls.filter(([request]) => request.action === 'pausePayment')).toEqual([
      [{ action: 'pausePayment', taskId: running.taskId }]
    ])
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(true)

    fixture.setTask({ ...running, state: 'paused' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    await screen.findByText('打款已暂停。')
    expect(screen.getByText('保存数量: 4')).toBeTruthy()
    expect(screen.getByText(running.summary)).toBeTruthy()
    expect(screen.getByText(running.error)).toBeTruthy()
    expect(screen.getByText(running.messages[0])).toBeTruthy()
    expectParametersLocked()
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '停止' }) as HTMLButtonElement).disabled).toBe(false)
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'resumePayment')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByText('正在打款')
    expect(screen.getByText('保存数量: 4')).toBeTruthy()
    expect(screen.getByText(running.summary)).toBeTruthy()
    expect(screen.getByText(running.error)).toBeTruthy()
    expect(screen.getByText(running.messages[0])).toBeTruthy()
    expect(fixture.send.mock.calls.filter(([request]) => request.action === 'resumePayment')).toEqual([
      [{ action: 'resumePayment', taskId: running.taskId }]
    ])
    expect(fixture.send.mock.calls.some(([request]) => ['startPayment', 'preparePayment', 'stop'].includes(request.action))).toBe(false)
  })

  it.each([
    ['chooseWorkbook', '选择工作簿', undefined, 'idle'],
    ['preparePayment', '检查并准备', undefined, 'awaiting_confirmation'],
    ['startPayment', '确认开始打款', 'awaiting_confirmation', 'running'],
    ['pausePayment', '暂停', 'running', 'pausing'],
    ['resumePayment', '继续', 'paused', 'running'],
    ['stop', '停止', 'paused', 'stopped']
  ] as const)(
    'locks parameters and rejects duplicate actions while %s is pending',
    async (action, name, initialState, settledState) => {
      const initialTask: DoudianTask | undefined = initialState ? { ...prepared, state: initialState } : undefined
      const fixture = setup(capability(true, 'enterprise-session-v1'), initialTask)

      if (action === 'preparePayment') {
        await chooseAndFill()
      } else {
        await waitFor(() => expect(fixture.send.mock.calls.some(([request]) => request.action === 'status')).toBe(true))
      }

      const pending = deferredReply()
      const implementation = fixture.send.getMockImplementation()!
      fixture.send.mockImplementation(request => request.action === action ? pending.promise : implementation(request))
      const button = screen.getByRole('button', { name })
      fireEvent.click(button)
      fireEvent.click(button)
      await waitFor(() => expect(fixture.send.mock.calls.filter(([request]) => request.action === action)).toHaveLength(1))
      expectParametersLocked()
      expect((button as HTMLButtonElement).disabled).toBe(true)

      if (action === 'pausePayment') {
        expect(screen.getByRole('button', { name: '正在保存并暂停' })).toBeTruthy()
        expect(screen.queryByText('打款已暂停。')).toBeNull()
      }

      await act(async () => {
        pending.resolve(action === 'chooseWorkbook'
          ? { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }
          : { ok: true, task: { ...prepared, state: settledState } })
      })
    }
  )

  it.each([
    ['idle', false, false, false],
    ['preparing', false, false, true],
    ['awaiting_confirmation', false, false, true],
    ['running', true, false, true],
    ['pausing', false, false, true],
    ['paused', false, true, true],
    ['stopping', false, false, false],
    ['stopped', false, false, false],
    ['completed', false, false, false],
    ['paused_balance', false, false, false],
    ['paused_review', false, false, false],
    ['failed', false, false, false],
    ['unknown', false, false, true]
  ] as const)('restricts actions in %s', async (state, canPause, canResume, canStop) => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state })
    await screen.findByText(prepared.summary)
    const pause = screen.getByRole('button', { name: state === 'pausing' ? '正在保存并暂停' : '暂停' })
    const resume = screen.getByRole('button', { name: '继续' })
    const stop = screen.queryByRole('button', { name: '停止' })
    expect((pause as HTMLButtonElement).disabled).toBe(!canPause)
    expect((resume as HTMLButtonElement).disabled).toBe(!canResume)
    expect(!!stop && !(stop as HTMLButtonElement).disabled).toBe(canStop)

    if (!canPause) { fireEvent.click(pause) }

    if (!canResume) { fireEvent.click(resume) }

    if (stop && !canStop) { fireEvent.click(stop) }
    expect(send.mock.calls.some(([request]) => ['pausePayment', 'resumePayment', 'stop'].includes(request.action))).toBe(false)

    if (state === 'pausing' || state === 'paused') {
      expectParametersLocked()
    }
  })

  it.each(['pausing', 'paused'] as const)('cancels a %s task through the stop action', async state => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state, saved: 7 })
    await screen.findByText(prepared.summary)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await screen.findByText('任务已停止。')
    expect(send).toHaveBeenCalledWith({ action: 'stop', taskId: prepared.taskId })
    expect(screen.getByText('保存数量: 7')).toBeTruthy()
    expect(send.mock.calls.some(([request]) => ['pausePayment', 'resumePayment', 'startPayment'].includes(request.action))).toBe(false)
    expect((screen.getByRole('button', { name: '选择工作簿' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('restores a persisted paused task from status and resumes without choosing a workbook again', async () => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state: 'paused', saved: 9 })
    await screen.findByText('打款已暂停。')
    expect(screen.getByText('未选择工作簿')).toBeTruthy()
    expectParametersLocked()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByText('正在打款')
    expect(send).toHaveBeenCalledWith({ action: 'resumePayment', taskId: prepared.taskId })
    expect(send.mock.calls.some(([request]) => ['chooseWorkbook', 'preparePayment', 'startPayment'].includes(request.action))).toBe(false)
  })

  it.each([
    ['changed task', { ...prepared, state: 'paused', taskId: 'd'.repeat(32) }],
    ['changed state', { ...prepared, state: 'running' }],
    ['another task kind', { ...prepared, state: 'paused', kind: 'review' }],
    ['missing task', undefined]
  ] as const)('rechecks the paused task before resuming with %s', async (_label, nextTask) => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state: 'paused' })
    await screen.findByText('打款已暂停。')
    fixture.send.mockImplementationOnce(async () => capability(true, 'enterprise-session-v1'))
    fixture.send.mockImplementationOnce(async () => ({ ok: true, task: nextTask }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect((await screen.findByRole('alert')).textContent).toContain('任务状态已变化，请重新核对。')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'resumePayment')).toBe(false)
  })

  it('rechecks authorization before resuming and preserves the stop action', async () => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state: 'paused' })
    await screen.findByText('打款已暂停。')
    fixture.setCapability(capability())
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('alert')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'resumePayment')).toBe(false)
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(true)
    expectParametersLocked()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await screen.findByText('任务已停止。')
    expect(fixture.send).toHaveBeenCalledWith({ action: 'stop', taskId: prepared.taskId })
  })

  it.each(['failed reply', 'rejected request'])('keeps the paused task locked when its status check returns a %s', async failure => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state: 'paused' })
    await screen.findByText('打款已暂停。')
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async request => {
      if (request.action === 'status') {
        if (failure === 'rejected request') { throw new Error('offline status failure') }

        return { ok: false, error: 'DOUDIAN_TEST_STATUS_FAILED' }
      }

      return implementation(request)
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('alert')
    expect(screen.getByText('打款已暂停。')).toBeTruthy()
    expectParametersLocked()
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'resumePayment')).toBe(false)
    expect((screen.getByRole('button', { name: '停止' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([
    ['pausePayment', 'running', '暂停'],
    ['resumePayment', 'paused', '继续']
  ] as const)('ignores a pending %s reply after switching runtimes', async (action, state, name) => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state })
    await screen.findByText(prepared.summary)
    const pending = deferredReply()
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(request => request.action === action ? pending.promise : implementation(request))
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(fixture.send.mock.calls.some(([request]) => request.action === action)).toBe(true))

    const nextTask: DoudianTask = { ...prepared, taskId: 'd'.repeat(32), state: 'paused', summary: '新会话已暂停任务' }

    const nextSend = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> =>
      request.action === 'capabilities' ? capability(true, 'enterprise-session-v1') : { ok: true, task: nextTask }
    )

    const nextRuntime = { doudian: nextSend } as unknown as EnterpriseClientRuntime
    fixture.view.rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <PaymentPage runtime={nextRuntime} />
      </I18nProvider>
    )
    await screen.findByText(nextTask.summary)
    await act(async () => {
      pending.resolve({ ok: true, task: { ...prepared, state: 'running', summary: '旧会话返回结果' } })
    })
    expect(screen.queryByText('旧会话返回结果')).toBeNull()
    expect(screen.getByText(nextTask.summary)).toBeTruthy()
    expectParametersLocked()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => expect(nextSend).toHaveBeenCalledWith({ action: 'resumePayment', taskId: nextTask.taskId }))
  })

  it('ignores a stale running poll after a pause request', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const running: DoudianTask = { ...prepared, state: 'running' }
    const fixture = setup(capability(true, 'enterprise-session-v1'), running)
    await screen.findByText('正在打款')
    const pending = deferredReply()
    fixture.send.mockImplementationOnce(() => pending.promise)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ action: 'pausePayment', taskId: running.taskId }))
    await act(async () => {
      pending.resolve({ ok: true, task: running })
    })
    expect(screen.queryByText('正在打款')).toBeNull()
    expect((screen.getByRole('button', { name: '正在保存并暂停' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(true)
    expectParametersLocked()
  })

  it.each([undefined, 0, 2])('disables unsupported payment controls %s and still allows cancellation', async paymentControls => {
    const reply = capability(true, 'enterprise-session-v1')
    reply.capabilities!.paymentControls = paymentControls
    const { send } = setup(reply, { ...prepared, state: 'paused' })
    await screen.findByText('打款已暂停。')
    expect(screen.getByText('执行模块尚不支持暂停和继续，请更新执行模块。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(send.mock.calls.some(([request]) => ['pausePayment', 'resumePayment'].includes(request.action))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await screen.findByText('任务已停止。')
    expect(send).toHaveBeenCalledWith({ action: 'stop', taskId: prepared.taskId })
  })

  it('rechecks paymentControls before resuming', async () => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state: 'paused' })
    await screen.findByText('打款已暂停。')
    const reply = capability(true, 'enterprise-session-v1')
    reply.capabilities!.paymentControls = 0
    fixture.setCapability(reply)
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect((await screen.findByRole('alert')).textContent).toContain('执行模块尚不支持暂停和继续')
    expect(fixture.send.mock.calls.some(([request]) => request.action === 'resumePayment')).toBe(false)
    expectParametersLocked()
    expect((screen.getByRole('button', { name: '停止' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([
    ['running', '暂停', 'pausePayment', '正在打款'],
    ['paused', '继续', 'resumePayment', '打款已暂停。']
  ] as const)('shows a failed %s operation and allows an explicit retry', async (state, name, action, stateLabel) => {
    const fixture = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state })
    await screen.findByText(stateLabel)
    const implementation = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async request => request.action === action
      ? { ok: false, error: 'DOUDIAN_TEST_REJECTED' }
      : implementation(request))
    fireEvent.click(screen.getByRole('button', { name }))
    expect((await screen.findByRole('alert')).textContent).toContain('DOUDIAN_TEST_REJECTED')
    expect(screen.getByText(stateLabel)).toBeTruthy()
    expectParametersLocked()
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
    fixture.send.mockImplementation(implementation)
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(fixture.send.mock.calls.filter(([request]) => request.action === action)).toHaveLength(2))
  })

  it.each(['running', 'paused'] as const)('requires a task id for %s controls', async state => {
    const { send } = setup(capability(true, 'enterprise-session-v1'), { ...prepared, state, taskId: null })
    await screen.findByText(prepared.summary)
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(send.mock.calls.some(([request]) => ['pausePayment', 'resumePayment', 'stop'].includes(request.action))).toBe(false)
  })

  it.each([
    ['zh', 'pausing', '正在保存并暂停', '暂停', '继续', '停止', '按 D 列已保存结果续接'],
    ['zh', 'paused', '打款已暂停。', '暂停', '继续', '停止', '按 D 列已保存结果续接'],
    ['zh-hant', 'paused', '打款已暂停。', '暂停', '继续', '停止', '按 D 列已保存结果续接'],
    ['en', 'pausing', 'Saving and pausing', 'Pause', 'Resume', 'Stop', 'saved results in column D'],
    ['en', 'paused', 'Payment paused.', 'Pause', 'Resume', 'Stop', 'saved results in column D']
  ] as const)('localizes %s %s and explains durable workbook continuation', async (locale, state, stateLabel, pause, resume, stop, explanation) => {
    setup(capability(true, 'enterprise-session-v1'), { ...prepared, state }, locale)
    await screen.findByText(prepared.summary)
    expect(screen.getAllByText(stateLabel).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: state === 'pausing' ? stateLabel : pause })).toBeTruthy()
    expect(screen.getByRole('button', { name: resume })).toBeTruthy()
    expect(screen.getByRole('button', { name: stop })).toBeTruthy()
    expect(screen.getByText(new RegExp(explanation))).toBeTruthy()
    const continuation = screen.getByText(new RegExp(explanation)).textContent
    expect(continuation).toContain(locale === 'en' ? 'after the current operation completes' : '在当前操作完成后暂停')
    expect(continuation).toContain(locale === 'en' ? 'same task at the same step' : '同一任务的同一步')
    expect(continuation).toContain(locale === 'en' ? 'Submitted payments remain pending verification' : '已提交的打款状态保留待核验')
  })

  it('explains a failed Esc registration without claiming payment started', async () => {
    const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') { return capability(true, 'enterprise-session-v1') }

      if (request.action === 'status') { return { ok: true, task: prepared } }

      if (request.action === 'startPayment') { return { ok: false, error: 'DOUDIAN_ESCAPE_UNAVAILABLE' } }

      return { ok: true }
    })

    render(<I18nProvider configClient={null} initialLocale="zh"><PaymentPage runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} /></I18nProvider>)
    await screen.findByText('模拟准备结果')
    fireEvent.click(screen.getByRole('button', { name: '确认开始打款' }))
    expect((await screen.findByRole('alert')).textContent).toContain('无法注册 Esc 紧急停止快捷键，打款未启动')
  })
  it('reports an unavailable local security environment and blocks payment', async () => {
    const { send } = setup({ ok: false, error: 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' })
    await screen.findByText('本地安全环境尚未就绪，暂时无法运行。')
    expect((screen.getByRole('button', { name: '检查并准备' }) as HTMLButtonElement).disabled).toBe(true)
    expect(send.mock.calls.some(([request]) => ['preparePayment', 'startPayment'].includes(request.action))).toBe(false)
  })
  it('closes the payment gate if isolation becomes unavailable during preparation', async () => {
    const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') {return capability(true, 'enterprise-session-v1')}

      if (request.action === 'chooseWorkbook') {return { ok: true, workbook: { id: 'b'.repeat(32), name: '副本.xlsx' } }}

      if (request.action === 'preparePayment') {return { ok: false, error: 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' }}

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
        mode,
        transport: 'desktop'
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
