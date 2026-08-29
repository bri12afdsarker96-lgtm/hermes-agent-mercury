/**
 * WeCom status page (SC5) — Controller layer.
 *
 * READ-ONLY: aggregate non-secret tenant facts. Holds:
 *   - useWeComStatus() — read-only /api/wecom-status
 *
 * Important invariants (carry over from the original page):
 *   - runtime_credential_state is a UNKNOWN/ABSENT/PARTIAL/PRESENT
 *     membership judgement over the tenant's own observed app_config_ref;
 *     never asserted PRESENT from silence.
 *   - callback_health is always 'unknown' in Phase-1 (not actively
 *     probed) and is shown honestly, not inferred from an absence of
 *     inbound.
 *
 * Wave 1 / Step 11 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

export type CredentialState = 'ABSENT' | 'PARTIAL' | 'PRESENT' | 'UNKNOWN'

export interface WeComStatus {
  association_state: 'BOUND' | 'UNBOUND'
  binding_count: number
  callback_health: 'unknown'
  last_delivery_outcome: 'permanent' | 'success' | 'transient' | null
  last_outbound_at: null | string
  last_verified_inbound_at: null | string
  observed_app_config_ref_count: number
  runtime_credential_present_count: null | number
  runtime_credential_state: CredentialState
}

export interface WeComStatusResp {
  wecom: WeComStatus
}

export const WECOM_KEY = ['enterprise-console', 'wecom-status'] as const

export function useWeComStatus() {
  const transport = useTransport()

  return useConsoleQuery<WeComStatusResp>(WECOM_KEY, '/api/wecom-status')
}

export function normalizeWeComError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'channel.binding.manage permission required'
    }

    if (e.code === 'not_implemented') {
      return 'wecom-status endpoint is not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}