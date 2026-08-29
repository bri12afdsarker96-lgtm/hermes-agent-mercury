/**
 * Follow-up page — Presentational View layer.
 *
 * Receives a fully-derived `FollowupPageViewModel`, presentation
 * handlers, and a stable `compactDetail` boolean from the glue. No
 * transport, no useValue, no $whoami — only the VM and the
 * presentation callbacks.
 *
 * W1-A ESLint boundary: no `./transport`, `./fetch-transport`,
 * `./page-kit` controller helpers, `./session` raw $whoami,
 * `./capabilities` permission authority, axios, global `fetch`,
 * `window.hermesDesktop`. The view owns only the imported
 * `@hermes/plugin-sdk` UI primitives and the typed VM.
 */

import {
  EmptyState,
  ErrorState,
  Loader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusDot,
  usePluginI18n,
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import {
  FOLLOWUP_STATUSES,
  type FollowupDetailResp,
  type FollowupHistoryResp,
  type FollowupStatus,
} from './page-followup.controller'
import {
  deriveFollowupDetail,
  deriveFollowupHistory,
} from './page-followup.view-model'
import type { FollowupPageViewModel } from './page-followup.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader, Timeline } from './ui'

interface FollowupDetailViewProps {
  detailData: FollowupDetailResp | undefined
  detailPending: boolean
  detailError: unknown
  historyData: FollowupHistoryResp | undefined
  historyPending: boolean
  historyError: unknown
}

function FollowupDetailView({
  detailData,
  detailPending,
  detailError,
  historyData,
  historyPending,
  historyError,
}: FollowupDetailViewProps) {
  const t = usePluginI18n('enterprise-console')

  if (detailPending) {
    return (
      <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
        <ConsolePanel title="Follow-up detail">
          <Loader />
        </ConsolePanel>
      </div>
    )
  }

  const detailErrorText = detailError instanceof Error ? detailError.message : null
  if (detailErrorText) {
    return (
      <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
        <ConsolePanel title="Follow-up detail">
          <ErrorState description={detailErrorText} title={t('status.error')} />
        </ConsolePanel>
      </div>
    )
  }

  const detailVm = deriveFollowupDetail(detailData?.followup ?? null)
  const detail = detailVm.detail

  if (!detail) {
    return (
      <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
        <ConsolePanel title="Follow-up detail">
          <EmptyState title="—" />
        </ConsolePanel>
      </div>
    )
  }

  const historyVm = deriveFollowupHistory(historyData?.history ?? [])
  const historyErrorText = historyError instanceof Error ? historyError.message : null

  return (
    <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
      <ConsolePanel title="Follow-up detail">
        <dl className="grid grid-cols-[minmax(6.5rem,0.35fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-(--ui-text-secondary)">subject</dt>
          <dd className="truncate font-medium text-(--ui-text-primary)">{detail.businessSubject}</dd>
          <dt className="text-(--ui-text-secondary)">amount</dt>
          <dd className="text-(--ui-text-primary)" data-ec-mono="">
            {detail.amount} {detail.currency}
          </dd>
          <dt className="text-(--ui-text-secondary)">status</dt>
          <dd className="inline-flex items-center gap-1.5 text-(--ui-text-primary)">
            <StatusDot tone={detail.statusTone} />
            {detail.status}
          </dd>
          <dt className="text-(--ui-text-secondary)">expected</dt>
          <dd className="text-(--ui-text-primary)" data-ec-mono="">
            {detail.expectedReceiveDate}
          </dd>
          <dt className="text-(--ui-text-secondary)">received</dt>
          <dd className="text-(--ui-text-primary)" data-ec-mono="">
            {detail.receivedAt ?? '—'}
          </dd>
          <dt className="text-(--ui-text-secondary)">next follow-up</dt>
          <dd className="text-(--ui-text-primary)" data-ec-mono="">
            {detail.nextFollowupAt ?? '—'}
          </dd>
          <dt className="text-(--ui-text-secondary)">owner</dt>
          <dd className="truncate text-(--ui-text-primary)" data-ec-mono="">
            {detail.ownerPrincipalId}
          </dd>
        </dl>
      </ConsolePanel>

      <ConsolePanel divided title="History">
        {historyPending ? (
          <Loader />
        ) : historyErrorText ? (
          <ErrorState description={historyErrorText} title={t('status.error')} />
        ) : historyVm.isEmpty ? (
          <EmptyState title="no history" />
        ) : (
          <div data-testid="console-followup-history">
            <Timeline
              empty="no history"
              events={historyVm.events.map((event) => ({
                description: (
                  <span data-ec-mono="">
                    {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                  </span>
                ),
                id: event.historyId,
                timestamp: event.timestamp,
                title: event.title,
                tone: event.statusTone,
              }))}
              label="Follow-up history"
            />
          </div>
        )}
      </ConsolePanel>
    </div>
  )
}

function FollowupStatusFilter({
  status,
  onChange,
}: {
  status: '' | FollowupStatus
  onChange: (next: '' | FollowupStatus) => void
}) {
  return (
    <label className="flex items-center gap-2 text-(--ui-text-secondary)">
      <span className="sr-only">status filter</span>
      <select
        className="min-h-9 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 text-(--ui-text-primary) outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        data-testid="console-followup-status-filter"
        onChange={(event) => onChange(event.target.value as '' | FollowupStatus)}
        value={status}
      >
        <option value="">all statuses</option>
        {FOLLOWUP_STATUSES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  )
}

export function FollowupView({
  vm,
  status,
  selectedId,
  onSelect,
  onClearSelection,
  detailData,
  detailPending,
  detailError,
  historyData,
  historyPending,
  historyError,
}: {
  vm: FollowupPageViewModel
  status: '' | FollowupStatus
  selectedId: null | string
  onSelect: (id: string) => void
  onClearSelection: () => void
  detailData: FollowupDetailResp | undefined
  detailPending: boolean
  detailError: unknown
  historyData: FollowupHistoryResp | undefined
  historyPending: boolean
  historyError: unknown
}) {
  const t = usePluginI18n('enterprise-console')
  const compactDetail = useCompactDetail()

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-followup"
    >
      <PageHeader
        actions={
          <FollowupStatusFilter
            onChange={(next) => {
              if (next === '' || (FOLLOWUP_STATUSES as readonly FollowupStatus[]).includes(next)) {
                onSelect('')
                onClearSelection()
              }
            }}
            status={status}
          />
        }
        purpose="Track authoritative follow-up records and their server-authored history. Phase-1 is read-only."
        status={<PageStatusBadge status="ready" />}
        title="Business follow-up"
      />

      <div className="grid min-h-0 items-start gap-(--ec-gutter) min-[1440px]:grid-cols-[minmax(var(--ec-list-w),0.9fr)_minmax(var(--ec-detail-w),1.1fr)]">
        <ConsolePanel divided title="Follow-ups">
          {vm.listPending ? (
            <Loader />
          ) : vm.listError ? (
            <ErrorState description={vm.listError} title={t('status.error')} />
          ) : vm.list.isEmpty ? (
            <EmptyState title="no follow-ups" />
          ) : (
            <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-followups">
              {vm.list.rows.map((row) => {
                const isSelected = row.followupId === selectedId

                return (
                  <li key={row.followupId}>
                    <button
                      aria-expanded={isSelected}
                      className={
                        isSelected
                          ? 'flex w-full items-center justify-between gap-3 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none ring-1 ring-(--ui-stroke-secondary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                          : 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                      }
                      data-testid={`console-followup-${row.followupId}`}
                      onClick={() => onSelect(row.followupId)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-(--ui-text-primary)">
                          {row.businessSubject}
                        </span>
                        <span
                          className="mt-0.5 block text-(--ui-text-secondary)"
                          data-ec-mono=""
                        >
                          {row.amount} {row.currency} · due {row.expectedReceiveDate}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                        <StatusDot tone={row.statusTone} />
                        {row.status}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ConsolePanel>

        {!compactDetail && selectedId ? (
          <FollowupDetailView
            detailData={detailData}
            detailError={detailError}
            detailPending={detailPending}
            historyData={historyData}
            historyError={historyError}
            historyPending={historyPending}
          />
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
          side="right"
        >
          <SheetHeader>
            <SheetTitle>Follow-up detail</SheetTitle>
            <SheetDescription>Authoritative record detail and server-authored history.</SheetDescription>
          </SheetHeader>
          <div className="p-3 pt-0">
            {selectedId ? (
              <FollowupDetailView
                detailData={detailData}
                detailError={detailError}
                detailPending={detailPending}
                historyData={historyData}
                historyError={historyError}
                historyPending={historyPending}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * Hook preserved in the view file because it touches the DOM
 * (window.matchMedia). The view file owns DOM-adjacent concerns.
 * It is exported so the glue can drive a stable layout decision
 * separately from the VM.
 */
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