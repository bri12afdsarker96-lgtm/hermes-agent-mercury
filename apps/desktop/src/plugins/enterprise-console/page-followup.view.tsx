/**
 * Follow-up page — Presentational View layer.
 *
 * Receives fully-derived VMs (page list) and presentation callbacks.
 * The selection-bound detail/history surface arrives via the
 * `rightPane` prop as a ReactNode that the glue mounts conditionally
 * with `key={selectedId}`. This file does NOT mount the detail/history
 * itself — the glue binds selection identity === query identity ===
 * render identity via `key={selectedId}`, and the presentational
 * surface (`FollowupSelectedDetailPanel`) renders loading / error /
 * not_implemented / empty / ready states via `QueryBody`.
 *
 * No transport, no useValue, no $whoami. Reuses `QueryBody`,
 * `ConsoleRows`, `fmtIso` from `./page-kit` (W1-B1-REMEDIATION-01 §P12
 * ESLint refinement).
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P9: this file does NOT import from the controller
 *     (`FollowupDetailResp` / `FollowupHistoryResp` etc.). The view
 *     consumes only typed VMs + presentation types.
 *   - §P11: this file reuses `QueryBody` / `ConsoleRows` for the
 *     list panel. The selection-bound detail/history panel uses
 *     `QueryBody` for both detail and history blocks.
 *   - §P15: timestamps are pre-formatted in the VM via `fmtIso`; the
 *     view consumes strings only.
 *   - §P16: history events with no `from_status || to_status` (i.e.
 *     `transitionLabel === null`) render WITHOUT the description
 *     block, matching the pre-split `description === undefined` path.
 *
 * Per W1-B1-REMEDIATION-02:
 *   - §P7: `rightPane` is a ReactNode whatever the glue mounts. The
 *     glue renders it inside either the desktop inline detail area
 *     or the Sheet content area depending on `compactDetail`. Both
 *     contain the SAME selection-bound slot — there is no parent
 *     cached VM, no useEffect relay, no opportunity for the f1
 *     detail to leak under an f2 selection.
 *   - §P4: the selection-bound panel ALWAYS mounts the
 *     `console-followup-detail` wrapper immediately on selection
 *     (via QueryBody's Loader branch). It is never blank
 *     `<div className="min-h-32" />`.
 *   - §P8: detail + history blocks both use `QueryBody` for honest
 *     loading / error / not_implemented / empty / ready semantics.
 *   - §P9: this file does NOT import the controller. Status
 *     (`'' | FollowupStatus`) and the canonical options list are
 *     imported from `./page-followup.view-model` (a presentation-
 *     safe re-export).
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusDot,
} from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  FOLLOWUP_STATUS_VALUES,
  type FollowupDetailViewModel,
  type FollowupHistoryViewModel,
  type FollowupListView,
  type FollowupStatus,
} from './page-followup.view-model'
import {
  ConsoleRows,
  QueryBody,
} from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader, Timeline } from './ui'

interface FollowupViewProps {
  list: FollowupListView
  listPending: boolean
  listError: unknown
  rightPane: ReactNode
  isReady: boolean
  selectedId: null | string
  status: '' | FollowupStatus
  statusOptions: readonly FollowupStatus[]
  title: string
  onSelect: (id: string) => void
  onClearSelection: () => void
  onStatusChange: (next: '' | FollowupStatus) => void
}

function useCompactDetail(): boolean {
  const [compact, setCompact] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1439px)').matches
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

function FollowupStatusFilter({
  status,
  options,
  onChange,
}: {
  status: '' | FollowupStatus
  options: readonly FollowupStatus[]
  onChange: (next: '' | FollowupStatus) => void
}) {
  return (
    <label className="flex items-center gap-2 text-(--ui-text-secondary)">
      <span className="sr-only">status filter</span>
      <select
        className="min-h-9 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 text-(--ui-text-primary) outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        data-testid="console-followup-status-filter"
        onChange={(event) => {
          const next = event.target.value

          if (next === '' || (options as readonly string[]).includes(next)) {
            onChange(next as '' | FollowupStatus)
          }
        }}
        value={status}
      >
        <option value="">all statuses</option>
        {options.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  )
}

function FollowupDetailBlock({ detail }: { detail: FollowupDetailViewModel }) {
  const d = detail.detail

  return (
    <dl className="grid grid-cols-[minmax(6.5rem,0.35fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
      <dt className="text-(--ui-text-secondary)">subject</dt>
      <dd className="truncate font-medium text-(--ui-text-primary)">
        {d?.businessSubject ?? '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">amount</dt>
      <dd className="text-(--ui-text-primary)" data-ec-mono="">
        {d ? `${d.amount} ${d.currency}` : '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">status</dt>
      <dd className="inline-flex items-center gap-1.5 text-(--ui-text-primary)">
        {d ? <StatusDot tone={d.statusTone} /> : null}
        {d?.status ?? '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">expected</dt>
      <dd className="text-(--ui-text-primary)" data-ec-mono="">
        {d?.expectedReceiveDate ?? '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">received</dt>
      <dd className="text-(--ui-text-primary)" data-ec-mono="">
        {d?.receivedAt ?? '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">next follow-up</dt>
      <dd className="text-(--ui-text-primary)" data-ec-mono="">
        {d?.nextFollowupAt ?? '—'}
      </dd>
      <dt className="text-(--ui-text-secondary)">owner</dt>
      <dd className="truncate text-(--ui-text-primary)" data-ec-mono="">
        {d?.ownerPrincipalId ?? '—'}
      </dd>
    </dl>
  )
}

function FollowupHistoryBlock({ history }: { history: FollowupHistoryViewModel }) {
  if (history.isEmpty) {
    return <EmptyStateTitle title="no history" />
  }

  return (
    <div data-testid="console-followup-history">
      <Timeline
        empty="no history"
        events={history.events.map((event) => ({
          description:
            event.transitionLabel != null ? (
              <span data-ec-mono="">{event.transitionLabel}</span>
            ) : undefined,
          id: event.historyId,
          timestamp: event.timestamp,
          title: event.title,
          tone: event.statusTone,
        }))}
        label="Follow-up history"
      />
    </div>
  )
}

function EmptyStateTitle({ title }: { title: string }) {
  return <div className="p-3 text-(--ui-text-secondary)">{title}</div>
}

/**
 * Per W1-B1-REMEDIATION-02 §P4 + §P8:
 * The selection-bound detail/history panel always renders the
 * `console-followup-detail` testid wrapper on mount. The detail and
 * history blocks each use `QueryBody` for honest loading / error /
 * not_implemented / empty / ready semantics. The panel receives the
 * loading + error state for each query as separate props (not as a
 * cached VM) so a server error is never rendered as 'no history'.
 *
 * This panel does NOT call any controller hooks — the
 * `FollowupSelectedDetailContainer` (in the glue) is responsible for
 * resolving the queries and pushing the pre-derived VMs down.
 */
export function FollowupSelectedDetailPanel({
  detail,
  detailIsPending,
  detailError,
  history,
  historyIsPending,
  historyError,
}: {
  detail: FollowupDetailViewModel
  detailIsPending: boolean
  detailError: unknown
  history: FollowupHistoryViewModel
  historyIsPending: boolean
  historyError: unknown
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-(--ec-gutter)"
      data-testid="console-followup-detail"
    >
      <ConsolePanel title="Follow-up detail">
        <QueryBody
          emptyText="—"
          isEmpty={(data: { detail: unknown }) => data.detail == null}
          query={{
            data: { detail: detail.detail },
            error: detailError,
            isPending: detailIsPending && detail.detail == null,
          }}
        >
          {() => <FollowupDetailBlock detail={detail} />}
        </QueryBody>
      </ConsolePanel>
      <ConsolePanel divided title="History">
        <QueryBody
          emptyText="no history"
          isEmpty={(data: { history: { historyId: string }[] }) =>
            data.history.length === 0
          }
          query={{
            data: { history: history.events },
            error: historyError,
            isPending:
              historyIsPending && (history.events.length === 0 || history.isEmpty),
          }}
        >
          {() => <FollowupHistoryBlock history={history} />}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}

export function FollowupView({
  list,
  listPending,
  listError,
  rightPane,
  selectedId,
  status,
  statusOptions,
  title,
  onSelect,
  onClearSelection,
  onStatusChange,
}: FollowupViewProps) {
  const compactDetail = useCompactDetail()
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  void FOLLOWUP_STATUS_VALUES

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-followup"
    >
      <PageHeader
        actions={
          <FollowupStatusFilter
            onChange={onStatusChange}
            options={statusOptions}
            status={status}
          />
        }
        purpose="Track authoritative follow-up records and their server-authored history. Phase-1 is read-only."
        status={<PageStatusBadge status="ready" />}
        title={title}
      />

      <div className="grid min-h-0 items-start gap-(--ec-gutter) min-[1440px]:grid-cols-[minmax(var(--ec-list-w),0.9fr)_minmax(var(--ec-detail-w),1.1fr)]">
        <ConsolePanel divided title="Follow-ups">
          <QueryBody
            emptyText="no follow-ups"
            isEmpty={(data: { followups: unknown[] }) => data.followups.length === 0}
            query={{
              data:
                list.isEmpty && listError == null
                  ? { followups: [] }
                  : { followups: list.rows },
              error: listError ?? null,
              isPending: listPending,
            }}
          >
            {() => (
              <ConsoleRows testId="console-followups">
                {list.rows.map((row) => (
                  <li key={row.followupId}>
                    <button
                      aria-expanded={row.followupId === selectedId}
                      className={
                        row.followupId === selectedId
                          ? 'flex w-full items-center justify-between gap-3 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none ring-1 ring-(--ui-stroke-secondary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                          : 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                      }
                      data-testid={`console-followup-${row.followupId}`}
                      onClick={(event) => {
                        selectedRowRef.current = event.currentTarget
                        onSelect(row.followupId)
                      }}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-(--ui-text-primary)">
                          {row.businessSubject}
                        </span>
                        <span className="mt-0.5 block text-(--ui-text-secondary)" data-ec-mono="">
                          {row.amount} {row.currency} · due {row.expectedReceiveDate}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                        <StatusDot tone={row.statusTone} />
                        {row.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ConsoleRows>
            )}
          </QueryBody>
        </ConsolePanel>

        {!compactDetail && rightPane ? (
          rightPane
        ) : !compactDetail ? (
          <ConsolePanel>
            <div className="flex min-h-44 items-center justify-center text-center text-(--ui-text-tertiary)">
              Select a follow-up to inspect its authoritative detail and history.
            </div>
          </ConsolePanel>
        ) : null}
      </div>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            onClearSelection()
          }
        }}
        open={compactDetail && selectedId !== null}
      >
        <SheetContent
          className="w-[min(90vw,var(--ec-detail-w))] overflow-y-auto sm:max-w-(--ec-detail-w)"
          onCloseAutoFocus={(event) => {
            // Restore keyboard focus to the follow-up row that opened the
            // sheet. The controlled-open Sheet has no DialogTrigger for the
            // primitive to track, so its default close-restore lands on
            // <body> and keyboard users lose their place (observed in the
            // packaged keyboard trace). Keep the actual opening element,
            // rather than selection state, because closing clears selectedId.
            const trigger = selectedRowRef.current

            if (trigger?.isConnected) {
              event.preventDefault()
              trigger.focus()
            }
          }}
          side="right"
        >
          <SheetHeader>
            <SheetTitle>Follow-up detail</SheetTitle>
            <SheetDescription>Authoritative record detail and server-authored history.</SheetDescription>
          </SheetHeader>
          <div className="p-3 pt-0">{selectedId ? rightPane : null}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
