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

async function fixture(isolation: unknown = capability, omitMarker = false) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-td-contract-'))
  folders.push(folder)
  const file = path.join(folder, 'synthetic.xlsx')
  await fs.writeFile(file, 'fixture')
  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string, _args?: Record<string, string>): Promise<unknown> => {
      if (method === 'initialize') return { protocol: 1, integration: 'hermes-review-v1', version: '1.0.54', ...(omitMarker ? {} : { taskIsolation: isolation }) }
      if (method === 'capabilities') return { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1', paymentUi: 1, reviewUi: 1, feigeUi: 1, taskIsolation: isolation }
      if (method === 'prepare') return result('review', 'awaiting_confirmation')
      if (method === 'preparePayment') return result('payment', 'awaiting_confirmation')
      if (method === 'start') return result('review', 'running')
      if (method === 'startPayment') return result('payment', 'running')
      if (method === 'openPayment') return result('payment-window', 'running')
      if (method === 'stop') return result('payment', 'stopped')
      return result('review', 'idle', '')
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
  return { controller, deps, host, call, choice, file }
}

describe('fixed TD payment bridge contract', () => {
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

  it.each(['standard', 'new-order'] as const)('forwards valid %s parameters and starts exactly once without grant', async mode => {
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
