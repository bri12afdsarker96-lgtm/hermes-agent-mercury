import { describe, expect, it } from 'vitest'

import { enterpriseClientErrorForStatus, enterpriseNetworkError } from './runtime-errors'
import { enterpriseSessionDisposition } from './session-policy'

describe('enterprise session disposition', () => {
  it('releases an opaque session and clears identity only after 401', () => {
    expect(enterpriseSessionDisposition(enterpriseClientErrorForStatus(401))).toBe('release-and-clear')
  })

  it.each([403, 404, 409, 503])('retains a session for a non-auth HTTP %i outcome', status => {
    expect(enterpriseSessionDisposition(enterpriseClientErrorForStatus(status))).toBe('retain-and-reconcile')
  })

  it('retains a session for a bridge network failure', () => {
    expect(enterpriseSessionDisposition(enterpriseNetworkError())).toBe('retain-and-reconcile')
  })
})
