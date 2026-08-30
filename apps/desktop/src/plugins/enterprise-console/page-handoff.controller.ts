/**
 * Handoff page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Handoff page (per W1-C §P22):
 *
 *   Queries:
 *     - GET /api/handoffs
 *       queryKey: ['enterprise-console', 'handoffs']
 *       refetchInterval: 15000
 *
 *   Mutations:
 *     - POST /api/handoff-claim    permission inbox.claim
 *       body {msg_id}
 *     - POST /api/handoff-reply    permission inbox.reply
 *       body {msg_id, text}
 *     - POST /api/handoff-requeue  permission inbox.requeue
 *       body {msg_id}
 *
 * Per W1-C §P19, the controller does NOT own:
 *   - ownership inference
 *   - claimed / replied / parked / escalated optimistic state
 *   - lease / age truth
 *   - claim owner authority
 *
 * All action eligibility is presented via the action seam
 * (FormAction / ConfirmAction).
 */

import { useCallback } from 'react'

import { useTransport } from './transport'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const HANDOFFS_KEY = ['enterprise-console', 'handoffs'] as const
export const HANDOFFS_REFETCH_MS = 15_000

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface HandoffRow {
  agent_id: null | string
  claim_age_s: null | number
  expires_in_s: null | number
  msg_id: string
  state: string
  status: null | string
  text: string
  thread_id: string
}

export interface HandoffsResp {
  available: boolean
  handoffs: HandoffRow[]
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

import { useConsoleQuery } from './page-kit'

export function useKbHandoffs() {
  return useConsoleQuery<HandoffsResp>(
    HANDOFFS_KEY,
    '/api/handoffs',
    HANDOFFS_REFETCH_MS
  )
}

// ---------------------------------------------------------------------------
// Mutation callbacks
// ---------------------------------------------------------------------------

export interface ClaimHandoffBody {
  msg_id: string
}

export interface ReplyHandoffBody {
  msg_id: string
  text: string
}

export interface RequeueHandoffBody {
  msg_id: string
}

export function useHandoffsMutations() {
  const transport = useTransport()

  const claim = useCallback(
    (msg_id: string) =>
      transport.post('/api/handoff-claim', { msg_id }),
    [transport]
  )

  const reply = useCallback(
    (msg_id: string, text: string) =>
      transport.post('/api/handoff-reply', { msg_id, text }),
    [transport]
  )

  const requeue = useCallback(
    (msg_id: string) =>
      transport.post('/api/handoff-requeue', { msg_id }),
    [transport]
  )

  return { claim, reply, requeue }
}