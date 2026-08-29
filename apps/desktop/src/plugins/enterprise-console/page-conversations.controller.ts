/**
 * Conversations page (SC3) — Controller layer.
 *
 * Holds the three HermesTransport queries for inbound/outbound/attempts
 * observability, the queryKeys, and the wire-shape interfaces.
 *
 * IMPORTANT: This is a READ-ONLY page in Phase-1. The server deliberately
 * exposes no operator retry/held-release — `unknown_delivery` must not
 * be blindly resent. There are NO mutations in this controller.
 *
 * Wave 1 / Step 6 of W5-B0 Controller/View Contract Freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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
export function conversationsAttemptsKey(internalMessageId: string): readonly unknown[] {
  return ['enterprise-console', 'conv-attempts', internalMessageId]
}

/** Tab direction discriminator. */
export type ConversationsTab = 'inbound' | 'outbound'

export function useConversationsInbound() {
  const transport = useTransport()
  return useConsoleQuery<InboundResp>(CONVERSATIONS_INBOUND_KEY, '/api/conversations-inbound')
}

export function useConversationsOutbound() {
  const transport = useTransport()
  return useConsoleQuery<OutboundResp>(CONVERSATIONS_OUTBOUND_KEY, '/api/conversations-outbound')
}

/** Per-outbound attempts. The endpoint takes `internal_message_id` as a
 *  query parameter — the caller's selected row drives it.
 *
 *  refetchInterval: 0 — attempts are append-only and re-fetch only when
 *  the user re-selects the row. */
export function useConversationsAttempts(internalMessageId: null | string) {
  const transport = useTransport()

  return useConsoleQuery<AttemptsResp>(
    conversationsAttemptsKey(internalMessageId ?? '__none__'),
    internalMessageId
      ? `/api/conversations-attempts?internal_message_id=${encodeURIComponent(internalMessageId)}`
      : '',
    0,
  )
}

/** Human-readable error after HermesApiError / generic Error → string. */
export function normalizeConversationsError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'conversation.read permission required'
    }

    if (e.code === 'not_implemented') {
      return 'conversations endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}