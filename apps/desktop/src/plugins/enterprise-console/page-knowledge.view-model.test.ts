/**
 * Knowledge page — ViewModel tests (W1-B2 §P22).
 *
 * Pure-function tests for the page-knowledge.view-model derivations.
 * No React, no transport, no session atom, no permission.
 * Verifies:
 *   - Wire row → presentation row mapping
 *   - Status → StatusTone mapping (gap + upload)
 *   - Selection-bound invariant: switching collection never
 *     temporarily leaks entries from the old collection (per §P19)
 *   - Preview selection-bound invariant: opening preview for upload A
 *     never leaks upload B's chunks (per §P18)
 *   - Publish collection validation: trim length > 0 && <= 64
 *   - Reject reason validation: trim length >= 3
 *   - Author text validation: trim length > 0
 *   - Defensive preview VM when stats are missing
 */

import { describe, expect, it } from 'vitest'

import type { CollectionsResp, EntriesResp, KbGap, PreviewResp, UploadRow } from './page-knowledge.controller'
import {
  type CollectionsView,
  deriveCollections,
  deriveEntries,
  deriveKbGaps,
  derivePreview,
  deriveUploads,
  type EntryView,
  gapTone,
  isAuthorTextValid,
  isPublishCollectionValid,
  isRejectReasonValid,
  type KbGapView,
  type PreviewView,
  type UploadRowView,
  uploadTone,
} from './page-knowledge.view-model'

const fmtEpoch = (s: number | null | undefined) => `ts:${s ?? 'null'}`

const G1: KbGap = {
  gap_id: 'g1',
  hits: 5,
  query: 'refund status',
  signal: 'human',
  status: 'new',
  ts_last: 1700000000,
}

const G2: KbGap = {
  gap_id: 'g2',
  hits: 1,
  query: 'invoice missing',
  signal: 'agent',
  status: 'authored',
  ts_last: 1700001000,
}

const U_STAGED: UploadRow = {
  chunks_committed: 0,
  chunks_total: 5,
  collection: null,
  error_detail: null,
  filename: 'doc.txt',
  size_bytes: 100,
  status: 'staged',
  updated_ts: 1700000000,
  upload_id: 'u1',
}

const U_EDITED: UploadRow = {
  ...U_STAGED,
  upload_id: 'u2',
  status: 'edited',
  updated_ts: 1700000100,
}

const U_COMMITTING: UploadRow = {
  ...U_STAGED,
  upload_id: 'u3',
  status: 'committing',
}

const U_COMMITTED: UploadRow = {
  ...U_STAGED,
  upload_id: 'u4',
  status: 'committed',
}

const U_ROLLED_BACK: UploadRow = {
  ...U_STAGED,
  upload_id: 'u5',
  status: 'rolled_back',
}

const P_FULL: PreviewResp = {
  chunks: [
    { char_count: 5, index: 0, pii_forbidden: 0, pii_warning: 0, text: 'hello world' },
    { char_count: 7, index: 1, pii_forbidden: 1, pii_warning: 0, text: 'second chunk' },
  ],
  stats: { est_cost_usd: 12.5, pii_forbidden_count: 1, pii_warning_count: 0, total_tokens: 42 },
  status: 'staged',
  total: 2,
}

const P_NO_STATS: PreviewResp = {
  // stats intentionally undefined to test defensive defaulting
  chunks: [],
  stats: undefined as unknown as PreviewResp['stats'],
  status: 'staged',
  total: 0,
}

const E1: EntriesResp = {
  entries: [
    { chunks: 3, source: 'doc-1.txt' },
    { chunks: 7, source: 'doc-2.txt' },
  ],
}

const E2: EntriesResp = {
  entries: [
    { chunks: 99, source: 'other-doc.txt' },
  ],
}

describe('gapTone (per P15)', () => {
  it('maps authored → good', () => {
    expect(gapTone('authored')).toBe('good')
  })
  it('maps new → warn', () => {
    expect(gapTone('new')).toBe('warn')
  })
  it('maps rejected → muted', () => {
    expect(gapTone('rejected')).toBe('muted')
  })
  it('defaults unknown → muted', () => {
    expect(gapTone('something-new')).toBe('muted')
  })
})

describe('uploadTone (per P17)', () => {
  it('maps staged → good', () => {
    expect(uploadTone('staged')).toBe('good')
  })
  it('maps edited → warn', () => {
    expect(uploadTone('edited')).toBe('warn')
  })
  it('maps committed → good', () => {
    expect(uploadTone('committed')).toBe('good')
  })
  it('maps committing → warn', () => {
    expect(uploadTone('committing')).toBe('warn')
  })
  it('maps commit_failed → bad', () => {
    expect(uploadTone('commit_failed')).toBe('bad')
  })
  it('maps rolled_back → muted', () => {
    expect(uploadTone('rolled_back')).toBe('muted')
  })
  it('maps uploading → muted', () => {
    expect(uploadTone('uploading')).toBe('muted')
  })
  it('defaults unknown → muted', () => {
    expect(uploadTone('weird-state')).toBe('muted')
  })
})

describe('deriveKbGaps (P6 read parity)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveKbGaps(null, fmtEpoch)).toEqual([])
    expect(deriveKbGaps(undefined, fmtEpoch)).toEqual([])
  })

  it('maps snake_case wire → camelCase presentation', () => {
    const [first, second] = deriveKbGaps([G1, G2], fmtEpoch) as KbGapView[]
    expect(first.gapId).toBe('g1')
    expect(first.hits).toBe(5)
    expect(first.query).toBe('refund status')
    expect(first.signal).toBe('human')
    expect(first.status).toBe('new')
    expect(first.tone).toBe('warn')
    expect(first.tsLast).toBe(1700000000)
    expect(first.tsLastDisplay).toBe('ts:1700000000')
    expect(second.gapId).toBe('g2')
    expect(second.tone).toBe('good')
  })
})

describe('deriveUploads (P6 read parity + P17 row action gating)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveUploads(null, fmtEpoch)).toEqual([])
    expect(deriveUploads(undefined, fmtEpoch)).toEqual([])
  })

  it('exposes canPreview/canPublish/canRollback true only for staged/edited', () => {
    const rows = deriveUploads(
      [U_STAGED, U_EDITED, U_COMMITTING, U_COMMITTED, U_ROLLED_BACK],
      fmtEpoch
    )

    const byId = (id: string) => rows.find((r) => r.uploadId === id)!
    expect(byId('u1')).toMatchObject({
      canPreview: true,
      canPublish: true,
      canRollback: true,
      status: 'staged',
    })
    expect(byId('u2')).toMatchObject({
      canPreview: true,
      canPublish: true,
      canRollback: true,
      status: 'edited',
    })
    expect(byId('u3')).toMatchObject({
      canPreview: false,
      canPublish: false,
      canRollback: false,
      status: 'committing',
    })
    expect(byId('u4')).toMatchObject({
      canPreview: false,
      canPublish: false,
      canRollback: false,
      status: 'committed',
    })
    expect(byId('u5')).toMatchObject({
      canPreview: false,
      canPublish: false,
      canRollback: false,
      status: 'rolled_back',
    })
  })

  it('pre-formats updated_ts via fmtEpoch (no raw epoch in view layer)', () => {
    const [row] = deriveUploads([U_STAGED], fmtEpoch) as UploadRowView[]
    expect(row.updatedTsDisplay).toBe('ts:1700000000')
    expect(row.updatedTs).toBe(1700000000)
  })
})

describe('derivePreview (P6, P18 selection identity)', () => {
  it('returns null for null/undefined', () => {
    expect(derivePreview(null)).toBeNull()
    expect(derivePreview(undefined)).toBeNull()
  })

  it('maps full preview resp → presentation view with formatted display', () => {
    const v = derivePreview(P_FULL) as PreviewView
    expect(v).not.toBeNull()
    expect(v!.total).toBe(2)
    expect(v!.chunks).toHaveLength(2)
    expect(v!.stats).toEqual({
      estCostUsd: 12.5,
      piiForbiddenCount: 1,
      piiWarningCount: 0,
      totalTokens: 42,
    })
    expect(v!.totalDisplay).toBe('2 chunks · 42 tokens')
    expect(v!.piiForbiddenDisplay).toBe('PII forbidden 1')
    expect(v!.piiWarningDisplay).toBe('warning 0')
    expect(v!.estCostDisplay).toBe('est_cost_usd 12.5')
    expect(v!.chunks[0]!.textPreview).toBe('hello world')
  })

  it('selection identity: switching preview to another upload re-derives (no cross-leak)', () => {
    const v1 = derivePreview(P_FULL)
    const v2 = derivePreview({ ...P_FULL, chunks: [{ ...P_FULL.chunks[0]!, text: 'other' }] })
    expect(v1!.chunks[0]!.textPreview).toBe('hello world')
    expect(v2!.chunks[0]!.textPreview).toBe('other')
    expect(v1).not.toBe(v2)
  })

  it('defensively defaults stats fields when stats missing', () => {
    const v = derivePreview(P_NO_STATS) as PreviewView
    expect(v).not.toBeNull()
    expect(v!.stats).toEqual({
      estCostUsd: 0,
      piiForbiddenCount: 0,
      piiWarningCount: 0,
      totalTokens: 0,
    })
    expect(v!.totalDisplay).toBe('0 chunks · 0 tokens')
  })

  it('pre-truncates chunk text to 200 chars', () => {
    const long = 'a'.repeat(300)

    const v = derivePreview({
      ...P_FULL,
      chunks: [{ ...P_FULL.chunks[0]!, text: long }],
    }) as PreviewView

    expect(v!.chunks[0]!.textPreview).toHaveLength(200)
  })
})

describe('deriveEntries (P6, P19 selection identity)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveEntries(null)).toEqual([])
    expect(deriveEntries(undefined)).toEqual([])
  })

  it('maps entries wire → presentation', () => {
    const entries = deriveEntries(E1) as EntryView[]
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ source: 'doc-1.txt', chunks: 3 })
    expect(entries[1]).toEqual({ source: 'doc-2.txt', chunks: 7 })
  })

  it('selection identity: switching collection entries is a fresh derivation (no leak)', () => {
    const a = deriveEntries(E1)
    const b = deriveEntries(E2)
    expect(a.map((e) => e.source)).toEqual(['doc-1.txt', 'doc-2.txt'])
    expect(b.map((e) => e.source)).toEqual(['other-doc.txt'])
    // Identity check: separate derivations produce separate arrays.
    expect(a).not.toBe(b)
  })
})

describe('deriveCollections (P6 read parity)', () => {
  it('returns empty names for null/undefined', () => {
    expect(deriveCollections(null)).toEqual({ names: [] })
    expect(deriveCollections(undefined)).toEqual({ names: [] })
  })

  it('passes through collections array', () => {
    const data: CollectionsResp = { collections: ['c1', 'c2'] }
    const v = deriveCollections(data) as CollectionsView
    expect(v.names).toEqual(['c1', 'c2'])
  })
})

describe('validation helpers (P7, P15)', () => {
  describe('isAuthorTextValid', () => {
    it('rejects empty / whitespace-only', () => {
      expect(isAuthorTextValid('')).toBe(false)
      expect(isAuthorTextValid('   ')).toBe(false)
    })
    it('accepts non-empty after trim', () => {
      expect(isAuthorTextValid('a')).toBe(true)
      expect(isAuthorTextValid('  answer  ')).toBe(true)
    })
  })

  describe('isRejectReasonValid', () => {
    it('rejects < 3 chars after trim', () => {
      expect(isRejectReasonValid('')).toBe(false)
      expect(isRejectReasonValid('a')).toBe(false)
      expect(isRejectReasonValid('ab')).toBe(false)
      expect(isRejectReasonValid('   ')).toBe(false)
    })
    it('accepts >= 3 chars after trim', () => {
      expect(isRejectReasonValid('abc')).toBe(true)
      expect(isRejectReasonValid('  reason  ')).toBe(true)
    })
  })

  describe('isPublishCollectionValid', () => {
    it('rejects empty / whitespace-only', () => {
      expect(isPublishCollectionValid('')).toBe(false)
      expect(isPublishCollectionValid('   ')).toBe(false)
    })
    it('rejects > 64 chars', () => {
      expect(isPublishCollectionValid('a'.repeat(65))).toBe(false)
    })
    it('accepts 1..64 chars after trim', () => {
      expect(isPublishCollectionValid('a')).toBe(true)
      expect(isPublishCollectionValid('a'.repeat(64))).toBe(true)
      expect(isPublishCollectionValid('  colA  ')).toBe(true)
    })
  })
})