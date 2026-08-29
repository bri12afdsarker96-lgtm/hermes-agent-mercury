/**
 * Audit evidence page (SC4) — Presentational view.
 *
 * Receives an AuditViewModel + click handlers + fmtIso callback. Renders
 * 1 of 12 view modes picked by the view-model (list / list-empty /
 * list-error / chain-* / detail-* / pick-tenant / loading).
 *
 * NO replay / re-execute / retry controls — read-only evidence.
 * NO imports from `./actions` — server has no audit write route.
 *
 * Wave 1 / Step 12 of W5-B0 contract freeze.
 */

import { useState } from 'react'

import { EmptyState, ErrorState, Input, Loader } from '@hermes/plugin-sdk'

import type { AuditViewModel } from './page-audit.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsoleRows } from './page-kit'
import { PageHeader } from './ui'

export interface AuditViewProps {
  vm: AuditViewModel
  onFilterChange: (action: string, resourceRef: string) => void
  onSelectEvent: (eventId: string | null) => void
  onCorrelateResource: (resourceRef: string | null) => void
  fmtIso: (iso: null | string | undefined) => string
}

function AuditFilterBar({ onFilterChange }: { onFilterChange: AuditViewProps['onFilterChange'] }) {
  const [action, setAction] = useState('')
  const [resourceRef, setResourceRef] = useState('')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        data-testid="console-audit-action"
        onChange={event => {
          setAction(event.target.value)
          onFilterChange(event.target.value, resourceRef)
        }}
        placeholder="action (exact)"
        value={action}
      />
      <Input
        data-testid="console-audit-resource"
        onChange={event => {
          setResourceRef(event.target.value)
          onFilterChange(action, event.target.value)
        }}
        placeholder="resource_ref (exact)"
        value={resourceRef}
      />
    </div>
  )
}

function DetailView({
  vm,
  onSelectEvent,
  fmtIso,
}: {
  vm: AuditViewModel
  onSelectEvent: AuditViewProps['onSelectEvent']
  fmtIso: AuditViewProps['fmtIso']
}) {
  if (!vm.detail) {
    return null
  }

  const detail = vm.detail

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="console-audit-detail">
      <button
        className="self-end text-xs underline"
        data-testid="console-audit-detail-close"
        onClick={() => onSelectEvent(null)}
        type="button"
      >
        back
      </button>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">action</dt>
        <dd className="truncate">{detail.action}</dd>
        <dt className="text-muted-foreground">actor</dt>
        <dd className="truncate">{detail.actorDisplay}</dd>
        <dt className="text-muted-foreground">time</dt>
        <dd>{fmtIso(detail.ts)}</dd>
        <dt className="text-muted-foreground">resource</dt>
        <dd className="truncate">{detail.resourceDisplay}</dd>
      </dl>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          payload (evidence, read-only)
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs">{detail.payloadJson}</pre>
      </details>
    </div>
  )
}

function ChainView({
  vm,
  onCorrelateResource,
  fmtIso,
}: {
  vm: AuditViewModel
  onCorrelateResource: AuditViewProps['onCorrelateResource']
  fmtIso: AuditViewProps['fmtIso']
}) {
  const resourceRef = vm.chainRows.length > 0 && vm.chainRows[0]
    ? vm.chainRows[0].action
    : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>evidence chain (oldest → newest)</span>
        <button
          className="underline"
          data-testid="console-audit-correlate-close"
          onClick={() => onCorrelateResource(null)}
          type="button"
        >
          back to list
        </button>
      </div>
      {vm.chainRows.length === 0 ? (
        <EmptyState title="no correlated events" />
      ) : (
        <ConsoleRows testId="console-audit-correlate">
          {vm.chainRows.map((row, idx) => (
            <li className="rounded-md border border-border px-2 py-1 text-xs" key={`${idx}-${row.ts}`}>
              <div className="flex items-center justify-between gap-2">
                <span>{row.action}</span>
                <span className="text-muted-foreground">{fmtIso(row.ts)}</span>
              </div>
              <div className="text-muted-foreground">{row.actor ?? '—'}</div>
            </li>
          ))}
        </ConsoleRows>
      )}
      {resourceRef === null ? null : null}
    </div>
  )
}

function ListView({
  vm,
  onSelectEvent,
  onCorrelateResource,
  fmtIso,
}: {
  vm: AuditViewModel
  onSelectEvent: AuditViewProps['onSelectEvent']
  onCorrelateResource: AuditViewProps['onCorrelateResource']
  fmtIso: AuditViewProps['fmtIso']
}) {
  return (
    <ConsoleRows testId="console-audit">
      {vm.listRows.map(row => (
        <li className="rounded-md border border-border px-2 py-1.5 text-sm" key={row.eventId}>
          <div className="flex items-center justify-between gap-2">
            <button
              className="min-w-0 text-left"
              data-testid={`console-audit-${row.eventId}`}
              onClick={() => onSelectEvent(row.eventId)}
              type="button"
            >
              <span className="block truncate">{row.action}</span>
              <span className="block text-xs text-muted-foreground">
                {fmtIso(row.ts)} · {row.actor ?? '—'} · {row.resourceRef ?? '—'}
              </span>
            </button>
            {row.hasResourceRef && row.resourceRef ? (
              <button
                className="shrink-0 text-xs underline"
                data-testid={`console-audit-correlate-${row.eventId}`}
                onClick={() => onCorrelateResource(row.resourceRef)}
                type="button"
              >
                correlate
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ConsoleRows>
  )
}

export function AuditView({ vm, onFilterChange, onSelectEvent, onCorrelateResource, fmtIso }: AuditViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)">
      <PageHeader
        purpose="Inspect immutable audit evidence and correlate server-authored events. No replay or mutation is available here."
        status={<PageStatusBadge status="ready" />}
        title="Audit evidence"
      />

      {vm.mode === 'pick-tenant' ? (
        <EmptyState
          description="select a tenant view (?tenant=) to read audit evidence"
          title="pick a tenant"
        />
      ) : (
        <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-audit">
          <AuditFilterBar onFilterChange={onFilterChange} />

          {vm.mode === 'detail-loading' ? (
            <Loader />
          ) : vm.mode === 'detail-error' ? (
            vm.detailError?.kind === 'event-not-found' ? (
              <EmptyState title="event not found" />
            ) : vm.detailError?.kind === 'malformed-id' ? (
              <EmptyState title="malformed event id" />
            ) : vm.detailError?.kind === 'audit-unavailable' ? (
              <ErrorState description="the audit authority is unavailable" title="audit unavailable" />
            ) : (
              <ErrorState description={vm.detailError?.message ?? 'error'} title="error" />
            )
          ) : vm.mode === 'detail-ready' ? (
            <DetailView fmtIso={fmtIso} onSelectEvent={onSelectEvent} vm={vm} />
          ) : vm.mode === 'chain-loading' ? (
            <Loader />
          ) : vm.mode === 'chain-error' ? (
            vm.chainError?.kind === 'event-not-found' ? (
              <EmptyState title="event not found" />
            ) : vm.chainError?.kind === 'audit-unavailable' ? (
              <ErrorState description="the audit authority is unavailable" title="audit unavailable" />
            ) : (
              <ErrorState description={vm.chainError?.message ?? 'error'} title="error" />
            )
          ) : vm.mode === 'chain-empty' ? (
            <EmptyState title="no correlated events" />
          ) : vm.mode === 'chain-ready' ? (
            <ChainView fmtIso={fmtIso} onCorrelateResource={onCorrelateResource} vm={vm} />
          ) : vm.mode === 'loading' ? (
            <Loader />
          ) : vm.mode === 'list-error' ? (
            vm.listError?.kind === 'audit-unavailable' ? (
              <ErrorState description="the audit authority is unavailable" title="audit unavailable" />
            ) : (
              <ErrorState description={vm.listError?.message ?? 'error'} title="error" />
            )
          ) : vm.mode === 'list-empty' ? (
            <EmptyState title="no audit events" />
          ) : vm.mode === 'list' ? (
            <ListView fmtIso={fmtIso} onCorrelateResource={onCorrelateResource} onSelectEvent={onSelectEvent} vm={vm} />
          ) : null}
        </div>
      )}
    </div>
  )
}