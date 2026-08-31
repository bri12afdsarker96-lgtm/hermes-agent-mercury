/**
 * Conversations page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. Maps the wire-shape rows into presentation-safe
 * shapes the view consumes. Tone tables for state / outcome are
 * derived from server strings (no fabricated tones).
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P19: timestamps (received_ts / created_ts / finished_ts) are
 *     pre-formatted via the existing `fmtIso` formatter (passed as
 *     an arg so this file stays transport-free; the glue owns the
 *     formatter import).
 *   - §P20: no extra `t('status.moduleBody')` paragraph is added — the
 *     pre-split page had no such paragraph.
 *
 * No transport, no useValue, no session atoms — the controller has
 * already resolved the queries.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { AttemptRow, InboundRow, OutboundRow } from './page-conversations.controller'

export const STATE_TONE: Record<string, StatusTone> = {
  failed: 'bad',
  processed: 'good',
  processing: 'warn',
  queued: 'muted',
  received: 'muted',
  rejected: 'bad',
  sending: 'warn',
  sent: 'good',
  started: 'muted',
  succeeded: 'good',
}

export const OUTCOME_TONE: Record<string, StatusTone> = {
  permanent: 'bad',
  success: 'good',
  transient: 'warn',
}

export interface InboundView {
  channel: string
  externalChatId: null | string
  inboundId: string
  messageType: string
  receivedTs: string
  state: string
  stateTone: StatusTone
}

export interface OutboundView {
  channel: string
  createdTs: string
  internalMessageId: string
  recipientBindingId: string
  state: string
  stateTone: StatusTone
}

export interface AttemptView {
  attemptId: string
  attemptNumber: number
  createdTs: string
  finishedTs: string
  internalMessageId: string
  outcomeClass: string
  state: string
  stateTone: StatusTone
}

export interface ConversationsInboundListView {
  rows: InboundView[]
  isEmpty: boolean
}

export interface ConversationsOutboundListView {
  rows: OutboundView[]
  isEmpty: boolean
}

export interface ConversationsAttemptsView {
  rows: AttemptView[]
  isEmpty: boolean
}

/**
 * Phase-1 read-only contract type alias — declared here so the view
 * can stay free of the controller imports.
 */
export type ConversationsTab = 'inbound' | 'outbound'

export function deriveInboundList(
  rows: InboundRow[],
  fmtIso: (iso: null | string | undefined) => string
): ConversationsInboundListView {
  return {
    isEmpty: rows.length === 0,
    rows: rows.map((row) => ({
      channel: row.channel,
      externalChatId: row.external_chat_id,
      inboundId: row.inbound_id,
      messageType: row.message_type,
      receivedTs: fmtIso(row.received_ts),
      state: row.state,
      stateTone: STATE_TONE[row.state] ?? 'muted',
    })),
  }
}

export function deriveOutboundList(
  rows: OutboundRow[],
  fmtIso: (iso: null | string | undefined) => string
): ConversationsOutboundListView {
  return {
    isEmpty: rows.length === 0,
    rows: rows.map((row) => ({
      channel: row.channel,
      createdTs: fmtIso(row.created_ts),
      internalMessageId: row.internal_message_id,
      recipientBindingId: row.recipient_binding_id,
      state: row.state,
      stateTone: STATE_TONE[row.state] ?? 'muted',
    })),
  }
}

export function deriveAttemptsList(
  rows: AttemptRow[],
  fmtIso: (iso: null | string | undefined) => string
): ConversationsAttemptsView {
  return {
    isEmpty: rows.length === 0,
    rows: rows.map((row) => ({
      attemptId: row.attempt_id,
      attemptNumber: row.attempt_number,
      createdTs: fmtIso(row.created_ts),
      finishedTs: fmtIso(row.finished_ts),
      internalMessageId: row.internal_message_id,
      outcomeClass: row.outcome_class,
      state: row.state,
      stateTone:
        OUTCOME_TONE[row.outcome_class] ?? STATE_TONE[row.state] ?? 'muted',
    })),
  }
}