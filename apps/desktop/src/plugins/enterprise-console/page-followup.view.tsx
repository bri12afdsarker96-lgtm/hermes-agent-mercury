/**
 * Follow-up page (SC1) — Presentational view.
 *
 * Receives a FollowupViewModel + selection / filter callbacks + 2
 * formatter callbacks (fmtIso for ISO timestamps) + matchMedia
 * callback for the responsive sheet switch.
 *
 * NO mutation handlers — Phase-1 is read-only by design.
 *
 * Wave 1 / Step 14 of W5-B0 contract freeze.
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusDot,
} from '@hermes/plugin-sdk'

import { ConsoleRows } from './page-kit'
import type { FollowupViewModel } from './page-followup.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader, Timeline } from './ui'
import type { FollowupStatus } from './page-followup.controller'
import { FOLLOWUP_STATUSES } from './page-followup.controller'

export interface FollowupViewProps {
  vm: FollowupViewModel
  /** Current status filter value. */
  statusFilter: '' | FollowupStatus
  /** True when the responsive breakpoint collapses the detail into a
   *  bottom-sheet (≤1439px viewport). The view never reads
   *  window.matchMedia directly — the glue supplies the boolean. */
  compactDetail: boolean
  onStatusFilterChange: (value: '' | FollowupStatus) => void
  onSelectFollowup: (followupId: string) => void
  onCloseSheet: () => void
  fmtIso: (iso: null | string | undefined) => string
}

function StatusFilterSelect({
  value,
  onChange,
}: {
  value: '' | FollowupStatus
  onChange: FollowupViewProps['onStatusFilterChange']
}) {
  return (
    <label className="flex items-center gap-2 text-(--ui-text-secondary)">
      <span className="sr-only">status filter</span>
      <select
        className="min-h-9 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 text-(--ui-text-primary) outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        data-testid="console-followup-status-filter"
        onChange={event => onChange(event.target.value as '' | FollowupStatus)}
        value={value}
      >
        <option value="">all statuses</option>
        {FOLLOWUP_STATUSES.map(statusOption => (
          <option key={statusOption} value={statusOption}>
            {statusOption}
          </option>
        ))}
      </select>
    </label>
  )
}

function FollowupDetail({
  vm,
  fmtIso,
}: {
  vm: FollowupViewModel
  fmtIso: FollowupViewProps['fmtIso']
}) {
  if (vm.detailFields.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-col gap-(--ec-gutter)" data-testid="console-followup-detail">
      <ConsolePanel title="Follow-up detail">
        <dl className="grid grid-cols-[minmax(6.5rem,0.35fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
          {vm.detailFields.map(field => {
            // 'received' and 'next follow-up' carry ISO timestamps; route them
            // through fmtIso. Others are already display-ready.
            const needsFmt =
              field.label === 'received' || field.label === 'next follow-up'
            const displayValue = needsFmt ? fmtIso(field.value === '—' ? null : field.value) : field.value

            return (
              <div className="contents" key={field.label}>
                <dt className="text-(--ui-text-secondary)">{field.label}</dt>
                <dd
                  className="text-(--ui-text-primary)"
                  data-ec-mono={field.mono ? '' : undefined}
                >
                  {displayValue}
                </dd>
              </div>
            )
          })}
        </dl>
      </ConsolePanel>

      <ConsolePanel divided title="History">
        {vm.historyEmpty ? (
          <Timeline empty="no history" events={[]} label="Follow-up history" />
        ) : (
          <div data-testid="console-followup-history">
            <Timeline
              empty="no history"
              events={vm.historyEvents.map(event => ({
                description: event.description ? (
                  <span data-ec-mono="">{event.description}</span>
                ) : undefined,
                id: event.id,
                timestamp: event.timestamp,
                title: event.title,
                tone: event.tone,
              }))}
              label="Follow-up history"
            />
          </div>
        )}
      </ConsolePanel>
    </div>
  )
}

export function FollowupView({
  vm,
  statusFilter,
  compactDetail,
  onStatusFilterChange,
  onSelectFollowup,
  onCloseSheet,
  fmtIso,
}: FollowupViewProps) {
  const showInlineDetail = !compactDetail && vm.rows.some(row => row.isSelected)

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-followup"
    >
      <PageHeader
        actions={<StatusFilterSelect onChange={onStatusFilterChange} value={statusFilter} />}
        purpose="Track authoritative follow-up records and their server-authored history. Phase-1 is read-only."
        status={<PageStatusBadge status="ready" />}
        title="Business follow-up"
      />

      <div className="grid min-h-0 items-start gap-(--ec-gutter) min-[1440px]:grid-cols-[minmax(var(--ec-list-w),0.9fr)_minmax(var(--ec-detail-w),1.1fr)]">
        <ConsolePanel divided title="Follow-ups">
          {vm.listEmpty ? (
            <p className="text-(--ui-text-tertiary)" data-testid="console-followups-empty">
              no follow-ups
            </p>
          ) : (
            <ConsoleRows testId="console-followups">
              {vm.rows.map(row => (
                <li key={row.followupId}>
                  <button
                    aria-expanded={row.isSelected}
                    className={
                      row.isSelected
                        ? 'flex w-full items-center justify-between gap-3 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none ring-1 ring-(--ui-stroke-secondary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                        : 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                    }
                    data-testid={`console-followup-${row.followupId}`}
                    onClick={() => onSelectFollowup(row.followupId)}
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
                      <StatusDot tone={row.tone} />
                      {row.status}
                    </span>
                  </button>
                </li>
              ))}
            </ConsoleRows>
          )}
        </ConsolePanel>

        {showInlineDetail ? (
          <FollowupDetail fmtIso={fmtIso} vm={vm} />
        ) : !compactDetail ? (
          <ConsolePanel>
            <div className="flex min-h-44 items-center justify-center text-center text-(--ui-text-tertiary)">
              Select a follow-up to inspect its authoritative detail and history.
            </div>
          </ConsolePanel>
        ) : null}
      </div>

      <Sheet onOpenChange={open => { if (!open) { onCloseSheet() } }} open={compactDetail && vm.rows.some(row => row.isSelected)}>
        <SheetContent className="w-[min(90vw,var(--ec-detail-w))] overflow-y-auto sm:max-w-(--ec-detail-w)" side="right">
          <SheetHeader>
            <SheetTitle>Follow-up detail</SheetTitle>
            <SheetDescription>Authoritative record detail and server-authored history.</SheetDescription>
          </SheetHeader>
          <div className="p-3 pt-0">
            {vm.rows.some(row => row.isSelected) ? (
              <FollowupDetail fmtIso={fmtIso} vm={vm} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}