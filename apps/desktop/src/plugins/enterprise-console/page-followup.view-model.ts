/**
 * Follow-up page (SC1) — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Three derivations matter:
 *   1. status → StatusTone (7 server states → 4 design tones)
 *   2. list rows flattened to FollowupListRow carrying status + tone
 *      + isSelected flag (drives the master-row visual state)
 *   3. detail fields flattened to FollowupDetailField (label + value
 *      pairs with the right `data-ec-mono` flag per field type)
 *
 * History timeline events are derived to TimelineEvent shape
 * (compatible with the shared Timeline primitive).
 *
 * Wave 1 / Step 14 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type {
  FollowupHistoryRow,
  FollowupRow,
  FollowupStatus,
} from './page-followup.controller'

export interface FollowupListRow {
  amount: string
  businessSubject: string
  currency: string
  expectedReceiveDate: string
  followupId: string
  isSelected: boolean
  status: FollowupStatus
  tone: StatusTone
}

export interface FollowupDetailField {
  label: string
  mono: boolean
  value: string
}

export interface FollowupTimelineEvent {
  description: null | string
  id: string
  timestamp: string
  title: string
  tone: StatusTone
}

export interface FollowupViewModel extends CommonViewModelFields {
  rows: readonly FollowupListRow[]
  detailFields: readonly FollowupDetailField[]
  historyEvents: readonly FollowupTimelineEvent[]
  /** True when the view should render the empty-state placeholder. */
  detailEmpty: boolean
  historyEmpty: boolean
  listEmpty: boolean
}

const STATUS_TONE: Record<string, StatusTone> = {
  cancelled: 'muted',
  completed: 'good',
  created: 'muted',
  followup_due: 'warn',
  open: 'good',
  pending_confirmation: 'warn',
  waiting_update: 'warn',
}

function deriveListRow(row: FollowupRow, isSelected: boolean): FollowupListRow {
  return {
    followupId: row.followup_id,
    businessSubject: row.business_subject,
    amount: row.amount,
    currency: row.currency,
    expectedReceiveDate: row.expected_receive_date,
    status: row.status,
    tone: STATUS_TONE[row.status] ?? 'muted',
    isSelected,
  }
}

function deriveDetailFields(row: FollowupRow): FollowupDetailField[] {
  return [
    { label: 'subject', mono: false, value: row.business_subject },
    { label: 'amount', mono: true, value: `${row.amount} ${row.currency}` },
    { label: 'status', mono: false, value: row.status },
    { label: 'expected', mono: true, value: row.expected_receive_date },
    { label: 'received', mono: true, value: row.received_at ?? '—' },
    { label: 'next follow-up', mono: true, value: row.next_followup_at ?? '—' },
    { label: 'owner', mono: true, value: row.owner_principal_id },
  ]
}

function deriveTimelineEvent(row: FollowupHistoryRow): FollowupTimelineEvent {
  const transition =
    row.from_status || row.to_status
      ? `${row.from_status ?? '—'} → ${row.to_status ?? '—'}`
      : null

  return {
    id: row.history_id,
    title: row.event_type,
    description: transition,
    timestamp: row.created_ts,
    tone: STATUS_TONE[row.to_status ?? ''] ?? 'muted',
  }
}

export interface FollowupViewModelArgs {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  detail: { data: import('./page-followup.controller').FollowupDetailResp | undefined; isPending: boolean; error: unknown }
  history: { data: import('./page-followup.controller').FollowupHistoryResp | undefined; isPending: boolean; error: unknown }
  list: { data: import('./page-followup.controller').FollowupListResp | undefined; isPending: boolean; error: unknown }
  selectedId: null | string
}

export function deriveFollowupViewModel(args: FollowupViewModelArgs): FollowupViewModel {
  const { page, whoami, list, detail, history, selectedId } = args
  const common = deriveCommonViewModel({ page, whoami })

  const rows = (list.data?.followups ?? []).map(row => deriveListRow(row, row.followup_id === selectedId))
  const listEmpty = !list.isPending && !list.error && rows.length === 0

  const detailFields = detail.data ? deriveDetailFields(detail.data.followup) : []
  const detailEmpty = !detail.isPending && !detail.error && !detail.data

  const historyEvents = (history.data?.history ?? []).map(deriveTimelineEvent)
  const historyEmpty = !history.isPending && !history.error && historyEvents.length === 0

  return {
    ...common,
    rows,
    detailFields,
    historyEvents,
    listEmpty,
    detailEmpty,
    historyEmpty,
  }
}