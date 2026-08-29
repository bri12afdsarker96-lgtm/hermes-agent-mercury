/**
 * Audit evidence page (SC4) — real `/api/audit-list|detail|correlate` reads.
 * STRICTLY READ-ONLY: audit is append-only evidence, never re-execution. This
 * page carries NO replay / re-execute / retry control and imports nothing from
 * `actions.tsx` — the server exposes no audit write route and must not.
 *
 * `audit.read` is tenant_admin-only + undelegatable. A bare super_admin (no
 * tenant view) would 400 on the server, so we surface a "pick a tenant" notice
 * rather than firing a doomed request. Timestamps are ISO-8601 strings (fmtIso,
 * never fmtEpoch). Error branches key on err.status (400/404/503 all collapse to
 * HermesApiError code 'error').
 */

import { EmptyState, ErrorState, Input, Loader, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { HermesApiError } from './fetch-transport'
import { ConsoleRows, fmtIso, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { PageStatusBadge } from './status-badge'
import { PageHeader } from './ui'

export interface AuditEvent {
  action: string
  actor: null | string
  event_id: string
  payload_ref: unknown
  resource_ref: null | string
  ts: string
}

interface AuditListResp {
  events: AuditEvent[]
}
interface AuditDetailResp {
  event: AuditEvent
}

function auditListPath(action: string, resourceRef: string): string {
  const params = new URLSearchParams()

  if (action.trim()) {
    params.set('action', action.trim())
  }

  if (resourceRef.trim()) {
    params.set('resource_ref', resourceRef.trim())
  }

  const qs = params.toString()

  return qs ? `/api/audit-list?${qs}` : '/api/audit-list'
}

/** Distinct honest states for the collapsed error taxonomy (branch on status,
 *  not code — 400/404/503 all arrive as HermesApiError code 'error'). */
function auditErrorState(error: unknown): null | ReturnType<typeof EmptyState> {
  if (error instanceof HermesApiError) {
    if (error.status === 404) {
      return <EmptyState title="event not found" />
    }

    if (error.status === 400) {
      return <EmptyState title="malformed event id" />
    }

    if (error.status === 503) {
      return <ErrorState description="the audit authority is unavailable" title="audit unavailable" />
    }
  }

  return null
}

function AuditEventFields({ event }: { event: AuditEvent }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">action</dt>
      <dd className="truncate">{event.action}</dd>
      <dt className="text-muted-foreground">actor</dt>
      <dd className="truncate">{event.actor ?? '—'}</dd>
      <dt className="text-muted-foreground">time</dt>
      <dd>{fmtIso(event.ts)}</dd>
      <dt className="text-muted-foreground">resource</dt>
      <dd className="truncate">{event.resource_ref ?? '—'}</dd>
    </dl>
  )
}

function AuditDetail({ eventId }: { eventId: string }) {
  const query = useConsoleQuery<AuditDetailResp>(
    ['enterprise-console', 'audit-detail', eventId],
    `/api/audit-detail?event_id=${encodeURIComponent(eventId)}`,
    0
  )

  if (query.isPending) {
    return <Loader />
  }

  if (query.error) {
    return auditErrorState(query.error) ?? <ErrorState description={String((query.error as Error).message)} title="error" />
  }

  const event = (query.data as AuditDetailResp).event

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="console-audit-detail">
      <AuditEventFields event={event} />
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">payload (evidence, read-only)</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs">{JSON.stringify(event.payload_ref, null, 2)}</pre>
      </details>
    </div>
  )
}

function AuditChain({ events }: { events: AuditEvent[] }) {
  return (
    <ConsoleRows testId="console-audit-correlate">
      {events.map(event => (
        <li className="rounded-md border border-border px-2 py-1 text-xs" key={event.event_id}>
          <div className="flex items-center justify-between gap-2">
            <span>{event.action}</span>
            <span className="text-muted-foreground">{fmtIso(event.ts)}</span>
          </div>
          <div className="text-muted-foreground">{event.actor ?? '—'}</div>
        </li>
      ))}
    </ConsoleRows>
  )
}

function AuditBody() {
  const [action, setAction] = useState('')
  const [resourceRef, setResourceRef] = useState('')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const [correlateRef, setCorrelateRef] = useState<null | string>(null)

  const listQuery = useConsoleQuery<AuditListResp>(
    ['enterprise-console', 'audit-list', action, resourceRef],
    auditListPath(action, resourceRef)
  )
  const chainQuery = useConsoleQuery<AuditListResp>(
    ['enterprise-console', 'audit-correlate', correlateRef ?? ''],
    `/api/audit-correlate?resource_ref=${encodeURIComponent(correlateRef ?? '')}`,
    0
  )

  return (
    <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-audit">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-testid="console-audit-action"
          onChange={event => setAction(event.target.value)}
          placeholder="action (exact)"
          value={action}
        />
        <Input
          data-testid="console-audit-resource"
          onChange={event => setResourceRef(event.target.value)}
          placeholder="resource_ref (exact)"
          value={resourceRef}
        />
      </div>

      {correlateRef ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>evidence chain (oldest → newest) · {correlateRef}</span>
            <button
              className="underline"
              data-testid="console-audit-correlate-close"
              onClick={() => setCorrelateRef(null)}
              type="button"
            >
              back to list
            </button>
          </div>
          {chainQuery.isPending ? (
            <Loader />
          ) : chainQuery.error ? (
            (auditErrorState(chainQuery.error) ?? (
              <ErrorState description={String((chainQuery.error as Error).message)} title="error" />
            ))
          ) : (chainQuery.data as AuditListResp).events.length === 0 ? (
            <EmptyState title="no correlated events" />
          ) : (
            <AuditChain events={(chainQuery.data as AuditListResp).events} />
          )}
        </div>
      ) : listQuery.isPending ? (
        <Loader />
      ) : listQuery.error ? (
        (auditErrorState(listQuery.error) ?? (
          <ErrorState description={String((listQuery.error as Error).message)} title="error" />
        ))
      ) : (listQuery.data as AuditListResp).events.length === 0 ? (
        <EmptyState title="no audit events" />
      ) : (
        <ConsoleRows testId="console-audit">
          {(listQuery.data as AuditListResp).events.map(event => (
            <li className="rounded-md border border-border px-2 py-1.5 text-sm" key={event.event_id}>
              <div className="flex items-center justify-between gap-2">
                <button
                  className="min-w-0 text-left"
                  data-testid={`console-audit-${event.event_id}`}
                  onClick={() => setSelectedId(id => (id === event.event_id ? null : event.event_id))}
                  type="button"
                >
                  <span className="block truncate">{event.action}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtIso(event.ts)} · {event.actor ?? '—'} · {event.resource_ref ?? '—'}
                  </span>
                </button>
                {event.resource_ref ? (
                  <button
                    className="shrink-0 text-xs underline"
                    data-testid={`console-audit-correlate-${event.event_id}`}
                    onClick={() => setCorrelateRef(event.resource_ref)}
                    type="button"
                  >
                    correlate
                  </button>
                ) : null}
              </div>
              {event.event_id === selectedId ? <AuditDetail eventId={event.event_id} /> : null}
            </li>
          ))}
        </ConsoleRows>
      )}
    </div>
  )
}

function AuditFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)">
      <PageHeader
        purpose="Inspect immutable audit evidence and correlate server-authored events. No replay or mutation is available here."
        status={<PageStatusBadge status="ready" />}
        title="Audit evidence"
      />
      {children}
    </div>
  )
}

export function AuditPage() {
  const who = useValue($whoami)

  if (who && who.role === 'super_admin' && !who.tenant_id) {
    return (
      <AuditFrame>
        <div data-page-status="ready" data-testid="console-page-audit">
          <EmptyState description="select a tenant view (?tenant=) to read audit evidence" title="pick a tenant" />
        </div>
      </AuditFrame>
    )
  }

  return (
    <AuditFrame>
      <AuditBody />
    </AuditFrame>
  )
}
