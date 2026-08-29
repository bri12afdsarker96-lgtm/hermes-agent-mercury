/**
 * Knowledge page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Knowledge page (per W1-B2 §P12):
 *
 *   Queries:
 *     - /api/kb-gaps?status=new
 *       queryKey: ['enterprise-console', 'kb-gaps']
 *     - /api/knowledge-uploads
 *       queryKey: ['enterprise-console', 'kb-uploads']
 *     - /api/knowledge-preview?upload_id=<id>
 *       queryKey: ['enterprise-console', 'kb-preview', uploadId]
 *       refetchInterval: 0 (server-driven, no polling)
 *     - /api/knowledge-committed
 *       queryKey: ['enterprise-console', 'kb-collections']
 *     - /api/knowledge-committed?collection=<c>
 *       queryKey: ['enterprise-console', 'kb-entries', collection]
 *
 *   Mutations (server writes; all invalidate exact query keys):
 *     - POST /api/kb-gap-author       permission kb.author
 *       body {gap_id, text}                invalidate KB_GAPS_KEY
 *     - POST /api/kb-gap-reject        permission kb.author
 *       body {gap_id, reason}              invalidate KB_GAPS_KEY
 *     - POST /api/knowledge-upload    permission kb.upload
 *       bytes + contentType + filename    invalidate UPLOADS_KEY
 *     - POST /api/knowledge-commit     permission kb.commit
 *       body {collection, upload_id}      invalidate UPLOADS_KEY
 *       (HTTP completion = authoritative commit completion)
 *     - POST /api/knowledge-rollback  permission kb.upload
 *       body {upload_id}                  invalidate UPLOADS_KEY
 *     - POST /api/knowledge-delete     permission kb.delete
 *       body {collection, source, reason} invalidate ['enterprise-console', 'kb-entries', collection]
 *
 * The controller MUST NOT:
 *   - invent server state or capability state
 *   - mark 'committed' optimistically
 *   - introduce a second mutation framework
 *   - own presentation markup / state (text inputs live in the view
 *     and glue; only form-action callbacks live here)
 */

import { useValue } from '@hermes/plugin-sdk'
import { useCallback } from 'react'

import { hasPermission } from './capabilities'
import { useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { useTransport } from './transport'

// ---------------------------------------------------------------------------
// Query keys (exported so the view / glue can read them as constants)
// ---------------------------------------------------------------------------

export const KB_GAPS_KEY = ['enterprise-console', 'kb-gaps'] as const
export const UPLOADS_KEY = ['enterprise-console', 'kb-uploads'] as const
export const COLLECTIONS_KEY = ['enterprise-console', 'kb-collections'] as const
export const kbPreviewKey = (uploadId: string) =>
  ['enterprise-console', 'kb-preview', uploadId] as const
export const kbEntriesKey = (collection: string) =>
  ['enterprise-console', 'kb-entries', collection] as const

// ---------------------------------------------------------------------------
// Wire types (kept here so the controller is the only owner of the
// server response shapes)
// ---------------------------------------------------------------------------

export interface KbGap {
  gap_id: string
  hits: number
  query: string
  signal: string
  status: string
  ts_last: number
}

export interface KbGapsResp {
  gaps: KbGap[]
}

export interface UploadRow {
  chunks_committed: number
  chunks_total: number
  collection: null | string
  error_detail: null | string
  filename: string
  size_bytes: number
  status: string
  updated_ts: number
  upload_id: string
}

export interface UploadsResp {
  uploads: UploadRow[]
}

export interface PreviewResp {
  chunks: {
    char_count: number
    index: number
    pii_forbidden: number
    pii_warning: number
    text: string
  }[]
  stats: {
    est_cost_usd: number
    pii_forbidden_count: number
    pii_warning_count: number
    total_tokens: number
  }
  status: string
  total: number
}

export interface CollectionsResp {
  collections: string[]
}

export interface EntriesResp {
  entries: { chunks: number; source: string }[]
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useKbGaps() {
  return useConsoleQuery<KbGapsResp>(KB_GAPS_KEY, '/api/kb-gaps?status=new')
}

export function useKbUploads() {
  return useConsoleQuery<UploadsResp>(UPLOADS_KEY, '/api/knowledge-uploads')
}

export function useKbPreview(uploadId: string) {
  return useConsoleQuery<PreviewResp>(
    kbPreviewKey(uploadId),
    `/api/knowledge-preview?upload_id=${encodeURIComponent(uploadId)}`,
    0
  )
}

export function useKbCollections() {
  return useConsoleQuery<CollectionsResp>(
    COLLECTIONS_KEY,
    '/api/knowledge-committed'
  )
}

export function useKbEntries(collection: string) {
  return useConsoleQuery<EntriesResp>(
    kbEntriesKey(collection),
    `/api/knowledge-committed?collection=${encodeURIComponent(collection)}`
  )
}

// ---------------------------------------------------------------------------
// Authoritative helper (permission + capability status query)
// ---------------------------------------------------------------------------

export function useKnowledgeAuthority() {
  const who = useValue($whoami)

  return {
    who,
    canAuthor: who === null || hasPermission(who, 'kb.author'),
    canUpload: who === null || hasPermission(who, 'kb.upload'),
    canCommit: who === null || hasPermission(who, 'kb.commit'),
    canDelete: who === null || hasPermission(who, 'kb.delete'),
    whoamiSnapshot: who,
  }
}

// ---------------------------------------------------------------------------
// Mutation callbacks (each takes the body, returns the submit promise).
// These are the only place the controller posts to the KB endpoints.
// ---------------------------------------------------------------------------

export function useKnowledgeMutations() {
  const transport = useTransport()

  const authorGap = useCallback(
    (gap_id: string, text: string) =>
      transport.post('/api/kb-gap-author', { gap_id, text }),
    [transport]
  )

  const rejectGap = useCallback(
    (gap_id: string, reason: string) =>
      transport.post('/api/kb-gap-reject', { gap_id, reason }),
    [transport]
  )

  const uploadBytes = useCallback(
    (bytes: ArrayBuffer, contentType: string, filename: string) =>
      transport.upload('/api/knowledge-upload', {
        bytes,
        contentType,
        filename,
      }),
    [transport]
  )

  const publish = useCallback(
    (collection: string, upload_id: string) =>
      transport.post('/api/knowledge-commit', { collection, upload_id }),
    [transport]
  )

  const rollback = useCallback(
    (upload_id: string) =>
      transport.post('/api/knowledge-rollback', { upload_id }),
    [transport]
  )

  const withdraw = useCallback(
    (collection: string, source: string, reason: string) =>
      transport.post('/api/knowledge-delete', { collection, source, reason }),
    [transport]
  )

  return {
    authorGap,
    rejectGap,
    uploadBytes,
    publish,
    rollback,
    withdraw,
  }
}
