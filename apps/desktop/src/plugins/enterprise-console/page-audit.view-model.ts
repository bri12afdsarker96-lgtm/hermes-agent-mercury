/**
 * Audit evidence page (SC4) — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * The view-model is the page's only authority on:
 *   - which view is showing (list, chain, detail)
 *   - whether to show a "pick a tenant" notice for bare super_admin
 *   - what collapsed error state to render
 *   - the audit-detail payload JSON serialization
 *
 * Wave 1 / Step 12 of W5-B0 Controller/View Contract Freeze.
 */

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import {
  type AuditErrorKind,
  type AuditEvent,
  auditErrorKind,
} from './page-audit.controller'
import type { Whoami } from './types'

export interface AuditListRow {
  action: string
  actor: null | string
  eventId: string
  hasResourceRef: boolean
  resourceRef: null | string
  ts: string
}

export interface AuditChainRow {
  action: string
  actor: null | string
  ts: string
}

export interface AuditDetail {
  action: string
  actorDisplay: string
  eventId: string
  payloadJson: string
  resourceDisplay: string
  ts: string
}

export type AuditViewMode =
  | 'pick-tenant'
  | 'loading'
  | 'list'
  | 'list-empty'
  | 'chain-loading'
  | 'chain-error'
  | 'chain-empty'
  | 'chain-ready'
  | 'detail-loading'
  | 'detail-error'
  | 'detail-ready'
  | 'list-error'

export interface AuditViewModel extends CommonViewModelFields {
  mode: AuditViewMode
  listRows: readonly AuditListRow[]
  chainRows: readonly AuditChainRow[]
  detail: null | AuditDetail
  listError: null | { kind: AuditErrorKind; message: string }
  chainError: null | { kind: AuditErrorKind; message: string }
  detailError: null | { kind: AuditErrorKind; message: string }
}

function deriveListRow(event: AuditEvent): AuditListRow {
  return {
    eventId: event.event_id,
    action: event.action,
    actor: event.actor,
    hasResourceRef: event.resource_ref != null,
    resourceRef: event.resource_ref,
    ts: event.ts,
  }
}

function deriveChainRow(event: AuditEvent): AuditChainRow {
  return {
    action: event.action,
    actor: event.actor,
    ts: event.ts,
  }
}

function serializePayload(payload: unknown): string {
  if (payload == null) {
    return '—'
  }

  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return '[unserializable payload]'
  }
}

function deriveDetail(event: AuditEvent): AuditDetail {
  return {
    eventId: event.event_id,
    action: event.action,
    actorDisplay: event.actor ?? '—',
    resourceDisplay: event.resource_ref ?? '—',
    ts: event.ts,
    payloadJson: serializePayload(event.payload_ref),
  }
}

export interface AuditViewModelArgs {
  page: ConsolePage
  whoami: null | Whoami
  /** Read state from each query. */
  list: { data: AuditListResp | undefined; error: unknown; isPending: boolean }
  chain: null | { data: AuditListResp | undefined; error: unknown; isPending: boolean; resourceRef: string }
  detail: null | { data: AuditDetailResp | undefined; error: unknown; isPending: boolean; eventId: string }
}

export function deriveAuditViewModel(args: AuditViewModelArgs): AuditViewModel {
  const { page, whoami, list, chain, detail } = args
  const common = deriveCommonViewModel({ page, whoami })

  // Bare super_admin (no tenant view) → pick-tenant notice, no fetches.
  if (whoami && whoami.role === 'super_admin' && !whoami.tenant_id) {
    return {
      ...common,
      mode: 'pick-tenant',
      listRows: [],
      chainRows: [],
      detail: null,
      listError: null,
      chainError: null,
      detailError: null,
    }
  }

  const listError = list.error
    ? { kind: auditErrorKind(list.error), message: String((list.error as Error).message ?? list.error) }
    : null
  const chainError = chain?.error
    ? { kind: auditErrorKind(chain.error), message: String((chain.error as Error).message ?? chain.error) }
    : null
  const detailError = detail?.error
    ? { kind: auditErrorKind(detail.error), message: String((detail.error as Error).message ?? detail.error) }
    : null

  // Detail takes visual priority when an event is selected.
  if (detail && detail.eventId) {
    if (detail.isPending) {
      return { ...common, mode: 'detail-loading', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
    }

    if (detailError) {
      return { ...common, mode: 'detail-error', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
    }

    if (detail.data) {
      return {
        ...common,
        mode: 'detail-ready',
        listRows: [],
        chainRows: [],
        detail: deriveDetail(detail.data.event),
        listError,
        chainError,
        detailError,
      }
    }
  }

  // Otherwise: chain view if user picked a resource to correlate.
  if (chain && chain.resourceRef) {
    if (chain.isPending) {
      return { ...common, mode: 'chain-loading', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
    }

    if (chainError) {
      return { ...common, mode: 'chain-error', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
    }

    const events = chain.data?.events ?? []
    if (events.length === 0) {
      return { ...common, mode: 'chain-empty', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
    }

    return {
      ...common,
      mode: 'chain-ready',
      listRows: [],
      chainRows: events.map(deriveChainRow),
      detail: null,
      listError,
      chainError,
      detailError,
    }
  }

  // Default: list view.
  if (list.isPending) {
    return { ...common, mode: 'loading', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
  }

  if (listError) {
    return { ...common, mode: 'list-error', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
  }

  const events = list.data?.events ?? []
  if (events.length === 0) {
    return { ...common, mode: 'list-empty', listRows: [], chainRows: [], detail: null, listError, chainError, detailError }
  }

  return {
    ...common,
    mode: 'list',
    listRows: events.map(deriveListRow),
    chainRows: [],
    detail: null,
    listError,
    chainError,
    detailError,
  }
}