/**
 * Human Handoff page — Controller layer.
 *
 * Holds the HermesTransport query + 3 mutations (claim / reply /
 * requeue) + error normalization. Read of `/api/handoffs` is the
 * source of truth; mutations invalidate the same queryKey so the
 * server-owned state is re-fetched.
 *
 * Wave 1 / Step 7 of W5-B0 Controller/View Contract Freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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

export const HANDOFFS_KEY = ['enterprise-console', 'handoffs'] as const

/** Polling cadence: 15s — handoffs are time-sensitive (claim_age_s grows
 *  continuously, parked rows expire). */
export const HANDOFFS_REFETCH_INTERVAL_MS = 15_000

export function useHandoffsData() {
  const transport = useTransport()

  return useConsoleQuery<HandoffsResp>(
    HANDOFFS_KEY,
    '/api/handoffs',
    HANDOFFS_REFETCH_INTERVAL_MS,
  )
}

/** Body shapes for the three mutations. Each is minimal and typed so
 *  the view never constructs wire payloads. */
export interface HandoffClaimBody {
  msg_id: string
}

export interface HandoffReplyBody {
  msg_id: string
  text: string
}

export interface HandoffRequeueBody {
  msg_id: string
}

/** Run a handoff mutation. Returns a Promise the glue can await. The
 *  mutations automatically invalidate HANDOFFS_KEY so the next render
 *  fetches the authoritative server state.
 *
 *  NOTE: This is a plain function, not a hook, because mutations are
 *  imperative and triggered by ConfirmAction / FormAction onClick/onSubmit.
 *  The view passes the bound function as `run={...}` / `submit={...}` and
 *  never sees the transport. */
export function makeHandoffMutations(transport: ReturnType<typeof useTransport>) {
  return {
    claim: async (body: HandoffClaimBody) => {
      await transport.post('/api/handoff-claim', body)
    },
    reply: async (body: HandoffReplyBody) => {
      await transport.post('/api/handoff-reply', body)
    },
    requeue: async (body: HandoffRequeueBody) => {
      await transport.post('/api/handoff-requeue', body)
    },
  }
}

/** Human-readable error after HermesApiError / generic Error → string. */
export function normalizeHandoffError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'inbox.reply / inbox.claim / inbox.requeue permission required'
    }

    if (e.code === 'not_implemented') {
      return 'handoffs endpoint is not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}