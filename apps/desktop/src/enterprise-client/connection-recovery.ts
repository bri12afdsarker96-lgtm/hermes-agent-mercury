import { EnterpriseClientError } from './runtime-errors'

const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

/**
 * Recovery remains bounded and intentionally slow enough not to turn a short
 * upstream outage into a request storm. Callers reset the attempt after the
 * next successful authoritative read.
 */
export function connectionRecoveryDelay(attempt: number): number {
  const index = Math.max(0, Math.min(RECOVERY_DELAYS_MS.length - 1, Math.floor(attempt) - 1))

  return RECOVERY_DELAYS_MS[index]
}

/** Only transport and upstream availability failures are safe to auto-retry. */
export function isTransientConnectionFailure(reason: unknown): boolean {
  return reason instanceof EnterpriseClientError && (
    reason.kind === 'network' ||
    reason.kind === 'authority_unavailable' ||
    reason.status >= 500
  )
}
