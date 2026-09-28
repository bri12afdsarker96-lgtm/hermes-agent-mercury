import { describe, expect, it } from 'vitest'

import { connectionRecoveryDelay, isTransientConnectionFailure } from './connection-recovery'
import { enterpriseClientErrorForStatus, enterpriseNetworkError } from './runtime-errors'

describe('enterprise connection recovery policy', () => {
  it('uses a capped backoff for temporary service recovery', () => {
    expect(connectionRecoveryDelay(1)).toBe(1_000)
    expect(connectionRecoveryDelay(4)).toBe(8_000)
    expect(connectionRecoveryDelay(999)).toBe(30_000)
  })

  it('retries only transport and upstream failures', () => {
    expect(isTransientConnectionFailure(enterpriseNetworkError())).toBe(true)
    expect(isTransientConnectionFailure(enterpriseClientErrorForStatus(503))).toBe(true)
    expect(isTransientConnectionFailure(enterpriseClientErrorForStatus(401))).toBe(false)
    expect(isTransientConnectionFailure(enterpriseClientErrorForStatus(403))).toBe(false)
    expect(isTransientConnectionFailure(enterpriseClientErrorForStatus(429))).toBe(false)
  })
})
