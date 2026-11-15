import { expect, it, vi } from 'vitest'
import { DoudianController, allowForegroundLocalDoudian } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

it('fails every TD operation closed in local verification before any external effects', async () => {
  const deps = {
    platform: 'win32', root: 'unused', localVerification: true,
    isCurrent: vi.fn(() => true),
    authorize: vi.fn(async () => 'fixture'),
    chooseWorkbook: vi.fn(async () => null),
    verify: vi.fn(async () => 'unused'),
    createHost: vi.fn(() => ({ request: vi.fn(), close: vi.fn() }))
  }
  const controller = new DoudianController(deps)
  const actions: DoudianRequest['action'][] = [
    'capabilities', 'openPayment', 'openReview', 'openFeige', 'shops', 'manageShops',
    'chooseWorkbook', 'prepare', 'preparePayment', 'start', 'startPayment', 'pausePayment', 'resumePayment', 'status', 'stop',
    'shopManagementList', 'shopManagementAdd', 'shopManagementRename', 'shopManagementPin', 'shopManagementMove', 'shopManagementPrepareDelete', 'shopManagementDelete',
    'shopLoginStart', 'shopCheckStart', 'shopOperationStatus', 'shopLoginConfirm', 'shopLoginFinishFeige', 'shopOperationCancel'
  ]
  for (const action of actions) {
    expect(await controller.operate({ sessionId: 'fixture', action } as DoudianRequest))
      .toEqual({ ok: false, error: 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' })
  }
  expect(deps.isCurrent).not.toHaveBeenCalled()
  expect(deps.authorize).not.toHaveBeenCalled()
  expect(deps.chooseWorkbook).not.toHaveBeenCalled()
  expect(deps.verify).not.toHaveBeenCalled()
  expect(deps.createHost).not.toHaveBeenCalled()
})

it('permits foreground TD only for an explicitly opted-in unpackaged local session', () => {
  expect(allowForegroundLocalDoudian(false, true, '1')).toBe(true)
  expect(allowForegroundLocalDoudian(true, true, '1')).toBe(false)
  expect(allowForegroundLocalDoudian(false, false, '1')).toBe(false)
  expect(allowForegroundLocalDoudian(false, true, undefined)).toBe(false)
  expect(allowForegroundLocalDoudian(false, true, 'true')).toBe(false)
})

it('retains identity, asset and host protocol checks for opted-in foreground tests', async () => {
  const request = vi.fn(async (action: string) => action === 'initialize'
    ? { protocol: 1, integration: 'hermes-review-v1', version: '1.0.54', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1' }
    : { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1' })
  const deps = {
    platform: 'win32', root: 'verified-root', localVerification: true, localForeground: true,
    isCurrent: vi.fn(() => true), authorize: vi.fn(async () => 'a'.repeat(64)),
    chooseWorkbook: vi.fn(async () => null), verify: vi.fn(async () => 'verified-exe'),
    verifyForegroundHost: vi.fn(async () => true),
    createHost: vi.fn(() => ({ request, close: vi.fn() }))
  }
  const controller = new DoudianController(deps)
  const result = await controller.operate({ sessionId: 'fixture', action: 'capabilities' } as DoudianRequest)
  expect(result.ok).toBe(true)
  expect(deps.authorize).toHaveBeenCalledOnce()
  expect(deps.verify).toHaveBeenCalledWith('verified-root')
  expect(deps.verifyForegroundHost).toHaveBeenCalledWith('verified-exe')
  expect(request).toHaveBeenCalledWith('initialize', { scope: 'a'.repeat(64) })
  deps.isCurrent.mockReturnValue(false)
  expect((await controller.operate({ sessionId: 'fixture', action: 'capabilities' } as DoudianRequest)).error).toBe('DOUDIAN_OWNER_CHANGED')
})

it('refuses a foreground host that lacks the confirmation-stop guard', async () => {
  const createHost = vi.fn()
  const controller = new DoudianController({ platform: 'win32', root: 'fixture', localVerification: true, localForeground: true,
    isCurrent: () => true, authorize: async () => 'a'.repeat(64), chooseWorkbook: async () => null,
    verify: async () => 'unguarded-exe', verifyForegroundHost: async () => false, createHost })
  expect((await controller.operate({ sessionId: 'fixture', action: 'capabilities' } as DoudianRequest)).error).toBe('DOUDIAN_TEST_HOST_UNSAFE')
  expect(createHost).not.toHaveBeenCalled()
})
