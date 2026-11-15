import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true })
})

const capability = 'hermes-task-isolation-v1'
const id = (letter: string) => letter.repeat(32)
const result = (kind: string, state: string, taskId = id('c')) => ({
  kind, state, taskId, saved: 0, summary: '', error: '', messages: []
})

async function fixture(isolation: unknown = capability, omitMarker = false, initialTask = result('review', 'idle', '')) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-td-contract-'))
  folders.push(folder)
  const file = path.join(folder, 'synthetic.xlsx')
  await fs.writeFile(file, 'fixture')
  let task = initialTask
  const capabilities = { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1', paymentUi: 1, reviewUi: 1, feigeUi: 1, taskIsolation: isolation, paymentControls: 1 as unknown, paymentCdp: 1 as unknown }
  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string, _args?: Record<string, string>, dispatch?: { before(): void; after?(): void; foreground?: boolean }): Promise<unknown> => {
      dispatch?.before()
      dispatch?.after?.()
      if (method === 'initialize') return { protocol: 1, integration: 'hermes-review-v1', version: '1.0.54', authorizationMode: 'enterprise-session-v1', ...(omitMarker ? {} : { taskIsolation: isolation }) }
      if (method === 'capabilities') return capabilities
      if (method === 'prepare') task = result('review', 'awaiting_confirmation')
      if (method === 'preparePayment') task = result('payment', 'awaiting_confirmation')
      if (method === 'start') task = result('review', 'running')
      if (method === 'startPayment' || method === 'resumePayment') task = result('payment', 'running')
      if (method === 'pausePayment') task = result('payment', 'pausing')
      if (method === 'openPayment') task = result('payment-window', 'running')
      if (method === 'stop') task = result(task.kind, 'stopped')
      return task
    })
  }
  const deps = {
    platform: 'win32', root: folder,
    authorize: vi.fn(async () => id('a') + id('a')),
    authorizePayment: vi.fn(async () => { throw new Error('obsolete grant must never run') }),
    isCurrent: vi.fn(() => true),
    chooseWorkbook: vi.fn(async () => file),
    verify: vi.fn(async () => 'isolated-test-host'),
    createHost: vi.fn(() => host)
  }
  const controller = new DoudianController(deps)
  const call = (request: Omit<DoudianRequest, 'sessionId'>) => controller.operate({ sessionId: 'fixture', ...request })
  const choice = async () => {
    const selected = await call({ action: 'chooseWorkbook' })
    expect(selected.ok).toBe(true)
    return selected.workbook!.id
  }
  return { controller, deps, host, capabilities, call, choice, file }
}

async function paymentFixture(state = 'running') {
  const f = await fixture(capability, false, result('payment', state))
  expect((await f.call({ action: 'status' })).ok).toBe(true)
  return f
}

describe('fixed TD payment bridge contract', () => {
  it.each(['0.01', '3.25', '7.50', '100000', '5.000000000000000000000000000001'])('prepares CDP with exact parameters and starts/resumes without foreground handoff, amount=%s', async amount => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect((await f.call({ action: 'preparePayment', workbookId, amount, startRow: '2', maxRows: '3', mode: 'standard', transport: 'cdp' })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('preparePayment', {
      workbook: f.file, amount, startRow: '2', maxRows: '3', mode: 'standard', transport: 'cdp'
    })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('startPayment', { taskId: id('c') }, {
      before: expect.any(Function), foreground: false
    })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(false)
    expect(f.host.request.mock.calls.filter(([method]) => method === 'startPayment')).toHaveLength(1)
    expect((await f.call({ action: 'pausePayment', taskId: id('c') })).ok).toBe(true)
    expect((await f.call({ action: 'resumePayment', taskId: id('c') })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('resumePayment', { taskId: id('c') }, {
      before: expect.any(Function), foreground: false
    })
    expect((await f.call({ action: 'stop', taskId: id('c') })).ok).toBe(true)
    expect(f.deps.authorizePayment).not.toHaveBeenCalled()
  })

  it('keeps explicit desktop parameters and foreground handoff without CDP capability', async () => {
    const f = await fixture()
    f.capabilities.paymentCdp = undefined
    const workbookId = await f.choice()
    expect((await f.call({ action: 'preparePayment', workbookId, amount: '3.25', startRow: '2', maxRows: '0', mode: 'new-order', transport: 'desktop' })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('preparePayment', {
      workbook: f.file, amount: '3.25', startRow: '2', maxRows: '0', mode: 'new-order', transport: 'desktop'
    })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('startPayment', { taskId: id('c') }, {
      before: expect.any(Function), foreground: true
    })
  })

  it.each([
    ['ocr', 'INVALID_TRANSPORT'], ['', 'INVALID_TRANSPORT'], ['CDP', 'INVALID_TRANSPORT'],
    [null, 'DOUDIAN_INVALID_REQUEST'], [1, 'DOUDIAN_INVALID_REQUEST'], [undefined, 'DOUDIAN_INVALID_REQUEST']
  ])('rejects an explicitly invalid transport %s before host dispatch', async (transport, error) => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect(await f.call({ action: 'preparePayment', workbookId, amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport } as DoudianRequest))
      .toEqual({ ok: false, error })
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment')).toBe(false)
  })

  it.each([
    ['', 'standard', 'INVALID_AMOUNT'], ['0', 'standard', 'INVALID_AMOUNT'],
    ['-1', 'standard', 'INVALID_AMOUNT'], ['100000.01', 'standard', 'INVALID_AMOUNT'],
    ['5', 'new-order', 'INVALID_MODE']
  ])('rejects CDP amount=%s mode=%s without preparing a fallback', async (amount, mode, error) => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect(await f.call({ action: 'preparePayment', workbookId, amount, startRow: '1', maxRows: '0', mode, transport: 'cdp' } as DoudianRequest))
      .toEqual({ ok: false, error })
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment')).toBe(false)
  })

  it.each([undefined, null, '1', 0, 2, true])('rejects CDP on an older or incompatible host marker %s', async marker => {
    const f = await fixture()
    f.capabilities.paymentCdp = marker
    const workbookId = await f.choice()
    expect(await f.call({ action: 'preparePayment', workbookId, amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' }))
      .toEqual({ ok: false, error: 'PAYMENT_CDP_UNSUPPORTED' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment')).toBe(false)
    expect(f.host.close).not.toHaveBeenCalled()
    expect((await f.call({ action: 'preparePayment', workbookId, amount: '3', startRow: '1', maxRows: '0', mode: 'new-order' })).ok).toBe(true)
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('startPayment', { taskId: id('c') }, expect.objectContaining({ foreground: true }))
  })

  it.each(['startPayment', 'resumePayment'] as const)('rechecks the bound CDP capability before %s without losing the prepared task', async action => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect((await f.call({ action: 'preparePayment', workbookId, amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' })).ok).toBe(true)
    if (action === 'resumePayment') {
      expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
      expect((await f.call({ action: 'pausePayment', taskId: id('c') })).ok).toBe(true)
    }
    f.capabilities.paymentCdp = 0
    expect(await f.call({ action, taskId: id('c') })).toEqual({ ok: false, error: 'PAYMENT_CDP_UNSUPPORTED' })
    expect(f.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    f.capabilities.paymentCdp = 1
    expect((await f.call({ action, taskId: id('c') })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith(action, { taskId: id('c') }, expect.objectContaining({ foreground: false }))
  })

  it('does not accept a transport override on start, pause or resume', async () => {
    const f = await fixture()
    const workbookId = await f.choice()
    await f.call({ action: 'preparePayment', workbookId, amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' })
    for (const action of ['startPayment', 'pausePayment', 'resumePayment'] as const) {
      expect(await f.call({ action, taskId: id('c'), transport: 'desktop' })).toEqual({ ok: false, error: 'DOUDIAN_INVALID_REQUEST' })
      expect(f.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    }
    expect(await f.call({ action: 'startPayment', taskId: id('d') })).toEqual({ ok: false, error: 'TASK_NOT_FOUND' })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
  })

  it.each(['tenant', 'session'])('retains the %s fence for a prepared CDP task', async boundary => {
    const f = await fixture()
    const workbookId = await f.choice()
    await f.call({ action: 'preparePayment', workbookId, amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' })
    if (boundary === 'tenant') f.deps.authorize.mockResolvedValue(id('b') + id('b'))
    else f.deps.isCurrent.mockReturnValue(false)
    expect(await f.call({ action: 'startPayment', taskId: id('c') })).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(f.host.close).toHaveBeenCalled()
    expect(f.host.request.mock.calls.some(([method]) => method === 'startPayment')).toBe(false)
  })

  it('retains asset validation before creating any CDP host', async () => {
    const f = await fixture()
    f.deps.verify.mockRejectedValue(new Error('DOUDIAN_MODULE_INVALID'))
    expect(await f.call({ action: 'preparePayment', workbookId: id('b'), amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' }))
      .toEqual({ ok: false, error: 'DOUDIAN_MODULE_INVALID' })
    expect(f.deps.createHost).not.toHaveBeenCalled()
  })

  it('retains the local foreground guard for CDP without bypassing an unsafe module', async () => {
    const f = await fixture()
    const verifyForegroundHost = vi.fn(async () => false)
    Object.assign(f.deps, { localVerification: true, localForeground: true, verifyForegroundHost })
    expect(await f.call({ action: 'preparePayment', workbookId: id('b'), amount: '5', startRow: '1', maxRows: '0', mode: 'standard', transport: 'cdp' }))
      .toEqual({ ok: false, error: 'DOUDIAN_TEST_HOST_UNSAFE' })
    expect(verifyForegroundHost).toHaveBeenCalledWith('isolated-test-host')
    expect(f.deps.createHost).not.toHaveBeenCalled()
  })

  it('starts without acquiring an Esc shortcut even if a legacy hook throws', async () => {
    const f = await fixture()
    const acquirePaymentShortcut = vi.fn(() => { throw new Error('DOUDIAN_ESCAPE_UNAVAILABLE') })
    Object.assign(f.deps, { acquirePaymentShortcut })
    const workbookId = await f.choice()
    await f.call({ action: 'preparePayment', workbookId, amount: '1', startRow: '1', maxRows: '0', mode: 'standard' })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect(acquirePaymentShortcut).not.toHaveBeenCalled()
    expect(f.host.request.mock.calls.filter(([method]) => method === 'startPayment')).toHaveLength(1)
  })
  it('rejects a legacy host at initialization even when isolation is advertised', async () => {
    const f = await fixture()
    const original = f.host.request.getMockImplementation()!
    f.host.request.mockImplementation(async (method, args) => method === 'initialize'
      ? { protocol: 1, integration: 'hermes-review-v1', version: '1.0.54', taskIsolation: capability }
      : original(method, args))
    expect(await f.call({ action: 'capabilities' })).toEqual({ ok: false, error: 'DOUDIAN_MODULE_INCOMPATIBLE' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment' || method === 'startPayment')).toBe(false)
  })
  it('rejects obsolete activation requests and never forwards credentials', async () => {
    const f = await fixture()
    expect(await f.call({ action: 'activateLicense', licenseCode: 'SYNTHETIC-123' } as unknown as DoudianRequest))
      .toEqual({ ok: false, error: 'DOUDIAN_INVALID_REQUEST' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'activateLicense')).toBe(false)
    expect(await f.call({ action: 'resumeLicense' } as unknown as DoudianRequest)).toEqual({ ok: false, error: 'DOUDIAN_INVALID_REQUEST' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'resumeLicense')).toBe(false)
  })

  it('rejects obsolete activation even if an old host advertises it', async () => {
    const f = await fixture()
    const original = f.host.request.getMockImplementation()!
    f.host.request.mockImplementation(async (method, args) => {
      if (method === 'capabilities') return { protocol: 1, version: '1.0.54', licenseActivation: 1 }
      if (method === 'activateLicense') throw new Error(`unexpected ${args?.licenseCode}`)
      return original(method, args)
    })
    expect(await f.call({ action: 'activateLicense', licenseCode: 'SYNTHETIC-123' } as unknown as DoudianRequest))
      .toEqual({ ok: false, error: 'DOUDIAN_INVALID_REQUEST' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'activateLicense')).toBe(false)
  })

  it('rejects old modules without enterprise-session mode before preparing payment', async () => {
    const f = await fixture()
    const workbookId = await f.choice()
    const original = f.host.request.getMockImplementation()!
    f.host.request.mockImplementation(async (method, args) => method === 'capabilities'
      ? { protocol: 1, version: '1.0.54', authorized: true }
      : original(method, args))

    expect(await f.call({ action: 'capabilities' })).toMatchObject({ ok: true, capabilities: { authorized: false } })
    expect(await f.call({ action: 'preparePayment', workbookId, amount: '3', startRow: '2', maxRows: '0', mode: 'standard' }))
      .toEqual({ ok: false, error: 'DOUDIAN_MODULE_INCOMPATIBLE' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment')).toBe(false)
    expect(await f.call({ action: 'openPayment' })).toEqual({ ok: false, error: 'DOUDIAN_MODULE_INCOMPATIBLE' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'openPayment')).toBe(false)
  })

  it.each(['standard', 'new-order'] as const)('forwards valid %s parameters and starts exactly once without Esc or grant', async mode => {
    const f = await fixture()
    const workbookId = await f.choice()
    const prepared = await f.call({ action: 'preparePayment', workbookId, amount: '100000', startRow: '2147483647', maxRows: '2147483647', mode })
    expect(prepared).toMatchObject({ ok: true, task: { kind: 'payment', state: 'awaiting_confirmation' } })
    expect(f.host.request).toHaveBeenCalledWith('preparePayment', {
      workbook: f.file, amount: '100000', startRow: '2147483647', maxRows: '2147483647', mode
    })
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(false)
    expect(f.host.request.mock.calls.filter(([method]) => method === 'startPayment')).toHaveLength(1)
    expect(f.deps.authorizePayment).not.toHaveBeenCalled()
  })

  it.each(['pausing', 'paused'])('pauses a running payment and resumes from %s using only taskId', async state => {
    const f = await paymentFixture()
    expect(await f.call({ action: 'capabilities' })).toMatchObject({ ok: true, capabilities: { paymentControls: 1 } })
    expect(await f.call({ action: 'pausePayment', taskId: id('c') })).toMatchObject({ ok: true, task: { kind: 'payment', state: 'pausing' } })
    expect(f.host.request).toHaveBeenCalledWith('pausePayment', { taskId: id('c') })
    f.host.request.mockResolvedValueOnce(result('payment', state))
    expect((await f.call({ action: 'status' })).task?.state).toBe(state)
    expect(await f.call({ action: 'resumePayment', taskId: id('c') })).toMatchObject({ ok: true, task: { kind: 'payment', state: 'running' } })
    expect(f.host.request).toHaveBeenCalledWith('resumePayment', { taskId: id('c') }, expect.objectContaining({ before: expect.any(Function) }))
    expect(f.deps.authorize).toHaveBeenCalledWith('pausePayment')
    expect(f.deps.authorize).toHaveBeenCalledWith('resumePayment')
  })

  it.each(['pausePayment', 'resumePayment'] as const)('rejects %s without exact paymentControls=1 capability', async action => {
    const f = await paymentFixture(action === 'pausePayment' ? 'running' : 'paused')
    for (const marker of [undefined, null, '', '1', 0, 2, true]) {
      f.capabilities.paymentControls = marker
      expect(await f.call({ action, taskId: id('c') })).toEqual({ ok: false, error: 'PAYMENT_CONTROLS_UNSUPPORTED' })
    }
    expect(f.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    expect(f.host.close).not.toHaveBeenCalled()
    expect((await f.call({ action: 'stop', taskId: id('c') })).ok).toBe(true)
  })

  it.each(['pausePayment', 'resumePayment'] as const)('validates %s payload, task ID and payment kind before dispatch', async action => {
    const f = await paymentFixture(action === 'pausePayment' ? 'running' : 'paused')
    for (const fields of [{ taskId: undefined }, { taskId: 'bad' }, { amount: '1' }, { mode: 'standard' }, { workbookId: id('b') }, { shopId: id('b') }]) {
      expect(await f.call({ action, taskId: id('c'), ...fields } as DoudianRequest)).toEqual({ ok: false, error: 'DOUDIAN_INVALID_REQUEST' })
    }
    expect(await f.call({ action, taskId: id('d') })).toEqual({ ok: false, error: 'TASK_NOT_FOUND' })
    expect(f.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    for (const kind of ['review', 'payment-window', 'review-window', 'feige-window']) {
      const other = await fixture(capability, false, result(kind, 'running'))
      expect((await other.call({ action: 'status' })).ok).toBe(true)
      expect(await other.call({ action, taskId: id('c') })).toEqual({ ok: false, error: 'NOT_PAYMENT_TASK' })
      expect(other.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    }
  })

  it.each(['idle', 'preparing', 'awaiting_confirmation', 'pausing', 'paused', 'stopping', 'stopped', 'completed', 'paused_balance', 'paused_review', 'failed'])(
    'rejects pausePayment from %s', async state => {
      const f = await paymentFixture(state)
      expect(await f.call({ action: 'pausePayment', taskId: id('c') })).toEqual({ ok: false, error: 'NOT_RUNNING' })
      expect(f.host.request.mock.calls.some(([method]) => method === 'pausePayment')).toBe(false)
    }
  )

  it.each(['idle', 'preparing', 'awaiting_confirmation', 'running', 'stopping', 'stopped', 'completed', 'paused_balance', 'paused_review', 'failed'])(
    'rejects resumePayment from %s', async state => {
      const f = await paymentFixture(state)
      expect(await f.call({ action: 'resumePayment', taskId: id('c') })).toEqual({ ok: false, error: 'NOT_PAUSED' })
      expect(f.host.request.mock.calls.some(([method]) => method === 'resumePayment')).toBe(false)
    }
  )

  it.each(['pausing', 'paused'])('keeps stop available from %s during an authorization outage', async state => {
    const f = await paymentFixture(state)
    f.capabilities.paymentControls = undefined
    f.deps.authorize.mockRejectedValue(new Error('offline'))
    expect(await f.call({ action: 'stop', taskId: id('d') })).toEqual({ ok: false, error: 'TASK_NOT_FOUND' })
    expect(await f.call({ action: 'stop', taskId: id('c') })).toMatchObject({ ok: true, task: { kind: 'payment', state: 'stopped' } })
    expect(f.host.request.mock.calls.filter(([method]) => method === 'stop')).toEqual([['stop', { taskId: id('c') }]])
    expect(f.deps.authorize).toHaveBeenCalledTimes(1)
  })

  it.each(['preparing', 'awaiting_confirmation', 'running', 'pausing', 'paused', 'stopping'])(
    'keeps a %s task occupied across new tasks, workbook selection and other windows', async state => {
      const f = await paymentFixture(state)
      const requests: Omit<DoudianRequest, 'sessionId'>[] = [
        { action: 'chooseWorkbook' },
        { action: 'prepare', shopId: id('b'), workbookId: id('d') },
        { action: 'preparePayment', workbookId: id('d'), amount: '1', startRow: '1', maxRows: '0', mode: 'standard' },
        { action: 'openPayment' }, { action: 'openReview' }, { action: 'openFeige' }, { action: 'manageShops' },
        { action: 'shopLoginStart', shopId: id('b') }, { action: 'shopCheckStart', shopId: id('b') },
        { action: 'shopManagementDelete', shopId: id('b'), confirmation: id('d') }
      ]
      const calls = f.host.request.mock.calls.length
      for (const request of requests) expect(await f.call(request)).toEqual({ ok: false, error: 'TASK_BUSY' })
      expect(f.host.request.mock.calls).toHaveLength(calls)
      expect(f.deps.chooseWorkbook).not.toHaveBeenCalled()
      expect((await f.call({ action: 'status' })).task).toMatchObject({ taskId: id('c'), kind: 'payment', state })
      expect((await f.call({ action: 'stop', taskId: id('c') })).ok).toBe(true)
      expect((await f.call({ action: 'chooseWorkbook' })).ok).toBe(true)
    }
  )

  it('keeps an unknown payment result occupied until an explicit stop or authoritative status', async () => {
    const f = await paymentFixture()
    f.host.request.mockResolvedValueOnce(result('payment', 'paused_other'))
    expect(await f.call({ action: 'status' })).toEqual({ ok: false, error: 'DOUDIAN_PROTOCOL_ERROR' })
    expect(await f.call({ action: 'openPayment' })).toEqual({ ok: false, error: 'TASK_BUSY' })
    expect((await f.call({ action: 'stop', taskId: id('c') })).ok).toBe(true)
    expect((await f.call({ action: 'openPayment' })).ok).toBe(true)
  })

  it.each(['pausing', 'paused'])('does not let a stale shop operation overwrite a %s payment', async state => {
    const f = await fixture()
    const login = { taskId: id('d'), shopId: id('b'), kind: 'shop-login', state: 'awaiting_confirmation', phase: 'confirm_identity',
      candidate: { name: 'Synthetic shop', platformId: '123' }, bound: { name: null, platformId: null },
      merchantStatus: null, feigeStatus: null, bindingSaved: false, error: null }
    const original = f.host.request.getMockImplementation()!
    f.host.request.mockImplementation(async (method, args, dispatch) => {
      if (method === 'capabilities') return { ...f.capabilities, shopOperations: 1 }
      if (method === 'shopLoginStart') return login
      if (method === 'shopOperationStatus') return { ...login, state: 'completed', phase: 'done' }
      return original(method, args, dispatch)
    })
    expect((await f.call({ action: 'shopLoginStart', shopId: id('b') })).ok).toBe(true)
    expect((await f.call({ action: 'shopOperationStatus', taskId: id('d') })).ok).toBe(true)
    const workbookId = await f.choice()
    expect((await f.call({ action: 'preparePayment', workbookId, amount: '1', startRow: '1', maxRows: '0', mode: 'standard' })).ok).toBe(true)
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(true)
    expect((await f.call({ action: 'pausePayment', taskId: id('c') })).ok).toBe(true)
    f.host.request.mockResolvedValueOnce(result('payment', state))
    expect((await f.call({ action: 'status' })).ok).toBe(true)
    f.host.request.mockClear()
    for (const request of [
      { action: 'shopOperationStatus', taskId: id('d') },
      { action: 'shopLoginConfirm', taskId: id('d'), decision: 'confirm' },
      { action: 'shopLoginFinishFeige', taskId: id('d') },
      { action: 'shopOperationCancel', taskId: id('d') }
    ] as const) expect(await f.call(request)).toEqual({ ok: false, error: 'TASK_NOT_FOUND' })
    expect(f.host.request.mock.calls.some(([method]) => method.startsWith('shop'))).toBe(false)
    expect((await f.call({ action: 'status' })).task).toMatchObject({ taskId: id('c'), kind: 'payment' })
  })

  it.each(['pausePayment', 'resumePayment'] as const)('closes and blocks %s after tenant or session changes', async action => {
    for (const boundary of ['tenant', 'session']) {
      const f = await paymentFixture(action === 'pausePayment' ? 'running' : 'paused')
      if (boundary === 'tenant') f.deps.authorize.mockResolvedValue(id('b') + id('b'))
      else f.deps.isCurrent.mockReturnValue(false)
      expect(await f.call({ action, taskId: id('c') })).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
      expect(f.host.close).toHaveBeenCalled()
      expect(f.host.request.mock.calls.some(([method]) => method === action)).toBe(false)
    }
  })

  it.each(['pausePayment', 'resumePayment'] as const)('rejects mismatched or unknown %s replies', async action => {
    for (const reply of [result('review', 'running'), result('payment', 'paused', id('d')), result('payment', 'paused_other')]) {
      const f = await paymentFixture(action === 'pausePayment' ? 'running' : 'paused')
      const original = f.host.request.getMockImplementation()!
      f.host.request.mockImplementation(async (method, args, dispatch) => method === action ? reply : original(method, args, dispatch))
      expect(await f.call({ action, taskId: id('c') })).toEqual({ ok: false, error: 'DOUDIAN_PROTOCOL_ERROR' })
      expect((await f.call({ action, taskId: id('c') })).ok).toBe(false)
      expect(f.host.request.mock.calls.filter(([method]) => method === action)).toHaveLength(1)
    }
  })

  it.each(['startPayment', 'resumePayment'] as const)('fences %s immediately before dispatch after foreground setup', async action => {
    const f = await paymentFixture(action === 'startPayment' ? 'awaiting_confirmation' : 'paused')
    const original = f.host.request.getMockImplementation()!
    let send!: () => void
    const sent = vi.fn()
    f.host.request.mockImplementation(async (method, args, dispatch) => {
      if (method !== action) return original(method, args, dispatch)
      await new Promise<void>(resolve => { send = resolve })
      dispatch!.before()
      sent()
      return result('payment', 'running')
    })
    const pending = f.call({ action, taskId: id('c') })
    await vi.waitFor(() => expect(send).toBeTypeOf('function'))
    f.deps.isCurrent.mockReturnValue(false)
    send()
    expect(await pending).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(sent).not.toHaveBeenCalled()
    expect(f.host.close).toHaveBeenCalled()
  })

  it('rejects using a review task ID to start payment or an old ID to start review', async () => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect((await f.call({ action: 'prepare', workbookId, shopId: id('b') })).ok).toBe(true)
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(false)
    expect((await f.call({ action: 'start', taskId: id('d') })).ok).toBe(false)
    expect(f.host.request.mock.calls.filter(([method]) => method === 'startPayment' || method === 'start')).toHaveLength(0)
    expect((await f.call({ action: 'start', taskId: id('c') })).ok).toBe(true)
  })

  it('closes a host that reports a different task type during status', async () => {
    const f = await fixture()
    const workbookId = await f.choice()
    expect((await f.call({ action: 'prepare', workbookId, shopId: id('b') })).ok).toBe(true)
    f.host.request.mockResolvedValueOnce(result('payment', 'awaiting_confirmation'))
    expect(await f.call({ action: 'status' })).toEqual({ ok: false, error: 'DOUDIAN_PROTOCOL_ERROR' })
    expect(f.host.close).toHaveBeenCalled()
    expect((await f.call({ action: 'startPayment', taskId: id('c') })).ok).toBe(false)
    expect(f.host.request.mock.calls.some(([method]) => method === 'startPayment')).toBe(false)
  })

  it.each([undefined, null, '', 'hermes-task-isolation-v0', 'wrong'])('rejects an incompatible host (%s) before payment', async marker => {
    const f = await fixture(marker, marker === undefined)
    const reply = await f.call({ action: 'openPayment' })
    expect(reply).toMatchObject({ ok: false, error: 'DOUDIAN_MODULE_INCOMPATIBLE' })
    expect(f.host.request.mock.calls.some(([method]) => method === 'openPayment' || method === 'preparePayment')).toBe(false)
    expect(f.host.close).toHaveBeenCalled()
  })

  it.each([
    { amount: '0', startRow: '1', maxRows: '0', mode: 'standard' },
    { amount: '100000.01', startRow: '1', maxRows: '0', mode: 'standard' },
    { amount: '0.00000000000000000000000000005', startRow: '1', maxRows: '0', mode: 'standard' },
    { amount: '-1', startRow: '1', maxRows: '0', mode: 'standard' },
    { amount: '1', startRow: '0', maxRows: '0', mode: 'standard' },
    { amount: '1', startRow: '2147483648', maxRows: '0', mode: 'standard' },
    { amount: '1', startRow: '1', maxRows: '2147483648', mode: 'standard' },
    { amount: '1', startRow: '1', maxRows: '0', mode: 'unknown' },
    { amount: 1, startRow: '1', maxRows: '0', mode: 'standard' }
  ])('rejects invalid payment parameters before dispatch: %j', async values => {
    const f = await fixture()
    const workbookId = await f.choice()
    const reply = await f.call({ action: 'preparePayment', workbookId, ...values } as DoudianRequest)
    expect(reply.ok).toBe(false)
    expect(f.host.request.mock.calls.some(([method]) => method === 'preparePayment')).toBe(false)
  })

  it.each(['.5', '1,000.00', '1+', '100000.000000000000000000000001', '0.00000000000000000000000000006'])(
    'accepts TD Decimal.TryParse-compatible positive amount %s without changing it', async amount => {
      const f = await fixture()
      const workbookId = await f.choice()
      const reply = await f.call({ action: 'preparePayment', workbookId, amount, startRow: '1', maxRows: '0', mode: 'standard' })
      expect(reply.ok).toBe(true)
      expect(f.host.request).toHaveBeenCalledWith('preparePayment', expect.objectContaining({ amount }))
    }
  )

  it('opens the original payment window without invoking a grant but still requires the tenant session', async () => {
    const f = await fixture()
    expect((await f.call({ action: 'openPayment' })).ok).toBe(true)
    expect(f.deps.authorize).toHaveBeenCalled()
    expect(f.deps.authorizePayment).not.toHaveBeenCalled()
    f.deps.isCurrent.mockReturnValue(false)
    expect(await f.call({ action: 'openPayment' })).toMatchObject({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(f.host.close).toHaveBeenCalled()
  })
})
