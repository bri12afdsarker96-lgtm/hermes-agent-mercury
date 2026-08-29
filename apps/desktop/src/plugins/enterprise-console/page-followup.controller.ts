/**
 * Follow-up page (SC1) — Controller layer.
 *
 * READ-ONLY only. No mutation hooks exist; Phase-1 follow-ups are
 * actor-driven (server-owned state machine), not admin-driven.
 *
 * Reads:
 *   - useFollowupList(status) — /api/followup-list?status=...
 *   - useFollowupDetail(followupId) — /api/followup-detail?followup_id=...
 *   - useFollowupHistory(followupId) — /api/followup-history?followup_id=...
 *
 * Wave 1 / Step 14 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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
export const followupDetailKey = (id: string): readonly unknown[] =>
  ['enterprise-console', 'followup', id]
export const followupHistoryKey = (id: string): readonly unknown[] =>
  ['enterprise-console', 'followup-history', id]

export function followupListPath(status: '' | FollowupStatus): string {
  return status ? `/api/followup-list?status=${status}` : '/api/followup-list'
}

export function followupListKey(status: '' | FollowupStatus): readonly unknown[] {
  return [...FOLLOWUP_KEY, status]
}

export function useFollowupList(status: '' | FollowupStatus) {
  const transport = useTransport()

  return useConsoleQuery<FollowupListResp>(followupListKey(status), followupListPath(status))
}

export function useFollowupDetail(followupId: null | string) {
  const transport = useTransport()
  const id = followupId ?? ''

  return useConsoleQuery<FollowupDetailResp>(
    followupDetailKey(id),
    id ? `/api/followup-detail?followup_id=${encodeURIComponent(id)}` : '',
  )
}

export function useFollowupHistory(followupId: null | string) {
  const transport = useTransport()
  const id = followupId ?? ''

  return useConsoleQuery<FollowupHistoryResp>(
    followupHistoryKey(id),
    id ? `/api/followup-history?followup_id=${encodeURIComponent(id)}` : '',
    0,
  )
}

export function normalizeFollowupError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'followup.read permission required'
    }

    if (e.code === 'not_implemented') {
      return 'followup endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}