import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { DoudianController, DoudianHost } from './doudian-host'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

function fixture(paymentUi = 1) {
  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string) => {
      if (method === 'initialize') return { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1' }
      if (method === 'capabilities') return { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1', paymentUi }
      return { taskId: 'a'.repeat(32), kind: 'payment-window', state: 'running', saved: 0, summary: '', error: '', messages: [] }
    })
  }
  const deps = {
    platform: 'win32', root: '', isCurrent: vi.fn(() => true),
    authorize: vi.fn(async () => 'a'.repeat(64)),
    authorizePayment: vi.fn(async (_amount?: string) => { throw new Error('obsolete grant request') }),
    chooseWorkbook: async () => null, verify: async () => 'test-executable',
    createHost: vi.fn(() => host)
  }
  return { host, deps, controller: new DoudianController(deps) }
}

describe('original payment session and tenant authority', () => {
  it.each(['pausing', 'paused', 'paused_balance', 'paused_review', 'stopped', 'completed'])(
    'passes payment-window status %s and does not start it', async state => {
      const { controller, host } = fixture()
      await controller.operate({ sessionId: 'test', action: 'openPayment' })
      const original = host.request.getMockImplementation()!
      host.request.mockImplementation(async method => method === 'status'
        ? { taskId: 'a'.repeat(32), kind: 'payment-window', state, saved: 1, summary: '', error: '', messages: [] }
        : original(method))
      expect(await controller.operate({ sessionId: 'test', action: 'status' })).toMatchObject({ ok: true, task: { state } })
      expect(await controller.operate({ sessionId: 'test', action: 'startPayment', taskId: 'a'.repeat(32) })).toEqual({ ok: false, error: 'NOT_PREPARED' })
      expect(host.request.mock.calls.some(([method]) => method === 'startPayment')).toBe(false)
    }
  )
  it.each(['pausing', 'paused', 'paused_balance', 'paused_review'])(
    'accepts %s only for payment kinds', async state => {
      for (const kind of ['payment', 'review']) {
        const { controller, host } = fixture()
        const original = host.request.getMockImplementation()!
        host.request.mockImplementation(async method => method === 'status'
          ? { taskId: 'a'.repeat(32), kind, state, saved: 0, summary: '', error: '', messages: [] }
          : original(method))
        const result = await controller.operate({ sessionId: 'test', action: 'status' })
        expect(result).toMatchObject(kind === 'payment' ? { ok: true, task: { state } } : { ok: false, error: 'DOUDIAN_PROTOCOL_ERROR' })
      }
    }
  )
  it('rejects unknown future states', async () => {
    const { controller, host } = fixture()
    const original = host.request.getMockImplementation()!
    let state = 'awaiting_confirmation'
    host.request.mockImplementation(async method => method === 'status'
      ? { taskId: 'a'.repeat(32), kind: 'payment', state, saved: 0, summary: '', error: '', messages: [] }
      : original(method))
    expect((await controller.operate({ sessionId: 'test', action: 'status' })).ok).toBe(true)
    state = 'paused_other'
    expect(await controller.operate({ sessionId: 'test', action: 'status' })).toEqual({ ok: false, error: 'DOUDIAN_PROTOCOL_ERROR' })
    expect(await controller.operate({ sessionId: 'test', action: 'startPayment', taskId: 'a'.repeat(32) })).toEqual({ ok: false, error: 'NOT_PREPARED' })
    expect(host.request.mock.calls.some(([method]) => method === 'startPayment')).toBe(false)
  })
  it.each(['none', 'pending', 'rejected', 'approved', 'revoked', 'expired', 'unavailable'])(
    'does not request obsolete grant state %s when opening the original window', async _state => {
      const { controller, deps, host } = fixture()
      expect(await controller.operate({ sessionId: 'test', action: 'openPayment' })).toMatchObject({
        ok: true, task: { kind: 'payment-window', state: 'running' }
      })
      expect(deps.authorize).toHaveBeenCalledTimes(1)
      expect(deps.authorizePayment).not.toHaveBeenCalled()
      expect(host.request.mock.calls.map(([method]) => method)).toEqual(['initialize', 'capabilities', 'openPayment'])
    }
  )
  it.each(['DOUDIAN_FORBIDDEN', 'DOUDIAN_OWNER_CHANGED', 'offline'])(
    'does not start a host when enterprise identity verification fails: %s', async failure => {
      const { controller, deps } = fixture()
      deps.authorize.mockRejectedValue(new Error(failure))
      expect((await controller.operate({ sessionId: 'test', action: 'openPayment' })).ok).toBe(false)
      expect(deps.createHost).not.toHaveBeenCalled()
      expect(deps.authorizePayment).not.toHaveBeenCalled()
    }
  )
  it('rejects a module without the original payment window', async () => {
    const { controller, host } = fixture(0)
    expect(await controller.operate({ sessionId: 'test', action: 'openPayment' })).toEqual({ ok: false, error: 'PAYMENT_MODULE_MISSING' })
    expect(host.request.mock.calls.some(([method]) => method === 'openPayment')).toBe(false)
  })
  it('closes the host and blocks the next call after the tenant changes', async () => {
    const { controller, deps, host } = fixture()
    await controller.operate({ sessionId: 'test', action: 'openPayment' })
    deps.authorize.mockResolvedValue('b'.repeat(64))
    expect(await controller.operate({ sessionId: 'test', action: 'openPayment' })).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(host.close).toHaveBeenCalled()
    expect(host.request.mock.calls.filter(([method]) => method === 'openPayment')).toHaveLength(1)
    expect(deps.authorizePayment).not.toHaveBeenCalled()
  })
  it('closes the host and blocks a stale session after logout', async () => {
    const { controller, deps, host } = fixture()
    await controller.operate({ sessionId: 'test', action: 'openPayment' })
    deps.isCurrent.mockReturnValue(false)
    expect(await controller.operate({ sessionId: 'test', action: 'openPayment' })).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(host.close).toHaveBeenCalled()
    expect(deps.authorizePayment).not.toHaveBeenCalled()
  })
  it.each([true, false])('refuses legacy paymentAuthorization events without replying, allowed=%s', async allowed => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    spawn.mockReturnValue(child)
    const messages: string[] = []
    child.stdin.on('data', value => messages.push(value.toString()))
    const host = new DoudianHost('verified-test-executable')
    child.stdout.write(JSON.stringify({ event: 'paymentAuthorization', authorizationId: 'a'.repeat(32), amount: '3.00', allowed }) + '\n')
    await vi.waitFor(() => expect(child.stdin.writableEnded).toBe(true))
    expect(messages).toHaveLength(0)
    expect(child.kill).toHaveBeenCalledOnce()
    await expect(host.request('status')).rejects.toThrow('DOUDIAN_HOST_LOST')
  })
})
