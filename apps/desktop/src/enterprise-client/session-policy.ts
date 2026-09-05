import { EnterpriseClientError } from './runtime-errors'

export type EnterpriseSessionDisposition = 'release-and-clear' | 'retain-and-reconcile'

/**
 * Renderer cache policy only. The server remains authoritative for whether the
 * caller may retry, access a resource or perform a transition.
 */
export function enterpriseSessionDisposition(reason: unknown): EnterpriseSessionDisposition {
  return reason instanceof EnterpriseClientError && reason.kind === 'authentication_required'
    ? 'release-and-clear'
    : 'retain-and-reconcile'
}
