/**
 * A retained opaque session is not proof that its previous server projection is
 * still current. Keep the runtime for recovery, but render identity and
 * authority data only after the latest authority probe completes.
 */
export type EnterpriseConnectionState = 'error' | 'loading' | 'ready' | 'unavailable'

export function currentAuthoritySnapshot<T>(
  snapshot: T | null,
  connectionState: EnterpriseConnectionState
): T | null {
  return connectionState === 'ready' ? snapshot : null
}
