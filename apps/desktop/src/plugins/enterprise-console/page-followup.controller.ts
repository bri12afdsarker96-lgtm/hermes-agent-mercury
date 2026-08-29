/**
 * Follow-up page — Controller layer (Functional Controller).
 *
 * Owns the three Follow-up SC1 server reads:
 *   - `/api/followup-list`     (paginated read, status-filterable)
 *   - `/api/followup-detail`   (single follow-up by id)
 *   - `/api/followup-history`  (timeline events for one follow-up)
 *
 * Wire-shape types (`FollowupStatus`, `FollowupRow`,
 * `FollowupHistoryRow`, response envelopes) live here so the
 * view-model and view can stay free of the raw server payload.
 *
 * The controller MUST NOT introduce mutations. Phase-1 follow-up is
 * intentionally read-only — actor-driven server transitions only.
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

const FOLLOWUP_KEY = ['enterprise-console', 'followups'] as const

const followupDetailKey = (id: string) =>
  ['enterprise-console', 'followup', id] as const

const followupHistoryKey = (id: string) =>
  ['enterprise-console', 'followup-history', id] as const

const FOLLOWUP_LIST_PATH = '/api/followup-list'

function followupListPath(status: '' | FollowupStatus): string {
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