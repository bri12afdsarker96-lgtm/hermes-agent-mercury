/**
 * Identity & Channel Bindings page (SC2) — Controller layer.
 *
 * Holds:
 *   - usePrincipalsData() — read-only list of principals
 *   - useChannelBindingsData() — read-only list of channel bindings
 *   - usePrincipalsForBindingForm() — same principals query, reused
 *     to populate the create-binding principal dropdown
 *   - 2 mutations: create / revoke
 *
 * Permission gating for the binding management section is *display
 * only* — the server enforces channel.binding.manage authoritatively.
 * The view-model computes the gate from whoami + permission and the
 * view simply doesn't render the section when the gate is closed.
 *
 * Wave 1 / Step 10 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

export interface Principal {
  created_ts: number
  last_seen_ts: null | number
  name: string
  principal_id: string
  role: string
  status: string
  tenant_id: null | string
}

export interface PrincipalsResp {
  principals: Principal[]
}

export interface ChannelBinding {
  binding_id: string
  channel: string
  created_ts: null | string
  external_subject: string
  principal_id: string
  revoked_by_principal_id: null | string
  revoked_ts: null | string
  status: 'active' | 'revoked'
  updated_ts: null | string
  version: number
}

export interface ChannelBindingsListResp {
  bindings: ChannelBinding[]
}

export const PRINCIPALS_KEY = ['enterprise-console', 'principals'] as const
export const CHANNEL_BINDINGS_KEY = ['enterprise-console', 'channel-bindings'] as const

export function usePrincipalsData() {
  const transport = useTransport()
  return useConsoleQuery<PrincipalsResp>(PRINCIPALS_KEY, '/api/principals')
}

export function useChannelBindingsData() {
  const transport = useTransport()
  return useConsoleQuery<ChannelBindingsListResp>(CHANNEL_BINDINGS_KEY, '/api/channel-bindings-list')
}

export interface ChannelBindingCreateBody {
  channel: string
  external_subject: string
  principal_id: string
}

export interface ChannelBindingRevokeBody {
  binding_id: string
}

export function makeChannelBindingMutations(transport: ReturnType<typeof useTransport>) {
  return {
    create: async (body: ChannelBindingCreateBody) => {
      await transport.post('/api/channel-binding-create', body)
    },
    revoke: async (body: ChannelBindingRevokeBody) => {
      await transport.post('/api/channel-binding-revoke', body)
    },
  }
}

export function normalizeIdentityError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'principal.crud / channel.binding.manage permission required'
    }

    if (e.code === 'not_implemented') {
      return 'identity endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}