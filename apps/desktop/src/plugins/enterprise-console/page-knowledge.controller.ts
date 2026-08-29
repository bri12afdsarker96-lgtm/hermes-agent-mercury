/**
 * Enterprise Knowledge page — Controller layer.
 *
 * The full Phase-1 control surface, all on real Hermes P1 routes (no
 * new knowledge API). 7 mutations + 4 queries:
 *   - Candidates / review   → /api/kb-gaps + kb-gap-author + kb-gap-reject
 *   - Upload                → /api/knowledge-upload (multipart, field "file")
 *   - Preview               → /api/knowledge-preview (chunks + stats + PII counts)
 *   - Publish               → /api/knowledge-commit (SYNCHRONOUS)
 *   - Rollback              → /api/knowledge-rollback (staged uploads)
 *   - Sources               → /api/knowledge-committed
 *   - Withdraw              → /api/knowledge-delete (destructive)
 *
 * The server owns all authority; every action posts and refetches the
 * authoritative state — no local optimistic success, no local state
 * machine. knowledge_rag is DEV, shown honestly (Capability Truth).
 *
 * Wave 1 / Step 15 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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

export interface PreviewChunk {
  char_count: number
  index: number
  pii_forbidden: number
  pii_warning: number
  text: string
}

export interface PreviewResp {
  chunks: PreviewChunk[]
  stats: { est_cost_usd: number; pii_forbidden_count: number; pii_warning_count: number; total_tokens: number }
  status: string
  total: number
}

export interface CollectionsResp {
  collections: string[]
}

export interface EntryItem {
  chunks: number
  source: string
}

export interface EntriesResp {
  entries: EntryItem[]
}

export const KB_GAPS_KEY = ['enterprise-console', 'kb-gaps'] as const
export const KB_UPLOADS_KEY = ['enterprise-console', 'kb-uploads'] as const
export const KB_COLLECTIONS_KEY = ['enterprise-console', 'kb-collections'] as const

export const kbEntriesKey = (collection: string): readonly unknown[] =>
  ['enterprise-console', 'kb-entries', collection]

export const kbPreviewKey = (uploadId: string): readonly unknown[] =>
  ['enterprise-console', 'kb-preview', uploadId]

export function useKbGaps() {
  const transport = useTransport()

  return useConsoleQuery<KbGapsResp>(KB_GAPS_KEY, '/api/kb-gaps?status=new')
}

export function useKbUploads() {
  const transport = useTransport()

  return useConsoleQuery<UploadsResp>(KB_UPLOADS_KEY, '/api/knowledge-uploads')
}

export function useKbCollections() {
  const transport = useTransport()

  return useConsoleQuery<CollectionsResp>(KB_COLLECTIONS_KEY, '/api/knowledge-committed')
}

export function useKbEntries(collection: null | string) {
  const transport = useTransport()
  const c = collection ?? ''

  return useConsoleQuery<EntriesResp>(
    kbEntriesKey(c),
    c ? `/api/knowledge-committed?collection=${encodeURIComponent(c)}` : '',
  )
}

export function useKbPreview(uploadId: null | string) {
  const transport = useTransport()
  const id = uploadId ?? ''

  return useConsoleQuery<PreviewResp>(
    kbPreviewKey(id),
    id ? `/api/knowledge-preview?upload_id=${encodeURIComponent(id)}` : '',
    0,
  )
}

export interface KbGapAuthorBody {
  gap_id: string
  text: string
}

export interface KbGapRejectBody {
  gap_id: string
  reason: string
}

export interface KbKnowledgeCommitBody {
  collection: string
  upload_id: string
}

export interface KbKnowledgeRollbackBody {
  upload_id: string
}

export interface KbKnowledgeDeleteBody {
  collection: string
  reason: string
  source: string
}

export interface KbUploadArgs {
  bytes: ArrayBuffer
  contentType: string
  filename: string
}

/** Build the seven mutations bound to the active transport. */
export function makeKnowledgeMutations(transport: ReturnType<typeof useTransport>) {
  return {
    authorGap: async (body: KbGapAuthorBody) => {
      await transport.post('/api/kb-gap-author', body)
    },
    rejectGap: async (body: KbGapRejectBody) => {
      await transport.post('/api/kb-gap-reject', body)
    },
    uploadFile: async (args: KbUploadArgs) => {
      await transport.upload('/api/knowledge-upload', args)
    },
    publishUpload: async (body: KbKnowledgeCommitBody) => {
      await transport.post('/api/knowledge-commit', body)
    },
    rollbackUpload: async (body: KbKnowledgeRollbackBody) => {
      await transport.post('/api/knowledge-rollback', body)
    },
    withdrawSource: async (body: KbKnowledgeDeleteBody) => {
      await transport.post('/api/knowledge-delete', body)
    },
  }
}

export function normalizeKnowledgeError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'kb.author / kb.upload / kb.commit / kb.delete permission required'
    }

    if (e.code === 'not_implemented') {
      return 'knowledge endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}