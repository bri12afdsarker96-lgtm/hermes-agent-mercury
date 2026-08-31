/**
 * Knowledge page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no session atom,
 * no permission authority. The view consumes these derived shapes
 * directly.
 *
 * Per W1-B2 §P13:
 *   - The VM owns wire-row → presentation-row mapping, status → tone
 *     mapping, and pre-formatted display values (via `fmtEpoch`).
 *   - All public surface types are camelCase presentation shapes so
 *     the view does NOT need to know the snake_case wire field names.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type {
  CollectionsResp,
  EntriesResp,
  KbGap,
  PreviewResp,
  UploadRow,
} from './page-knowledge.controller'

// ---------------------------------------------------------------------------
// Tone tables (mirroring the pre-split page-knowledge.tsx)
// ---------------------------------------------------------------------------

export const GAP_TONE: Record<string, StatusTone> = {
  authored: 'good',
  new: 'warn',
  rejected: 'muted',
}

export const UPLOAD_TONE: Record<string, StatusTone> = {
  commit_failed: 'bad',
  committed: 'good',
  committing: 'warn',
  edited: 'warn',
  rolled_back: 'muted',
  staged: 'good',
  uploading: 'muted',
}

export function gapTone(status: string): StatusTone {
  return GAP_TONE[status] ?? 'muted'
}

export function uploadTone(status: string): StatusTone {
  return UPLOAD_TONE[status] ?? 'muted'
}

// ---------------------------------------------------------------------------
// Presentation shapes
// ---------------------------------------------------------------------------

export interface KbGapView {
  gapId: string
  hits: number
  query: string
  signal: string
  status: string
  tone: StatusTone
  // formatted display value (already passed through fmtEpoch)
  tsLastDisplay: string
  // raw epoch (ms since unix epoch) for any other consumer
  tsLast: number
}

export interface UploadRowView {
  uploadId: string
  filename: string
  status: string
  tone: StatusTone
  chunksCommitted: number
  chunksTotal: number
  collection: null | string
  errorDetail: null | string
  sizeBytes: number
  updatedTsDisplay: string
  updatedTs: number
  // actions allowed on this upload row
  canPreview: boolean
  canPublish: boolean
  canRollback: boolean
}

export interface PreviewChunkView {
  index: number
  charCount: number
  piiForbidden: number
  piiWarning: number
  text: string
  // pre-truncated for list rendering
  textPreview: string
}

export interface PreviewStatsView {
  estCostUsd: number
  piiForbiddenCount: number
  piiWarningCount: number
  totalTokens: number
}

export interface PreviewView {
  total: number
  chunks: PreviewChunkView[]
  stats: PreviewStatsView
  // formatted totals
  totalDisplay: string
  piiForbiddenDisplay: string
  piiWarningDisplay: string
  estCostDisplay: string
}

export interface EntryView {
  source: string
  chunks: number
}

export interface CollectionsView {
  names: string[]
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

export function deriveKbGaps(
  rows: KbGap[] | null | undefined,
  fmtEpoch: (seconds: null | number | undefined) => string
): KbGapView[] {
  if (!rows) {
    return []
  }

  return rows.map((row) => ({
    gapId: row.gap_id,
    hits: row.hits,
    query: row.query,
    signal: row.signal,
    status: row.status,
    tone: gapTone(row.status),
    tsLastDisplay: fmtEpoch(row.ts_last),
    tsLast: row.ts_last,
  }))
}

const PREVIEW_TEXT_LIMIT = 200

export function derivePreview(
  data: PreviewResp | null | undefined
): PreviewView | null {
  if (!data) {
    return null
  }

  const stats: PreviewStatsView = {
    estCostUsd: data.stats?.est_cost_usd ?? 0,
    piiForbiddenCount: data.stats?.pii_forbidden_count ?? 0,
    piiWarningCount: data.stats?.pii_warning_count ?? 0,
    totalTokens: data.stats?.total_tokens ?? 0,
  }

  const chunks: PreviewChunkView[] = (data.chunks ?? []).map((chunk) => ({
    index: chunk.index,
    charCount: chunk.char_count,
    piiForbidden: chunk.pii_forbidden,
    piiWarning: chunk.pii_warning,
    text: chunk.text,
    textPreview:
      chunk.text.length > PREVIEW_TEXT_LIMIT
        ? chunk.text.slice(0, PREVIEW_TEXT_LIMIT)
        : chunk.text,
  }))

  return {
    total: data.total,
    chunks,
    stats,
    totalDisplay: `${data.total ?? 0} chunks · ${stats.totalTokens} tokens`,
    piiForbiddenDisplay: `PII forbidden ${stats.piiForbiddenCount}`,
    piiWarningDisplay: `warning ${stats.piiWarningCount}`,
    estCostDisplay: `est_cost_usd ${stats.estCostUsd}`,
  }
}

export function deriveUploads(
  rows: UploadRow[] | null | undefined,
  fmtEpoch: (seconds: null | number | undefined) => string
): UploadRowView[] {
  if (!rows) {
    return []
  }

  return rows.map((row) => {
    const status = row.status
    // Per P17: only staged / edited rows surface Preview / Publish /
    // Rollback. Other upload statuses keep the controls hidden.
    const canPreview = status === 'staged' || status === 'edited'
    const canPublish = status === 'staged' || status === 'edited'
    const canRollback = status === 'staged' || status === 'edited'

    return {
      uploadId: row.upload_id,
      filename: row.filename,
      status,
      tone: uploadTone(status),
      chunksCommitted: row.chunks_committed,
      chunksTotal: row.chunks_total,
      collection: row.collection,
      errorDetail: row.error_detail,
      sizeBytes: row.size_bytes,
      updatedTsDisplay: fmtEpoch(row.updated_ts),
      updatedTs: row.updated_ts,
      canPreview,
      canPublish,
      canRollback,
    }
  })
}

export function deriveEntries(
  data: EntriesResp | null | undefined
): EntryView[] {
  if (!data) {
    return []
  }

  return (data.entries ?? []).map((entry) => ({
    source: entry.source,
    chunks: entry.chunks,
  }))
}

export function deriveCollections(
  data: CollectionsResp | null | undefined
): CollectionsView {
  if (!data) {
    return { names: [] }
  }

  return { names: data.collections ?? [] }
}

// ---------------------------------------------------------------------------
// Publish validation (mirrors the pre-split page-knowledge.tsx exactly)
// ---------------------------------------------------------------------------

export function isPublishCollectionValid(collection: string): boolean {
  const trimmed = collection.trim()

  return trimmed.length > 0 && trimmed.length <= 64
}

export function isRejectReasonValid(reason: string): boolean {
  return reason.trim().length >= 3
}

export function isAuthorTextValid(text: string): boolean {
  return text.trim().length > 0
}

// ---------------------------------------------------------------------------
// Page-level visual productization helpers (Phase-1 Visual Baseline v1).
//
// Pure functions/constants only. No transport, no Date.now, no session,
// no permission. The view consumes the formatted strings directly.
//
// Per P1-VIS-V1 §P5 Knowledge invariant: upload / preview / publish / withdraw /
// manual candidate review remain real server actions. Failed actions are NOT
// displayed as success.
// Per P1-VIS-V1 §P7 reuse priority: ViewModel-derived strings flow into the
// existing KnowledgeView / PageHeader; no new shared component is introduced.
// ---------------------------------------------------------------------------

/**
 * Knowledge page purpose statement. Mirrors the Design Baseline v1
 * description while keeping the protocol-blessed English copy ("Enterprise
 * knowledge") and avoiding any invention of capability the controller does
 * not surface. The same string is rendered by the view in PageHeaders

// ---------------------------------------------------------------------------
// Page-level visual productization helpers (Phase-1 Visual Baseline v1).
//
// Pure functions/constants only. No transport, no Date.now, no session,
// no permission. The view consumes the formatted strings directly.
//
// Per P1-VIS-V1 §P5 Knowledge invariant: upload / preview / publish / withdraw /
// manual candidate review remain real server actions. Failed actions are NOT
// displayed as success.
// Per P1-VIS-V1 §P7 reuse priority: ViewModel-derived strings flow into the
// existing KnowledgeView / PageHeader; no new shared component is introduced.
// ---------------------------------------------------------------------------

/**
 * Knowledge page purpose statement. Mirrors the Design Baseline v1
 * description while keeping the protocol-blessed English copy ("Enterprise
 * knowledge") and avoiding any invention of capability the controller does
 * not surface. The same string is rendered by the view in PageHeader's
 * `purpose` slot, so a11y/responsive/behavior tests can assert it once.
 */
export function formatKnowledgePurpose(): string {
  return (
    'Upload sources, preview staged chunks, stage candidate gaps and publish ' +
    'or withdraw them through authoritative server workflows.'
  )
}

/**
 * Trailing read-only notice. Renders below the page grid in the view so
 * reviewers and operators see at a glance that:
 *   - every action is a real server action (upload / preview / publish /
 *     withdraw / manual candidate review);
 *   - failed actions remain failures;
 *   - this surface does not invent rows or optimistic state.
 *
 * Kept identical to the Protocol §P5 K1-K7 invariant so any divergence
 * shows up in code review before it reaches QA.
 */
export const KNOWLEDGE_READ_ONLY_NOTICE =
  'Upload, preview, publish, withdraw, and manual candidate review are real ' +
  'server actions. Failed actions stay failed; no rows are fabricated.'
