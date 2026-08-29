/**
 * Follow-up page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure derivation: maps raw controller responses into presentation-safe
 * fields the view consumes. The view must not need to know about
 * `StatusTone`, raw ISO timestamps, or the raw wire response shape.
 *
 * No transport, no useValue, no session atoms — the controller has
 * already resolved the queries.
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P10: `deriveFollowupPageViewModel` accepts a real `whoami`
 *     (resolved by the controller's `useValue($whoami)`); it does not
 *     pass `whoami: null` like the W1-B1 closeout.
 *   - §P15: `receivedAt` / `nextFollowupAt` are formatted via the
 *     existing `fmtIso` (passed in as a formatter arg so this file
 *     stays transport-free; the glue owns the formatter import).
 *   - §P16: history events expose `transitionLabel: string | null`
 *     (null when neither from nor to status is present) so the view
 *     decides whether to render the description.
 *   - §P9: the view model does not import the controller's wire types
 *     (`FollowupDetailResp` etc.). The controller-glue layer maps
 *     raw responses into VM shapes; the view consumes only the VM.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { ConsolePage } from './catalog'
import {
  FOLLOWUP_STATUSES,
  type FollowupHistoryRow,
  type FollowupRow,
  type FollowupStatus,
} from './page-followup.controller'
import type { Whoami } from './types'
import { type CommonViewModelArgs, deriveCommonViewModel } from './view-model'

// Re-export the presentation status union + the canonical list so the
// view layer (which is forbidden from importing the controller per the
// W1-A boundary rule) can still type its filter / filter-options props.
// The union and the constant list are the *exact* same types the
// controller exports; they are not derived or invented here.
export type { FollowupStatus }
export const FOLLOWUP_STATUS_VALUES: readonly FollowupStatus[] = FOLLOWUP_STATUSES

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
  receivedAt: string
  status: FollowupStatus
  statusTone: StatusTone
}

export interface FollowupDetailView {
  amount: string
  businessSubject: string
  currency: string
  expectedReceiveDate: string
  followupId: string
  nextFollowupAt: string
  ownerPrincipalId: string
  receivedAt: string
  status: FollowupStatus
  statusTone: StatusTone
}

export interface FollowupHistoryEventView {
  actorPrincipalId: null | string
  eventType: string
  historyId: string
  statusTone: StatusTone
  timestamp: string
  title: string
  /**
   * Pre-formatted transition label (e.g. "open → completed"), or null
   * when neither from_status nor to_status is present on the event.
   * The view renders `<X> → <Y>` only when transitionLabel is not null.
   */
  transitionLabel: string | null
}

export interface FollowupListView {
  rows: FollowupListRowView[]
  isEmpty: boolean
}

export interface FollowupDetailViewModel {
  detail: null | FollowupDetailView
}

export interface FollowupHistoryViewModel {
  events: FollowupHistoryEventView[]
  isEmpty: boolean
}

export interface FollowupPageViewModel {
  // Shared VM (permission / capability / page status)
  canRead: boolean
  readOnlyReason: null | string
  capabilityStatus: null | string
  // List state
  list: FollowupListView
}

/**
 * Derive the list rows from server-declared FollowupRow[].
 * Pure: no network, no role assumption. `fmtIso` is passed in so this
 * file stays transport-free (the glue owns the formatter import).
 */
export function deriveFollowupList(
  rows: FollowupRow[],
  fmtIso: (iso: null | string | undefined) => string
): FollowupListView {
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
      receivedAt: fmtIso(row.received_at),
      status: row.status,
      statusTone: STATUS_TONE[row.status],
    })),
  }
}

/**
 * Derive the detail view from a server-declared FollowupRow.
 * Pure: no network. `fmtIso` owns timestamp formatting.
 */
export function deriveFollowupDetail(
  row: null | FollowupRow,
  fmtIso: (iso: null | string | undefined) => string
): FollowupDetailViewModel {
  if (!row) {
    return { detail: null }
  }

  return {
    detail: {
      amount: row.amount,
      businessSubject: row.business_subject,
      currency: row.currency,
      expectedReceiveDate: row.expected_receive_date,
      followupId: row.followup_id,
      nextFollowupAt: fmtIso(row.next_followup_at),
      ownerPrincipalId: row.owner_principal_id,
      receivedAt: fmtIso(row.received_at),
      status: row.status,
      statusTone: STATUS_TONE[row.status],
    },
  }
}

/**
 * Derive the history view from server-declared FollowupHistoryRow[].
 * Pure: no network.
 *
 * Per W1-B1-REMEDIATION-01 §P16: transitionLabel is null when neither
 * from_status nor to_status is present (the original `description`
 * returned undefined in that case; we now return null so the view
 * can short-circuit on it).
 */
export function deriveFollowupHistory(
  events: FollowupHistoryRow[]
): FollowupHistoryViewModel {
  return {
    isEmpty: events.length === 0,
    events: events.map((event) => {
      const hasTransition =
        event.from_status != null || event.to_status != null

      const tone =
        STATUS_TONE[(event.to_status ?? '') as FollowupStatus] ?? 'muted'

      const transitionLabel = hasTransition
        ? `${event.from_status ?? '—'} → ${event.to_status ?? '—'}`
        : null

      return {
        actorPrincipalId: event.actor_principal_id,
        eventType: event.event_type,
        historyId: event.history_id,
        statusTone: tone,
        timestamp: event.created_ts,
        title: event.event_type,
        transitionLabel,
      }
    }),
  }
}

/**
 * Compose the page-level VM that the glue passes to the view.
 */
export function deriveFollowupPageViewModel(args: {
  page: ConsolePage
  whoami: null | Whoami
  listRows: FollowupRow[]
  fmtIso: (iso: null | string | undefined) => string
}): FollowupPageViewModel {
  const { page, whoami, listRows, fmtIso } = args
  const sharedArgs: CommonViewModelArgs = { whoami, page }
  const shared = deriveCommonViewModel(sharedArgs)

  return {
    canRead: shared.canRead,
    capabilityStatus: shared.capabilityStatus,
    readOnlyReason: shared.readOnlyReason,
    list: deriveFollowupList(listRows, fmtIso),
  }
}