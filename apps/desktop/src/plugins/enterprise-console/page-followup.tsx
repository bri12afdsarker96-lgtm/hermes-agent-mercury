/**
 * Follow-up page (SC1) — real `/api/followup-list|detail|history` reads. Phase-1
 * is READ-ONLY: the server exposes no `followup-*` write route, so this page
 * never fabricates a mutation or a transition. Row visibility is owner-scoped
 * for managed roles INSIDE the server model (operator/supervisor see only their
 * own rows); the client adds no filter and makes no authz decision.
 *
 * NOTE: follow-up timestamps are ISO-8601 strings (not epoch seconds), so they
 * are rendered with `Date(iso)` directly — `fmtEpoch` (epoch-seconds) must NOT
 * be used here. `amount` is a Decimal-as-string; `version` is a number.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConsoleRows, fmtIso, QueryBody, useConsoleQuery } from './page-kit'

export type FollowupStatus =
  | 'cancelled'
  | 'completed'
  | 'created'
  | 'followup_due'
  | 'open'
  | 'pending_confirmation'
  | 'waiting_update'

/** The valid server-side status filter set (unknown status → server 400). */
const FOLLOWUP_STATUSES: FollowupStatus[] = [
  'created',
  'pending_confirmation',
  'open',
  'followup_due',
  'waiting_update',
  'completed',
  'cancelled'
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

interface FollowupListResp {
  followups: FollowupRow[]
}
interface FollowupDetailResp {
  followup: FollowupRow
}
interface FollowupHistoryResp {
  history: FollowupHistoryRow[]
}

const FOLLOWUP_KEY = ['enterprise-console', 'followups'] as const
const followupDetailKey = (id: string) => ['enterprise-console', 'followup', id] as const
const followupHistoryKey = (id: string) => ['enterprise-console', 'followup-history', id] as const

const STATUS_TONE: Record<string, StatusTone> = {
  cancelled: 'muted',
  completed: 'good',
  created: 'muted',
  followup_due: 'warn',
  open: 'good',
  pending_confirmation: 'warn',
  waiting_update: 'warn'
}

function FollowupDetail({ followupId }: { followupId: string }) {
  const detail = useConsoleQuery<FollowupDetailResp>(
    followupDetailKey(followupId),
    `/api/followup-detail?followup_id=${encodeURIComponent(followupId)}`
  )

  const history = useConsoleQuery<FollowupHistoryResp>(
    followupHistoryKey(followupId),
    `/api/followup-history?followup_id=${encodeURIComponent(followupId)}`
  )

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="console-followup-detail">
      <QueryBody emptyText="—" query={detail}>
        {data => {
          const row = data.followup

          return (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">subject</dt>
              <dd className="truncate">{row.business_subject}</dd>
              <dt className="text-muted-foreground">amount</dt>
              <dd>
                {row.amount} {row.currency}
              </dd>
              <dt className="text-muted-foreground">status</dt>
              <dd className="inline-flex items-center gap-1">
                <StatusDot tone={STATUS_TONE[row.status] ?? 'muted'} />
                {row.status}
              </dd>
              <dt className="text-muted-foreground">expected</dt>
              <dd>{row.expected_receive_date}</dd>
              <dt className="text-muted-foreground">received</dt>
              <dd>{fmtIso(row.received_at)}</dd>
              <dt className="text-muted-foreground">next follow-up</dt>
              <dd>{fmtIso(row.next_followup_at)}</dd>
              <dt className="text-muted-foreground">owner</dt>
              <dd className="truncate">{row.owner_principal_id}</dd>
            </dl>
          )
        }}
      </QueryBody>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">history</div>
        <QueryBody emptyText="no history" isEmpty={data => data.history.length === 0} query={history}>
          {data => (
            <ConsoleRows testId="console-followup-history">
              {data.history.map(event => (
                <li className="rounded-md border border-border px-2 py-1 text-xs" key={event.history_id}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{event.event_type}</span>
                    <span className="text-muted-foreground">{fmtIso(event.created_ts)}</span>
                  </div>
                  {event.from_status || event.to_status ? (
                    <div className="text-muted-foreground">
                      {event.from_status ?? '—'} → {event.to_status ?? '—'}
                    </div>
                  ) : null}
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </div>
    </div>
  )
}

export function FollowupPage() {
  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const listPath = status ? `/api/followup-list?status=${status}` : '/api/followup-list'
  const query = useConsoleQuery<FollowupListResp>([...FOLLOWUP_KEY, status], listPath)

  return (
    <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-followup">
      <div className="flex justify-end">
        <select
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
          data-testid="console-followup-status-filter"
          onChange={event => setStatus(event.target.value as '' | FollowupStatus)}
          value={status}
        >
          <option value="">all</option>
          {FOLLOWUP_STATUSES.map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <QueryBody emptyText="no follow-ups" isEmpty={data => data.followups.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-followups">
            {data.followups.map(row => (
              <li key={row.followup_id}>
                <button
                  className={
                    row.followup_id === selectedId
                      ? 'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-accent px-2 py-1.5 text-left text-sm'
                      : 'flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-sm hover:bg-accent/50'
                  }
                  data-testid={`console-followup-${row.followup_id}`}
                  onClick={() => setSelectedId(id => (id === row.followup_id ? null : row.followup_id))}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{row.business_subject}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.amount} {row.currency} · due {row.expected_receive_date}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                    <StatusDot tone={STATUS_TONE[row.status] ?? 'muted'} />
                    {row.status}
                  </span>
                </button>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
      {selectedId ? <FollowupDetail followupId={selectedId} /> : null}
    </div>
  )
}
