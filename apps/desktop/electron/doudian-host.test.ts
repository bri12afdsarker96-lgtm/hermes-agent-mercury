import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { assertDoudianCapability, DoudianController, doudianScope, verifiedDoudianExecutable } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function temp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-doudian-test-'))
  roots.push(root)

  return root
}

const taskId = 'c'.repeat(32)

it('enforces server capabilities for each IPC operation', () => {
  const reviewOnly = { product_capabilities: { doudian_review: { enabled: true, status: 'LIVE' } } }
  const paymentOnly = { product_capabilities: { doudian_payment: { enabled: true, status: 'LIVE' } } }
  expect(() => assertDoudianCapability(reviewOnly, 'openReview')).not.toThrow()
  expect(() => assertDoudianCapability(reviewOnly, 'startPayment')).toThrow('DOUDIAN_FORBIDDEN')
  expect(() => assertDoudianCapability(paymentOnly, 'openPayment')).not.toThrow()
  expect(() => assertDoudianCapability(paymentOnly, 'prepare')).toThrow('DOUDIAN_FORBIDDEN')
  expect(() => assertDoudianCapability({}, 'capabilities')).toThrow('DOUDIAN_FORBIDDEN')
  expect(() => assertDoudianCapability({ product_capabilities: { doudian_payment: { enabled: true, status: 'DISABLED' } } }, 'openPayment')).toThrow('DOUDIAN_FORBIDDEN')
  expect(() => assertDoudianCapability(reviewOnly, 'openFeige')).toThrow('DOUDIAN_FORBIDDEN')
})

function fixture() {
  let state = 'idle'

  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'initialize') {
        return { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1' }
      }

      if (method === 'capabilities') {
        return { protocol: 1, version: '1.0.54', authorized: true, chrome: true, spreadsheet: true }
      }

      if (method === 'prepare') {
        state = 'awaiting_confirmation'
      }

      if (method === 'start') {
        state = 'running'
      }

      if (method === 'stop') {
        state = 'stopping'
      }

      return {
        taskId: state === 'idle' ? null : taskId,
        kind: 'review',
        state,
        saved: 0,
        summary: 'synthetic',
        error: '',
        messages: []
      }
    })
  }

  const deps = {
    platform: process.platform,
    root: '',
    authorize: vi.fn(async () => 'a'.repeat(64)),
    isCurrent: vi.fn(() => true),
    chooseWorkbook: vi.fn(async (): Promise<string | null> => null),
    verify: vi.fn(async () => 'fixed-executable'),
    createHost: vi.fn(() => host)
  }

  const controller = new DoudianController(deps)

  const call = (action: DoudianRequest['action'], fields: Partial<DoudianRequest> = {}) =>
    controller.operate({ sessionId: 'seat-session', action, ...fields })

  return { controller, call, deps, host }
}

describe('authority and private runtime', () => {
  it('scopes by service origin, tenant and principal, never by a shop display name', () => {
    const me = { role: 'operator', tenant_id: 'tenant-one', principal_id: 'seat-one' }
    const value = doudianScope('https://example.test', me)
    expect(value).toMatch(/^[a-f0-9]{64}$/)
    expect(doudianScope('https://example.test', { ...me, tenant_id: 'tenant-two' })).not.toBe(value)
    expect(doudianScope('https://example.test', { ...me, principal_id: 'seat-two' })).not.toBe(value)
    expect(doudianScope('https://another.test', me)).not.toBe(value)

    for (const identity of [
      { ...me, role: 'super_admin' },
      { ...me, tenant_id: '' },
      { ...me, principal_id: '' },
      { ...me, must_change_password: true }
    ]) {
      expect(() => doudianScope('https://example.test', identity)).toThrow('DOUDIAN_FORBIDDEN')
    }
  })
  it.runIf(process.platform === 'win32')('rejects unauthorized calls before starting a child', async () => {
    const f = fixture()
    f.deps.authorize.mockRejectedValue(new Error('DOUDIAN_FORBIDDEN'))
    expect(await f.call('capabilities')).toEqual({ ok: false, error: 'DOUDIAN_FORBIDDEN' })
    expect(f.deps.createHost).not.toHaveBeenCalled()
  })
  it.runIf(process.platform !== 'win32')('does not launch a Windows child on unsupported hosts', async () => {
    const f = fixture()
    expect((await f.call('capabilities')).error).toBe('DOUDIAN_WINDOWS_REQUIRED')
    expect(f.deps.createHost).not.toHaveBeenCalled()
  })
  it('verifies the full staged module and rejects tampering and extra files', async () => {
    const root = await temp(),
      name = '外呼订单自动化.exe'

    const bytes = Buffer.from('synthetic executable, not run')
    await fs.writeFile(path.join(root, name), bytes)
    await fs.writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        protocol: 1,
        version: '1.0.54',
        integration: 'hermes-review-v1',
        files: { [name]: createHash('sha256').update(bytes).digest('hex') }
      })
    )
    expect(await verifiedDoudianExecutable(root)).toBe(path.join(root, name))
    await fs.writeFile(path.join(root, 'untracked.dll'), 'extra')
    await expect(verifiedDoudianExecutable(root)).rejects.toThrow('DOUDIAN_MODULE_INVALID')
    await fs.unlink(path.join(root, 'untracked.dll'))
    await fs.writeFile(path.join(root, name), 'modified')
    await expect(verifiedDoudianExecutable(root)).rejects.toThrow('DOUDIAN_MODULE_INVALID')
  })
})

describe.runIf(process.platform === 'win32')('Windows controller flow (synthetic capture, no shop or COM)', () => {
  it('negotiates review options through the real controller and rejects unsupported or invalid requests', async () => {
    const f = fixture(), root = await temp(), file = path.join(root, 'copy.xlsx')
    await fs.writeFile(file, 'synthetic')
    f.deps.chooseWorkbook.mockResolvedValue(file)
    const workbookId = (await f.call('chooseWorkbook')).workbook!.id
    const shopId = 'b'.repeat(32)
    const original = f.host.request.getMockImplementation()!
    let marker: unknown = 1
    f.host.request.mockImplementation(async (method: string) => method === 'capabilities'
      ? { protocol: 1, version: '1.0.54', reviewOptions: marker }
      : original(method))
    const opts = { workbookId, shopId, startRow: '7', maxRows: '13', concurrency: '4' }
    for (const value of [undefined, null, '1', 0, 2]) {
      marker = value
      expect(await f.call('prepare', opts)).toEqual({ ok: false, error: 'REVIEW_OPTIONS_UNSUPPORTED' })
    }
    expect(f.host.request.mock.calls.filter(([method]) => method === 'prepare')).toHaveLength(0)
    for (const invalid of [{ startRow: '0' }, { maxRows: '1000001' }, { concurrency: '3' }, { startRow: '1.5' }]) {
      expect((await f.call('prepare', { ...opts, ...invalid })).ok).toBe(false)
    }
    expect(f.host.request.mock.calls.filter(([method]) => method === 'prepare')).toHaveLength(0)
    marker = 1
    expect((await f.call('prepare', opts)).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('prepare', { shopId, workbook: file, startRow: '7', maxRows: '13', concurrency: '4' })
  })
  it('keeps old prepare calls without options compatible with an old host', async () => {
    const f = fixture(), root = await temp(), file = path.join(root, 'copy.xlsx')
    await fs.writeFile(file, 'synthetic')
    f.deps.chooseWorkbook.mockResolvedValue(file)
    const workbookId = (await f.call('chooseWorkbook')).workbook!.id
    const shopId = 'b'.repeat(32)
    expect((await f.call('prepare', { workbookId, shopId })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('prepare', { shopId, workbook: file })
    expect(f.host.request.mock.calls.filter(([method]) => method === 'capabilities')).toHaveLength(0)
  })
  it('accepts only a native-selected workbook and separates prepare from start', async () => {
    const f = fixture(),
      root = await temp(),
      file = path.join(root, 'copy.xlsx')

    await fs.writeFile(file, 'synthetic')
    f.deps.chooseWorkbook.mockResolvedValue(file)
    const choice = await f.call('chooseWorkbook')
    expect(choice.workbook?.name).toBe('copy.xlsx')
    expect(JSON.stringify(choice)).not.toContain(root)
    expect((await f.call('prepare', { workbookId: 'a'.repeat(32), shopId: 'b'.repeat(32) })).error).toBe(
      'INVALID_WORKBOOK'
    )
    const prepared = await f.call('prepare', { workbookId: choice.workbook!.id, shopId: 'b'.repeat(32) })
    expect(prepared.task?.state).toBe('awaiting_confirmation')
    expect(f.host.request.mock.calls.some(([method]) => method === 'start')).toBe(false)
    expect((await f.call('start', { taskId: 'd'.repeat(32) })).error).toBe('TASK_NOT_FOUND')
    expect((await f.call('start', { taskId })).task?.state).toBe('running')
    expect((await f.call('status')).task?.saved).toBe(0)
    f.deps.authorize.mockRejectedValue(new Error('offline'))
    expect((await f.call('stop', { taskId })).task?.state).toBe('stopping')
  })
  it('rejects renderer commands, file paths and prototype methods', async () => {
    const f = fixture()

    for (const action of ['payment', 'toString', '__proto__', 'constructor']) {
      expect((await f.call(action as DoudianRequest['action'])).error).toBe('DOUDIAN_INVALID_REQUEST')
    }

    expect(
      (
        await f.controller.operate({
          sessionId: 'x',
          action: 'capabilities',
          executable: 'evil'
        } as unknown as DoudianRequest)
      ).error
    ).toBe('DOUDIAN_INVALID_REQUEST')
    expect(f.deps.createHost).not.toHaveBeenCalled()
  })
  it('does not reuse a host after the authoritative tenant changes', async () => {
    const f = fixture()
    await f.call('capabilities')
    f.deps.authorize.mockResolvedValue('b'.repeat(64))
    expect((await f.call('status')).error).toBe('DOUDIAN_OWNER_CHANGED')
    expect(f.host.close).toHaveBeenCalled()
    expect(f.deps.createHost).toHaveBeenCalledTimes(1)
  })
  it('discards a late response after logout and asks the host to drain', async () => {
    const f = fixture()
    await f.call('capabilities')
    let finish!: (value: any) => void
    f.host.request.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = f.call('status')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.deps.isCurrent.mockReturnValue(false)
    finish({ taskId, state: 'completed', saved: 10, messages: [], summary: '', error: '' })
    expect((await pending).error).toBe('DOUDIAN_OWNER_CHANGED')
    expect(f.host.close).toHaveBeenCalled()
  })
  it('does not restart or fabricate completion when a child exits', async () => {
    const f = fixture()
    await f.call('capabilities')
    f.host.request.mockRejectedValueOnce(new Error('DOUDIAN_HOST_LOST'))
    expect(await f.call('status')).toEqual({ ok: false, error: 'DOUDIAN_HOST_LOST' })
    expect((await f.call('status')).ok).toBe(false)
    expect(f.deps.createHost).toHaveBeenCalledTimes(1)
  })
  it('rejects a concurrent native operation rather than double-starting', async () => {
    const f = fixture()
    await f.call('capabilities')
    let finish!: (value: any) => void
    f.host.request.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const first = f.call('manageShops')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect((await f.call('manageShops')).error).toBe('TASK_BUSY')
    finish({ closed: true })
    expect((await first).ok).toBe(true)
  })
})
