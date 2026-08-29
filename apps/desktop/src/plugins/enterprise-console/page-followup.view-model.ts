/**
 * Follow-up page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure derivation: maps raw controller responses into presentation-safe
 * fields the view consumes. The view must not need to know about
 * `StatusTone` or any of the wire-shape fields directly.
 *
 * No transport, no useValue, no session atoms — the controller has
 * already resolved the queries.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { ConsolePage } from './catalog'
import type {
  FollowupHistoryRow,
  FollowupRow,
  FollowupStatus,
} from './page-followup.controller'
import { type CommonViewModelArgs, deriveCommonViewModel } from './view-model'

export const STATUS_TONE: Record<FollowupStatus, StatusTone> = {
  cancelled: 'muted',
  completed: 'good',
  created: 'muted',
  followup_due: 'warn',
  open: 'good',
  pending_confirmation: 'warn',
  waiting_update: 'warn',
}

export interface FollowupListRowView {
  amount: string
  businessSubject: string
  businessTeam: null | string
  currency: string
  expectedReceiveDate: string
  followupId: string
  followupType: string
  ownerPrincipalId: string
  receivedAt: null | string
  status: FollowupStatus
  statusTone: StatusTone
}

export interface FollowupDetailView {
  amount: string
  businessSubject: string
  currency: string
  expectedReceiveDate: string
  followupId: string
  nextFollowupAt: null | string
  ownerPrincipalId: string
  receivedAt: null | string
  status: FollowupStatus
  statusTone: StatusTone
}

export interface FollowupHistoryEventView {
  actorPrincipalId: null | string
  createdTs: string
  eventType: string
  fromStatus: null | string
  historyId: string
  statusTone: StatusTone
  timestamp: string
  title: string
  toStatus: null | string
  transitionLabel: string
}

export interface FollowupListView {
  rows: FollowupListRowView[]
  isEmpty: boolean
}

export interface FollowupDetailViewModel {
  detail: null | FollowupDetailView
  detailPending: boolean
  detailError: null | string
}

export interface FollowupHistoryViewModel {
  events: FollowupHistoryEventView[]
  isEmpty: boolean
  historyPending: boolean
  historyError: null | string
}

export interface FollowupPageViewModel {
  // Shared VM (permission / capability / page status)
  canRead: boolean
  capabilityStatus: null | ReturnType<typeof deriveCommonViewModel>['capabilityStatus']
  readOnlyReason: null | string
  // Selection / filter state is presentation-owned; the page passes it
  // through the glue. The VM exposes only the resolved list.
  list: FollowupListView
  listPending: boolean
  listError: null | string
}

/**
 * Derive the list rows from server-declared FollowupRow[].
 * Pure: no network, no role assumption.
 */
export function deriveFollowupList(rows: FollowupRow[]): FollowupListView {
  return {
    isEmpty: rows.length === 0,
    rows: rows.map((row) => ({
      amount: row.amount,
      businessSubject: row.business_subject,
      businessTeam: row.business_team,
      currency: row.currency,
      expectedReceiveDate: row.expected_receive_date,
      followupId: row.followup_id,
      followupType: row.followup_type,
      ownerPrincipalId: row.owner_principal_id,
      receivedAt: row.received_at,
      status: row.status,
      statusTone: STATUS_TONE[row.status],
    })),
  }
}

/**
 * Derive the detail view from a server-declared FollowupRow.
 */
export function deriveFollowupDetail(row: null | FollowupRow): FollowupDetailViewModel {
  if (!row) {
    return { detail: null, detailPending: false, detailError: null }
  }

  return {
    detail: {
      amount: row.amount,
      businessSubject: row.business_subject,
      currency: row.currency,
      expectedReceiveDate: row.expected_receive_date,
      followupId: row.followup_id,
      nextFollowupAt: row.next_followup_at,
      ownerPrincipalId: row.owner_principal_id,
      receivedAt: row.received_at,
      status: row.status,
      statusTone: STATUS_TONE[row.status],
    },
    detailPending: false,
    detailError: null,
  }
}

/**
 * Derive the history view from server-declared FollowupHistoryRow[].
 * Pure: no network.
 */
export function deriveFollowupHistory(
  events: FollowupHistoryRow[]
): FollowupHistoryViewModel {
  return {
    isEmpty: events.length === 0,
    events: events.map((event) => {
      const tone =
        STATUS_TONE[(event.to_status ?? '') as FollowupStatus] ?? 'muted'

      const fromStatus = event.from_status ?? '—'
      const toStatus = event.to_status ?? '—'
      const transitionLabel = `${fromStatus} → ${toStatus}`

      return {
        actorPrincipalId: event.actor_principal_id,
        createdTs: event.created_ts,
        eventType: event.event_type,
        fromStatus: event.from_status,
        historyId: event.history_id,
        statusTone: tone,
        timestamp: event.created_ts,
        title: event.event_type,
        toStatus: event.to_status,
        transitionLabel,
      }
    }),
    historyPending: false,
    historyError: null,
  }
}

/**
 * Compose the page-level VM that the glue passes to the view.
 */
export function deriveFollowupPageViewModel(args: {
  page: ConsolePage
  listRows: FollowupRow[]
  listPending: boolean
  listError: unknown
}): FollowupPageViewModel {
  const { page, listRows, listPending, listError } = args
  const sharedArgs: CommonViewModelArgs = { whoami: null, page }
  const shared = deriveCommonViewModel(sharedArgs)

  return {
    canRead: shared.canRead,
    capabilityStatus: shared.capabilityStatus,
    readOnlyReason: shared.readOnlyReason,
    list: deriveFollowupList(listRows),
    listPending,
    listError: listError instanceof Error ? listError.message : null,
  }
}