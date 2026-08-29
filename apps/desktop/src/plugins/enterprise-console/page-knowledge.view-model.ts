/**
 * Enterprise Knowledge page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Two derivations matter:
 *   1. gap status → StatusTone (new → warn, authored → good,
 *      rejected → muted)
 *   2. upload status → StatusTone (staged / committing → warn,
 *      committed / edited → good, commit_failed → bad,
 *      rolled_back / uploading → muted)
 *
 * The capability chip ("knowledge RAG is not production-live") is
 * derived from whoami.product_capabilities.knowledge_rag; the view
 * renders the chip when status !== 'LIVE'.
 *
 * Wave 1 / Step 15 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { capabilityStatus } from './capabilities'
import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type {
  CollectionsResp,
  EntriesResp,
  KbGap,
  PreviewResp,
  UploadsResp,
} from './page-knowledge.controller'
import type { CapabilityStatus, Whoami } from './types'

export interface KbGapRow {
  canReview: boolean
  gapId: string
  hits: number
  query: string
  signal: string
  status: string
  tone: StatusTone
  tsLast: number
}

export interface KbUploadRow {
  canPublish: boolean
  canRollback: boolean
  chunksCommitted: number
  chunksTotal: number
  collection: null | string
  errorDetail: null | string
  filename: string
  sizeBytes: number
  status: string
  tone: StatusTone
  updatedTs: number
  uploadId: string
}

export interface KbCollectionRow {
  name: string
}

export interface KbEntryRow {
  chunks: number
  source: string
}

export interface KbPreviewChunk {
  charCount: number
  index: number
  piiForbidden: number
  piiWarning: number
  text: string
}

export interface KbPreviewViewModel {
  chunks: readonly KbPreviewChunk[]
  stats: {
    estCostUsd: number
    piiForbiddenCount: number
    piiWarningCount: number
    totalTokens: number
  }
  total: number
}

export interface KnowledgeViewModel extends CommonViewModelFields {
  capability: CapabilityStatus | null
  capabilityDev: boolean
  gaps: readonly KbGapRow[]
  uploads: readonly KbUploadRow[]
  collections: readonly KbCollectionRow[]
  entries: readonly KbEntryRow[]
  preview: null | KbPreviewViewModel
  /** Cache for the preview dialog — the dialog owns its own open
   *  state and passes the resolved data through the glue. */
  isGapsEmpty: boolean
  isUploadsEmpty: boolean
  isCollectionsEmpty: boolean
  isEntriesEmpty: boolean
}

const GAP_TONE: Record<string, StatusTone> = { authored: 'good', new: 'warn', rejected: 'muted' }

const UPLOAD_TONE: Record<string, StatusTone> = {
  commit_failed: 'bad',
  committed: 'good',
  committing: 'warn',
  edited: 'warn',
  rolled_back: 'muted',
  staged: 'good',
  uploading: 'muted',
}

function deriveGapRow(gap: KbGap): KbGapRow {
  return {
    gapId: gap.gap_id,
    query: gap.query,
    signal: gap.signal,
    hits: gap.hits,
    status: gap.status,
    tone: GAP_TONE[gap.status] ?? 'muted',
    tsLast: gap.ts_last,
    canReview: gap.status === 'new',
  }
}

function deriveUploadRow(upload: UploadsResp['uploads'][number]): KbUploadRow {
  const isStaged = upload.status === 'staged' || upload.status === 'edited'
  return {
    uploadId: upload.upload_id,
    filename: upload.filename,
    chunksCommitted: upload.chunks_committed,
    chunksTotal: upload.chunks_total,
    collection: upload.collection,
    errorDetail: upload.error_detail,
    sizeBytes: upload.size_bytes,
    status: upload.status,
    tone: UPLOAD_TONE[upload.status] ?? 'muted',
    updatedTs: upload.updated_ts,
    canPublish: isStaged,
    canRollback: isStaged,
  }
}

function deriveEntryRow(entry: EntriesResp['entries'][number]): KbEntryRow {
  return { chunks: entry.chunks, source: entry.source }
}

function derivePreview(data: PreviewResp): KbPreviewViewModel {
  return {
    total: data.total,
    stats: {
      estCostUsd: data.stats.est_cost_usd,
      piiForbiddenCount: data.stats.pii_forbidden_count,
      piiWarningCount: data.stats.pii_warning_count,
      totalTokens: data.stats.total_tokens,
    },
    chunks: (data.chunks ?? []).map(chunk => ({
      index: chunk.index,
      text: chunk.text,
      charCount: chunk.char_count,
      piiForbidden: chunk.pii_forbidden,
      piiWarning: chunk.pii_warning,
    })),
  }
}

export interface KnowledgeViewModelArgs {
  page: ConsolePage
  whoami: null | Whoami
  gaps: KbGapsResp | undefined
  uploads: UploadsResp | undefined
  collections: CollectionsResp | undefined
  entries: EntriesResp | undefined
  preview: null | { data: PreviewResp | undefined; isOpen: boolean }
}

export function deriveKnowledgeViewModel(args: KnowledgeViewModelArgs): KnowledgeViewModel {
  const { page, whoami, gaps, uploads, collections, entries, preview } = args
  const common = deriveCommonViewModel({
    capabilityName: 'knowledge_rag',
    page,
    whoami,
  })

  const gapRows = (gaps?.gaps ?? []).map(deriveGapRow)
  const uploadRows = (uploads?.uploads ?? []).map(deriveUploadRow)
  const collectionRows = (collections?.collections ?? []).map(name => ({ name }))
  const entryRows = (entries?.entries ?? []).map(deriveEntryRow)

  const capability = capabilityStatus(whoami, 'knowledge_rag')

  return {
    ...common,
    capability,
    capabilityDev: capability !== null && capability !== 'LIVE',
    gaps: gapRows,
    uploads: uploadRows,
    collections: collectionRows,
    entries: entryRows,
    preview: preview?.isOpen && preview.data ? derivePreview(preview.data) : null,
    isGapsEmpty: gapRows.length === 0,
    isUploadsEmpty: uploadRows.length === 0,
    isCollectionsEmpty: collectionRows.length === 0,
    isEntriesEmpty: entryRows.length === 0,
  }
}