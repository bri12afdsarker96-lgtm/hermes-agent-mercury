/**
 * Follow-up page (SC1) — real `/api/followup-list|detail|history` reads.
 * Phase-1 is intentionally READ-ONLY: no mutation or state transition is
 * fabricated by the presentation layer. Row visibility remains server-owned.
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusDot,
  type StatusTone
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { ConsoleRows, fmtIso, QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader, Timeline } from './ui'

export type FollowupStatus =
  | 'cancelled'
  | 'completed'
  | 'created'
  | 'followup_due'
  | 'open'
  | 'pending_confirmation'
  | 'waiting_update'

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

function useCompactDetail(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1439px)').matches
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia('(max-width: 1439px)')
    const update = () => setCompact(query.matches)

    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return compact
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
    <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
      <ConsolePanel title="Follow-up detail">
        <QueryBody emptyText="—" query={detail}>
          {data => {
            const row = data.followup

            return (
              <dl className="grid grid-cols-[minmax(6.5rem,0.35fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
                <dt className="text-(--ui-text-secondary)">subject</dt>
                <dd className="truncate font-medium text-(--ui-text-primary)">{row.business_subject}</dd>
                <dt className="text-(--ui-text-secondary)">amount</dt>
                <dd className="text-(--ui-text-primary)" data-ec-mono="">
                  {row.amount} {row.currency}
                </dd>
                <dt className="text-(--ui-text-secondary)">status</dt>
                <dd className="inline-flex items-center gap-1.5 text-(--ui-text-primary)">
                  <StatusDot tone={STATUS_TONE[row.status] ?? 'muted'} />
                  {row.status}
                </dd>
                <dt className="text-(--ui-text-secondary)">expected</dt>
                <dd className="text-(--ui-text-primary)" data-ec-mono="">
                  {row.expected_receive_date}
                </dd>
                <dt className="text-(--ui-text-secondary)">received</dt>
                <dd className="text-(--ui-text-primary)" data-ec-mono="">
                  {fmtIso(row.received_at)}
                </dd>
                <dt className="text-(--ui-text-secondary)">next follow-up</dt>
                <dd className="text-(--ui-text-primary)" data-ec-mono="">
                  {fmtIso(row.next_followup_at)}
                </dd>
                <dt className="text-(--ui-text-secondary)">owner</dt>
                <dd className="truncate text-(--ui-text-primary)" data-ec-mono="">
                  {row.owner_principal_id}
                </dd>
              </dl>
            )
          }}
        </QueryBody>
      </ConsolePanel>

      <ConsolePanel divided title="History">
        <QueryBody emptyText="no history" isEmpty={data => data.history.length === 0} query={history}>
          {data => (
            <div data-testid="console-followup-history">
              <Timeline
                empty="no history"
                events={data.history.map(event => ({
                  description:
                    event.from_status || event.to_status ? (
                      <span data-ec-mono="">
                        {event.from_status ?? '—'} → {event.to_status ?? '—'}
                      </span>
                    ) : undefined,
                  id: event.history_id,
                  timestamp: event.created_ts,
                  title: event.event_type,
                  tone: STATUS_TONE[event.to_status ?? ''] ?? 'muted'
                }))}
                label="Follow-up history"
              />
            </div>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}

export function FollowupPage() {
  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const compactDetail = useCompactDetail()
  const listPath = status ? `/api/followup-list?status=${status}` : '/api/followup-list'
  const query = useConsoleQuery<FollowupListResp>([...FOLLOWUP_KEY, status], listPath)

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-followup"
    >
      <PageHeader
        actions={
          <label className="flex items-center gap-2 text-(--ui-text-secondary)">
            <span className="sr-only">status filter</span>
            <select
              className="min-h-9 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 text-(--ui-text-primary) outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
              data-testid="console-followup-status-filter"
              onChange={event => setStatus(event.target.value as '' | FollowupStatus)}
              value={status}
            >
              <option value="">all statuses</option>
              {FOLLOWUP_STATUSES.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        }
        purpose="Track authoritative follow-up records and their server-authored history. Phase-1 is read-only."
        status={<PageStatusBadge status="ready" />}
        title="Business follow-up"
      />

      <div className="grid min-h-0 items-start gap-(--ec-gutter) min-[1440px]:grid-cols-[minmax(var(--ec-list-w),0.9fr)_minmax(var(--ec-detail-w),1.1fr)]">
        <ConsolePanel divided title="Follow-ups">
          <QueryBody emptyText="no follow-ups" isEmpty={data => data.followups.length === 0} query={query}>
            {data => (
              <ConsoleRows testId="console-followups">
                {data.followups.map(row => (
                  <li key={row.followup_id}>
                    <button
                      aria-expanded={row.followup_id === selectedId}
                      className={
                        row.followup_id === selectedId
                          ? 'flex w-full items-center justify-between gap-3 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none ring-1 ring-(--ui-stroke-secondary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                          : 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                      }
                      data-testid={`console-followup-${row.followup_id}`}
                      onClick={() => setSelectedId(id => (id === row.followup_id ? null : row.followup_id))}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-(--ui-text-primary)">{row.business_subject}</span>
                        <span className="mt-0.5 block text-(--ui-text-secondary)" data-ec-mono="">
                          {row.amount} {row.currency} · due {row.expected_receive_date}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                        <StatusDot tone={STATUS_TONE[row.status] ?? 'muted'} />
                        {row.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ConsoleRows>
            )}
          </QueryBody>
        </ConsolePanel>

        {!compactDetail && selectedId ? (
          <FollowupDetail followupId={selectedId} />
        ) : !compactDetail ? (
          <ConsolePanel>
            <div className="flex min-h-44 items-center justify-center text-center text-(--ui-text-tertiary)">
              Select a follow-up to inspect its authoritative detail and history.
            </div>
          </ConsolePanel>
        ) : null}
      </div>

      <Sheet
        onOpenChange={open => {
          if (!open) {
            setSelectedId(null)
          }
        }}
        open={compactDetail && selectedId !== null}
      >
        <SheetContent className="w-[min(90vw,var(--ec-detail-w))] overflow-y-auto sm:max-w-(--ec-detail-w)" side="right">
          <SheetHeader>
            <SheetTitle>Follow-up detail</SheetTitle>
            <SheetDescription>Authoritative record detail and server-authored history.</SheetDescription>
          </SheetHeader>
          <div className="p-3 pt-0">{selectedId ? <FollowupDetail followupId={selectedId} /> : null}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
