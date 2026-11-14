import { expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
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
    'chooseWorkbook', 'prepare', 'preparePayment', 'start', 'startPayment', 'status', 'stop', 'activateLicense', 'licenseStatus'
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
