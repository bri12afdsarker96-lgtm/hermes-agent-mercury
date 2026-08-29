/**
 * Follow-up page — Controller layer (Functional Controller).
 *
 * Owns the three Follow-up SC1 server reads:
 *   - `/api/followup-list`     (paginated read, status-filterable)
 *   - `/api/followup-detail`   (single follow-up by id)
 *   - `/api/followup-history`  (timeline events for one follow-up)
 *
 * Per W1-B1-REMEDIATION-01 §P22, the list query key is the EXACT
 * pre-split identity so cache sharing / observers / functional
 * parity are preserved.
 *
 * The controller MUST NOT introduce mutations. Phase-1 follow-up is
 * intentionally read-only — actor-driven server transitions only.
 *
 * Per W1-B1-REMEDIATION-01 §P8, detail/history queries are only run
 * when an id is present. The glue layer mounts
 * `FollowupSelectedDetailContainer(id)` conditionally rather than
 * calling hooks unconditionally with an empty-string id.
 */

import { useConsoleQuery } from './page-kit'

export type FollowupStatus =
  | 'cancelled'
  | 'completed'
  | 'created'
  | 'followup_due'
  | 'open'
  | 'pending_confirmation'
  | 'waiting_update'

export const FOLLOWUP_STATUSES: FollowupStatus[] = [
  'created',
  'pending_confirmation',
  'open',
  'followup_due',
  'waiting_update',
  'completed',
  'cancelled',
]

export interface FollowupRow {
  amount: string
  business_subject: string
  business_team: null | string
  created_ts: string
  currency: string
  expected_receive_date: string
  followup_id: string
  followup_type: string
  next_followup_at: null | string
  owner_principal_id: string
  received_at: null | string
  status: FollowupStatus
  updated_ts: string
  version: number
}

export interface FollowupHistoryRow {
  actor_principal_id: null | string
  created_ts: string
  event_type: string
  followup_id: string
  from_status: null | string
  history_id: string
  to_status: null | string
}

export interface FollowupListResp {
  followups: FollowupRow[]
}

export interface FollowupDetailResp {
  followup: FollowupRow
}

export interface FollowupHistoryResp {
  history: FollowupHistoryRow[]
}

export const FOLLOWUP_KEY = ['enterprise-console', 'followups'] as const

const followupDetailKey = (id: string) =>
  ['enterprise-console', 'followup', id] as const

const followupHistoryKey = (id: string) =>
  ['enterprise-console', 'followup-history', id] as const

const FOLLOWUP_LIST_PATH = '/api/followup-list'

export function followupListPath(status: '' | FollowupStatus): string {
  return status
    ? `${FOLLOWUP_LIST_PATH}?status=${encodeURIComponent(status)}`
    : FOLLOWUP_LIST_PATH
}

export function useFollowupList(status: '' | FollowupStatus) {
  return useConsoleQuery<FollowupListResp>(
    [...FOLLOWUP_KEY, status],
    followupListPath(status)
  )
}

export function useFollowupDetail(followupId: string) {
  return useConsoleQuery<FollowupDetailResp>(
    followupDetailKey(followupId),
    `/api/followup-detail?followup_id=${encodeURIComponent(followupId)}`
  )
}

export function useFollowupHistory(followupId: string) {
  return useConsoleQuery<FollowupHistoryResp>(
    followupHistoryKey(followupId),
    `/api/followup-history?followup_id=${encodeURIComponent(followupId)}`
  )
}