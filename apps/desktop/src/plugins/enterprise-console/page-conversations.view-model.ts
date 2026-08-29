/**
 * Conversations page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 * The view receives a `ConversationsViewModel` and renders.
 *
 * Two derivations matter for this page:
 *
 *   1. state → StatusTone mapping (server's enum → design's StatusTone).
 *      Unknown states default to 'muted' (visible, neutral) rather than
 *      dropped — the audit-trail invariant from handoff §3.5.
 *
 *   2. The view's "selected" row state. The view must know which row
 *      is selected to expand its attempts list. The view-model carries
 *      this as a derived flag so the view stays pure.
 *
 * Wave 1 / Step 6 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { AttemptRow, InboundRow, OutboundRow } from './page-conversations.controller'

/** Server → design tone mapping for message state. Unknown states fall
 *  through to 'muted' so they remain visible to the operator (audit
 *  trail invariant). */
const STATE_TONE: Record<string, StatusTone> = {
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

/** Server outcome_class → tone. Same default-as-muted rule. */
const OUTCOME_TONE: Record<string, StatusTone> = {
  permanent: 'bad',
  success: 'good',
  transient: 'warn',
}

export interface InboundViewRow {
  channel: string
  externalChatId: null | string
  inboundId: string
  messageType: string
  receivedTs: string
  state: string
  tone: StatusTone
  updatedTs: string
}

export interface OutboundViewRow {
  channel: string
  createdTs: string
  internalMessageId: string
  isSelected: boolean
  recipientBindingId: string
  state: string
  tone: StatusTone
  updatedTs: string
}

export interface AttemptViewRow {
  attemptId: string
  attemptNumber: number
  finishedTs: null | string
  internalMessageId: string
  outcomeClass: string
  state: string
  tone: StatusTone
}

export interface ConversationsViewModel extends CommonViewModelFields {
  inbound: readonly InboundViewRow[]
  outbound: readonly OutboundViewRow[]
  attempts: readonly AttemptViewRow[]
  inboundEmpty: boolean
  outboundEmpty: boolean
  attemptsEmpty: boolean
  /** Tab indicator passed to the view for header layout. */
  activeTab: 'inbound' | 'outbound'
  /** When true, the view should render the attempts expansion under
   *  the selected outbound row. */
  attemptsVisible: boolean
}

export interface ConversationsViewModelArgs {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  inbound: InboundRow[] | undefined
  outbound: OutboundRow[] | undefined
  attempts: AttemptRow[] | undefined
  activeTab: 'inbound' | 'outbound'
  selectedOutboundId: null | string
}

export function deriveConversationsViewModel(args: ConversationsViewModelArgs): ConversationsViewModel {
  const { page, whoami, inbound, outbound, attempts, activeTab, selectedOutboundId } = args
  const common = deriveCommonViewModel({ page, whoami })

  const inboundRows: InboundViewRow[] = (inbound ?? []).map(r => ({
    inboundId: r.inbound_id,
    channel: r.channel,
    externalChatId: r.external_chat_id,
    messageType: r.message_type,
    receivedTs: r.received_ts,
    state: r.state,
    tone: STATE_TONE[r.state] ?? 'muted',
    updatedTs: r.updated_ts,
  }))

  const outboundRows: OutboundViewRow[] = (outbound ?? []).map(r => ({
    internalMessageId: r.internal_message_id,
    channel: r.channel,
    recipientBindingId: r.recipient_binding_id,
    createdTs: r.created_ts,
    isSelected: r.internal_message_id === selectedOutboundId,
    state: r.state,
    tone: STATE_TONE[r.state] ?? 'muted',
    updatedTs: r.updated_ts,
  }))

  const attemptRows: AttemptViewRow[] = (attempts ?? []).map(a => ({
    attemptId: a.attempt_id,
    attemptNumber: a.attempt_number,
    finishedTs: a.finished_ts,
    internalMessageId: a.internal_message_id,
    outcomeClass: a.outcome_class,
    state: a.state,
    tone: OUTCOME_TONE[a.outcome_class] ?? STATE_TONE[a.state] ?? 'muted',
  }))

  return {
    ...common,
    inbound: inboundRows,
    outbound: outboundRows,
    attempts: attemptRows,
    inboundEmpty: inboundRows.length === 0,
    outboundEmpty: outboundRows.length === 0,
    attemptsEmpty: attemptRows.length === 0,
    activeTab,
    attemptsVisible: selectedOutboundId !== null && attemptRows.length >= 0,
  }
}