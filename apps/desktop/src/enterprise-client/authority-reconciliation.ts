import { EnterpriseClientError } from './runtime-errors'

/**
 * A 409 proves that the server's state changed while the client was acting.
 * Refresh the owning page projection; never invent a local transition.
 */
export async function reconcileAfterConflict(reason: unknown, refresh: () => Promise<void>): Promise<boolean> {
  if (!(reason instanceof EnterpriseClientError) || reason.kind !== 'conflict') {
    return false
  }

  await refresh()

  return true
}
