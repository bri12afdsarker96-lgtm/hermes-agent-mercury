/**
 * Human Handoff page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Three derivations matter:
 *
 *   1. claim_age_s → StatusTone (60s+ bad, 30s+ warn, else good).
 *   2. state → StatusTone (escalated → warn, parked → muted).
 *   3. Per-row action flag derivation: which action buttons are
 *      shown depends on row state (claim when agent_id is null;
 *      reply when status === 'claimed'; requeue when state === 'parked').
 *
 * Wave 1 / Step 7 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { HandoffRow } from './page-handoff.controller'

export interface HandoffViewRow {
  agentId: null | string
  ageSeconds: null | number
  ageTone: StatusTone
  claimAgeLabel: null | string
  canClaim: boolean
  canReply: boolean
  canRequeue: boolean
  msgId: string
  state: string
  stateTone: StatusTone
  status: null | string
  text: string
  threadId: string
}

export interface HandoffViewModel extends CommonViewModelFields {
  rows: readonly HandoffViewRow[]
  /** True when the server marked the inbox as unassembled (501). */
  isAvailable: boolean
  /** True when both `isAvailable` is false AND the list is empty. */
  isEmpty: boolean
}

const STATE_TONE: Record<string, StatusTone> = { escalated: 'warn', parked: 'muted' }

function deriveAgeTone(ageSeconds: null | number): StatusTone {
  if (ageSeconds == null) {
    return 'muted'
  }

  if (ageSeconds >= 60) {
    return 'bad'
  }

  return ageSeconds >= 30 ? 'warn' : 'good'
}

function deriveRow(handoff: HandoffRow): HandoffViewRow {
  return {
    msgId: handoff.msg_id,
    agentId: handoff.agent_id,
    ageSeconds: handoff.claim_age_s,
    ageTone: deriveAgeTone(handoff.claim_age_s),
    ageLabel: handoff.claim_age_s != null ? `${handoff.claim_age_s}s` : null,
    claimAgeLabel: handoff.claim_age_s != null ? `${handoff.claim_age_s}s` : null,
    state: handoff.state,
    stateTone: STATE_TONE[handoff.state] ?? 'muted',
    status: handoff.status,
    text: handoff.text,
    threadId: handoff.thread_id,
    canClaim: handoff.agent_id == null,
    canReply: handoff.status === 'claimed',
    canRequeue: handoff.state === 'parked',
  }
}

export interface HandoffViewModelArgs {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  data: { available: boolean; handoffs: HandoffRow[] } | undefined
}

export function deriveHandoffViewModel(args: HandoffViewModelArgs): HandoffViewModel {
  const { page, whoami, data } = args
  const common = deriveCommonViewModel({ page, whoami })

  const rows = (data?.handoffs ?? []).map(deriveRow)
  const isAvailable = data?.available ?? false
  const isEmpty = !isAvailable || rows.length === 0

  return {
    ...common,
    rows,
    isAvailable,
    isEmpty,
  }
}