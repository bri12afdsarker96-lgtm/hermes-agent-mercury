/**
 * Handoff page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no session
 * atom, no permission authority, no mutation authority.
 *
 * Per W1-C §P20:
 *   - Wire row → presentation row mapping
 *   - State → StatusTone mapping (matches pre-split)
 *   - Age → StatusTone mapping (matches pre-split)
 *   - Action eligibility from server row facts ONLY (no
 *     ownership inference, no client state machine)
 *
 * Per P1-VIS-V2 (Minimal Handoff productization):
 *   - Added `stateLabel: string` field — trivial STATE_LABEL lookup
 *     so the View can render a stable text. Mirrors the Reminder
 *     VM addition. No change to eligibility rules.
 *   - No new eligibility derivation. canClaim / canReply /
 *     canRequeue continue to come ONLY from server row facts.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { HandoffRow } from './page-handoff.controller'

// ---------------------------------------------------------------------------
// Tone tables (matches pre-split exactly)
// ---------------------------------------------------------------------------

export const STATE_TONE: Record<string, StatusTone> = {
  escalated: 'warn',
  parked: 'muted',
}

export function stateTone(state: string): StatusTone {
  return STATE_TONE[state] ?? 'muted'
}

export function ageTone(ageSeconds: null | number): StatusTone {
  if (ageSeconds == null) {
    return 'muted'
  }

  if (ageSeconds >= 60) {
    return 'bad'
  }

  return ageSeconds >= 30 ? 'warn' : 'good'
}

// ---------------------------------------------------------------------------
// V2 productization — state label lookup (presentation-only)
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = {
  parked: 'parked',
  escalated: 'escalated',
}

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state
}

// ---------------------------------------------------------------------------
// Presentation shape
// ---------------------------------------------------------------------------

export interface HandoffRowView {
  msgId: string
  text: string
  threadId: string
  agentDisplay: string
  statusDisplay: string
  state: string
  ageSeconds: null | number
  ageTone: StatusTone
  stateTone: StatusTone
  // Action eligibility (presentation-side; authority in action seam)
  canClaim: boolean
  canReply: boolean
  canRequeue: boolean
  // V2 productization — presentation-only
  stateLabel: string
}

export function deriveHandoff(row: HandoffRow): HandoffRowView {
  const state = row.state
  // Per P19 — server row facts ONLY.
  const canClaim = row.agent_id == null
  const canReply = row.status === 'claimed'
  const canRequeue = state === 'parked'

  return {
    msgId: row.msg_id,
    text: row.text,
    threadId: row.thread_id,
    agentDisplay: row.agent_id ?? 'unclaimed',
    statusDisplay: row.status ? ` · ${row.status}` : '',
    state,
    ageSeconds: row.claim_age_s,
    ageTone: ageTone(row.claim_age_s),
    stateTone: stateTone(state),
    canClaim,
    canReply,
    canRequeue,
    stateLabel: stateLabel(state),
  }
}

export function deriveHandoffs(
  rows: HandoffRow[] | null | undefined
): HandoffRowView[] {
  if (!rows) {
    return []
  }

  return rows.map(deriveHandoff)
}

export function isHandoffsEmpty(
  data: { available: boolean; handoffs: unknown[] } | null | undefined
): boolean {
  if (!data) {
    return true
  }

  return !data.available || data.handoffs.length === 0
}
