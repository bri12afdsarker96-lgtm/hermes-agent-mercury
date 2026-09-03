import { describe, expect, it, vi } from 'vitest'

import { reconcileAfterConflict } from './authority-reconciliation'
import { enterpriseClientErrorForStatus, enterpriseNetworkError } from './runtime-errors'

describe('reconcileAfterConflict', () => {
  it('refreshes the authority projection after an explicit 409', async () => {
    const refresh = vi.fn(async () => undefined)

    await expect(reconcileAfterConflict(enterpriseClientErrorForStatus(409), refresh)).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each([
    enterpriseClientErrorForStatus(401),
    enterpriseClientErrorForStatus(403),
    enterpriseClientErrorForStatus(404),
    enterpriseClientErrorForStatus(503),
    enterpriseNetworkError()
  ])('does not refresh for a non-conflict failure', async reason => {
    const refresh = vi.fn(async () => undefined)

    await expect(reconcileAfterConflict(reason, refresh)).resolves.toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})
