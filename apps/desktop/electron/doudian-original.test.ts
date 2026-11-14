import { describe, expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
import type { DoudianAction } from './doudian-types'

function fixture(available = true) {
  const request = vi.fn(async (method: string) =>
    method === 'initialize'
      ? { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1' }
      : method === 'capabilities'
        ? {
            protocol: 1,
            version: '1.0.54',
            reviewUi: available ? 1 : 0,
            feigeUi: available ? 1 : 0,
            paymentUi: 1,
            authorized: true,
            authorizationMode: 'enterprise-session-v1'
          }
        : {
            kind: method === 'openReview' ? 'review-window' : 'feige-window',
            taskId: 'a'.repeat(32),
            state: 'running',
            saved: 0,
            summary: '',
            error: '',
            messages: []
          }
  )
  const deps = {
    platform: 'win32',
    root: 'test-only',
    authorize: vi.fn(async () => 'b'.repeat(64)),
    authorizePayment: vi.fn(async () => {
      throw new Error('PAYMENT_AUTHORIZATION_REQUIRED')
    }),
    isCurrent: vi.fn(() => true),
    chooseWorkbook: vi.fn(async () => null),
    verify: vi.fn(async () => 'verified-test-only'),
    createHost: () => ({ request, close: vi.fn() })
  }
  const controller = new DoudianController(deps)
  const call = (action: DoudianAction) => controller.operate({ sessionId: 'test-only', action })
  return { deps, request, controller, call }
}
describe('original feature dispatch', () => {
  it.each(['openReview', 'openFeige'] as const)(
    '%s is fenced and never invokes the payment authority or execution',
    async action => {
      const f = fixture()
      expect((await f.call(action)).ok).toBe(true)
      expect(f.deps.authorize).toHaveBeenCalledTimes(1)
      expect(f.deps.authorizePayment).not.toHaveBeenCalled()
      expect(f.request.mock.calls.map(([m]) => m)).toEqual(['initialize', 'capabilities', action])
    }
  )
  it.each(['openReview', 'openFeige'] as const)('%s fails closed with an older host', async action => {
    const f = fixture(false)
    expect(await f.call(action)).toEqual({ ok: false, error: 'DOUDIAN_MODULE_MISSING' })
    expect(f.request.mock.calls.some(([m]) => m === action)).toBe(false)
  })
  it('a review launch cannot make payment cross a changed tenant, with no grant request', async () => {
    const f = fixture()
    await f.call('openReview')
    f.deps.authorize.mockResolvedValue('c'.repeat(64))
    expect(await f.call('openPayment')).toEqual({ ok: false, error: 'DOUDIAN_OWNER_CHANGED' })
    expect(f.request.mock.calls.some(([m]) => m === 'openPayment')).toBe(false)
    expect(f.deps.authorizePayment).not.toHaveBeenCalled()
  })
  it('rejects hidden startup commands or caller-supplied executables', async () => {
    const f = fixture()
    expect(
      (await f.controller.operate({ sessionId: 'test-only', action: 'openFeige', shopId: 'a'.repeat(32) })).error
    ).toBe('DOUDIAN_INVALID_REQUEST')
    expect(f.request).not.toHaveBeenCalled()
  })
})
