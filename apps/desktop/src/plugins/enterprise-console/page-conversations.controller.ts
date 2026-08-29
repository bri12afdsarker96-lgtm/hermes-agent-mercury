/**
 * Conversations page (SC3) — Controller layer (Functional Controller).
 *
 * Owns the three Conversations SC3 server reads:
 *   - /api/conversations-inbound   (inbound messages)
 *   - /api/conversations-outbound  (outbound messages)
 *   - /api/conversations-attempts  (per-internal-message attempts)
 *
 * Per W1-B1-REMEDIATION-01 §P22, the query keys are the EXACT pre-split
 * identity so cache sharing / observers / functional parity are
 * preserved.
 *
 * The controller MUST NOT introduce any mutation surface. Phase-1
 * Conversations is read-only — server declares delivery state, the
 * presentation never re-executes, retries, releases, or fabricates
 * transitions. `unknown_delivery` stays evidence-only.
 */

import { useConsoleQuery } from './page-kit'

export interface InboundRow {
  channel: string
  external_chat_id: null | string
  inbound_id: string
  message_type: string
  processed_ts: null | string
  received_ts: string
  state: string
  updated_ts: string
}

export interface OutboundRow {
  channel: string
  created_ts: string
  internal_message_id: string
  recipient_binding_id: string
  state: string
  updated_ts: string
}

export interface AttemptRow {
  attempt_id: string
  attempt_number: number
  created_ts: string
  finished_ts: null | string
  internal_message_id: string
  outcome_class: string
  state: string
}

export interface InboundResp {
  inbound: InboundRow[]
}

export interface OutboundResp {
  outbound: OutboundRow[]
}

export interface AttemptsResp {
  attempts: AttemptRow[]
}

export const CONVERSATIONS_INBOUND_KEY = ['enterprise-console', 'conv-inbound'] as const
export const CONVERSATIONS_OUTBOUND_KEY = ['enterprise-console', 'conv-outbound'] as const
export const conversationsAttemptsKey = (internalMessageId: string) =>
  ['enterprise-console', 'conv-attempts', internalMessageId] as const

export function useInboundList() {
  return useConsoleQuery<InboundResp>(
    CONVERSATIONS_INBOUND_KEY,
    '/api/conversations-inbound'
  )
}

export function useOutboundList() {
  return useConsoleQuery<OutboundResp>(
    CONVERSATIONS_OUTBOUND_KEY,
    '/api/conversations-outbound'
  )
}

export function useAttemptsList(internalMessageId: string) {
  return useConsoleQuery<AttemptsResp>(
    conversationsAttemptsKey(internalMessageId),
    `/api/conversations-attempts?internal_message_id=${encodeURIComponent(internalMessageId)}`,
    0
  )
}