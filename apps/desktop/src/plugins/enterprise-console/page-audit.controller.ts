/**
 * Audit evidence page (SC4) — Controller layer.
 *
 * READ-ONLY ONLY: audit is append-only evidence, never re-execution.
 * This controller carries NO mutation hooks — the server exposes no
 * audit write route and must not. There are no `useMutation` calls.
 *
 * Three reads:
 *   - useAuditList({ action, resourceRef }) — `/api/audit-list`
 *   - useAuditDetail(eventId) — `/api/audit-detail?event_id=...`
 *   - useAuditCorrelate(resourceRef) — `/api/audit-correlate?resource_ref=...`
 *
 * Wave 1 / Step 12 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

export interface AuditEvent {
  action: string
  actor: null | string
  event_id: string
  payload_ref: unknown
  resource_ref: null | string
  ts: string
}

export interface AuditListResp {
  events: AuditEvent[]
}

export interface AuditDetailResp {
  event: AuditEvent
}

/** Build the audit-list URL from the current filter inputs. Empty
 *  filter values are omitted (server reads only what is set). */
export function auditListPath(action: string, resourceRef: string): string {
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

export function auditListKey(action: string, resourceRef: string): readonly unknown[] {
  return ['enterprise-console', 'audit-list', action, resourceRef]
}

export function auditDetailKey(eventId: string): readonly unknown[] {
  return ['enterprise-console', 'audit-detail', eventId]
}

export function auditCorrelateKey(resourceRef: string): readonly unknown[] {
  return ['enterprise-console', 'audit-correlate', resourceRef]
}

export function useAuditList(action: string, resourceRef: string) {
  const transport = useTransport()

  return useConsoleQuery<AuditListResp>(
    auditListKey(action, resourceRef),
    auditListPath(action, resourceRef),
  )
}

export function useAuditDetail(eventId: null | string) {
  const transport = useTransport()
  const id = eventId ?? ''

  return useConsoleQuery<AuditDetailResp>(
    auditDetailKey(id),
    id ? `/api/audit-detail?event_id=${encodeURIComponent(id)}` : '',
    0,
  )
}

export function useAuditCorrelate(resourceRef: null | string) {
  const transport = useTransport()
  const ref = resourceRef ?? ''

  return useConsoleQuery<AuditListResp>(
    auditCorrelateKey(ref),
    ref ? `/api/audit-correlate?resource_ref=${encodeURIComponent(ref)}` : '',
    0,
  )
}

/** Map a HermesApiError → a coarse UI state discriminator. The server
 *  collapses 400/404/503 into HermesApiError code 'error', so the
 *  branching key is the HTTP status. */
export type AuditErrorKind = 'event-not-found' | 'malformed-id' | 'audit-unavailable' | 'unknown'

export function auditErrorKind(error: unknown): AuditErrorKind {
  if (error instanceof HermesApiError) {
    if (error.status === 404) {
      return 'event-not-found'
    }

    if (error.status === 400) {
      return 'malformed-id'
    }

    if (error.status === 503) {
      return 'audit-unavailable'
    }
  }

  return 'unknown'
}

export function normalizeAuditError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'audit.read permission required'
    }

    if (e.code === 'not_implemented') {
      return 'audit endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}