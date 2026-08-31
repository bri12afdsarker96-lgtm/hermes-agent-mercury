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
 *
 * P1-VIS-V3 — visual productization. Adopted the approved `Timeline`
 * primitive for the audit log and the evidence chain (both were rendered as
 * hand-rolled `<ul>` rows in V0). The page now reads as an audit surface: rail
 * + dot + monochrome timestamp + actor + resource. All four SC4 frozen
 * contract anchors are preserved verbatim:
 *   - `console-audit` (list)
 *   - `console-audit-detail` (event detail panel)
 *   - `console-audit-correlate` (evidence chain)
 *   - the literal strings `malformed event id`, `event not found`,
 *     `audit unavailable` in the four error states.
 * No replay / re-execute / retry / resend control was added.
 *
 * V3-REMEDIATION-01 · V3-R2 — Visible interaction restored.
 *
 * The initial V3 productisation moved the audit-event list into the shared
 * Timeline primitive, but Timeline is a static, non-interactive display —
 * the visible action affordances the V0 row / action semantics exposed
 * (`console-audit-<event_id>` for detail toggle, `console-audit-correlate-<event_id>`
 * for evidence chain) only survived as sr-only compatibility DOM. A screen
 * reader user could still find them; a sighted user could not. That is a
 * functional regression, not a visual difference.
 *
 * The page now splits the surface into two deliberately distinct layers:
 *
 *   - The main audit-event list (V0 row / action semantics) is rendered as a
 *     visible interactive row per event. Each row carries the row's primary
 *     detail affordance (`console-audit-<event_id>`, a real `<button>`
 *     keyboard-focusable, click to toggle detail) and, when the event has a
 *     `resource_ref`, the secondary correlation affordance
 *     (`console-audit-correlate-<event_id>`, also a real `<button>`). These
 *     buttons are NOT descendants of any `sr-only` element — that is the
 *     regression gate the behavior tests now hold.
 *
 *   - The evidence chain (correlate result) keeps the shared Timeline
 *     primitive because that surface is non-interactive — the user has
 *     already navigated to it via the visible correlate button and only
 *     needs to read it.
 *
 * The four SC4 frozen error states (`malformed event id`, `event not found`,
 * `audit unavailable`) are preserved by `auditErrorState`. No replay /
 * retry / resend / re-execute control is introduced. The page imports
 * nothing from `./actions.tsx`. No new write route is requested.
 */

import { EmptyState, ErrorState, Input, Loader, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { HermesApiError } from './fetch-transport'
import { fmtIso, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader, Timeline, type TimelineEvent } from './ui'

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

/** Map a server event onto the Timeline primitive the console ships. */
function toTimelineEvent(event: AuditEvent): TimelineEvent {
  return {
    description:
      event.resource_ref === null && event.actor === null
        ? '—'
        : [
            event.actor ? `actor ${event.actor}` : null,
            event.resource_ref ? `resource ${event.resource_ref}` : null
          ]
            .filter(Boolean)
            .join(' · '),
    id: event.event_id,
    timestamp: event.ts,
    title: event.action
  }
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
      <dd data-ec-mono="">{fmtIso(event.ts)}</dd>
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
    <div
      className="mt-2 flex flex-col gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-tertiary) p-3"
      data-testid="console-audit-detail"
    >
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
    <div className="mt-1" data-testid="console-audit-correlate">
      <Timeline events={events.map(toTimelineEvent)} label="Evidence chain" />
    </div>
  )
}

/**
 * Visible, interactive audit-event row. The action / correlate buttons are
 * real `<button>` elements with stable `data-testid`s and live INSIDE this
 * visible row — they are NOT descendants of any `sr-only` ancestor. The
 * `closest('.sr-only')` invariant is part of the V3-R2 acceptance test.
 */
function AuditEventRow({
  event,
  isSelected,
  onSelect,
  onCorrelate
}: {
  event: AuditEvent
  isSelected: boolean
  onSelect: (id: string) => void
  onCorrelate: (resourceRef: string) => void
}) {
  const canCorrelate = Boolean(event.resource_ref)

  return (
    <li
      className="flex flex-col gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-tertiary) p-3"
      data-audit-event-id={event.event_id}
    >
      <div className="flex flex-wrap items-start gap-3">
        <button
          aria-expanded={isSelected}
          aria-label={`Toggle detail for ${event.action}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid={`console-audit-${event.event_id}`}
          onClick={() => onSelect(event.event_id)}
          type="button"
        >
          <StatusDot tone={isSelected ? 'good' : 'muted'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-(--ui-text-primary)">{event.action}</span>
            <span className="block text-xs text-(--ui-text-tertiary)">
              <span data-ec-mono="">{fmtIso(event.ts)}</span>
              {' · '}
              {event.actor ?? '—'}
              {event.resource_ref ? (
                <>
                  {' · '}
                  <span data-ec-mono="">{event.resource_ref}</span>
                </>
              ) : null}
            </span>
          </span>
        </button>
        {canCorrelate ? (
          <button
            aria-label={`Open evidence chain for ${event.resource_ref}`}
            className="text-xs underline text-(--ui-text-secondary)"
            data-testid={`console-audit-correlate-${event.event_id}`}
            onClick={() => onCorrelate(event.resource_ref as string)}
            type="button"
          >
            correlate
          </button>
        ) : null}
      </div>
      {isSelected ? <AuditDetail eventId={event.event_id} /> : null}
    </li>
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
    <div className="flex flex-col gap-(--ec-gutter)" data-page-status="ready" data-testid="console-page-audit">
      <ConsolePanel divided title="Filter">
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
      </ConsolePanel>

      {correlateRef ? (
        <ConsolePanel
          action={
            <button
              className="text-xs underline"
              data-testid="console-audit-correlate-close"
              onClick={() => setCorrelateRef(null)}
              type="button"
            >
              back to list
            </button>
          }
          divided
          title={`Evidence chain · ${correlateRef}`}
        >
          <p className="mb-2 text-xs text-(--ui-text-tertiary)">oldest → newest · evidence-only, no replay</p>
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
        </ConsolePanel>
      ) : (
        <ConsolePanel divided title="Audit events">
          {listQuery.isPending ? (
            <Loader />
          ) : listQuery.error ? (
            (auditErrorState(listQuery.error) ?? (
              <ErrorState description={String((listQuery.error as Error).message)} title="error" />
            ))
          ) : (listQuery.data as AuditListResp).events.length === 0 ? (
            <EmptyState title="no audit events" />
          ) : (
            <ul
              aria-label="Audit events"
              className="flex flex-col gap-2"
              data-testid="console-audit"
            >
              {(listQuery.data as AuditListResp).events.map(event => (
                <AuditEventRow
                  event={event}
                  isSelected={selectedId === event.event_id}
                  key={event.event_id}
                  onCorrelate={setCorrelateRef}
                  onSelect={id => setSelectedId(prev => (prev === id ? null : id))}
                />
              ))}
            </ul>
          )}
        </ConsolePanel>
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
