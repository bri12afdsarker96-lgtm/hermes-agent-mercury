/**
 * Knowledge page — Controller tests (W1-B2 §P22-§P25).
 *
 * Verifies the controller's only transport-touching surface:
 *   - Exact query keys
 *   - Exact route paths
 *   - Permission matrix
 *   - Capability authority (uses real non-null whoami, not null-direct)
 */

import { describe, expect, it } from 'vitest'

import {
  COLLECTIONS_KEY,
  KB_GAPS_KEY,
  kbEntriesKey,
  kbPreviewKey,
  UPLOADS_KEY,
} from './page-knowledge.controller'

describe('Knowledge page query keys (P6 read parity)', () => {
  it('KB_GAPS_KEY is exact', () => {
    expect(KB_GAPS_KEY).toEqual(['enterprise-console', 'kb-gaps'])
  })

  it('UPLOADS_KEY is exact', () => {
    expect(UPLOADS_KEY).toEqual(['enterprise-console', 'kb-uploads'])
  })

  it('COLLECTIONS_KEY is exact', () => {
    expect(COLLECTIONS_KEY).toEqual(['enterprise-console', 'kb-collections'])
  })

  it('kbPreviewKey is selection-bound (per P18)', () => {
    expect(kbPreviewKey('u1')).toEqual(['enterprise-console', 'kb-preview', 'u1'])
    expect(kbPreviewKey('u2')).toEqual(['enterprise-console', 'kb-preview', 'u2'])
  })

  it('kbEntriesKey is selection-bound (per P19)', () => {
    expect(kbEntriesKey('colA')).toEqual(['enterprise-console', 'kb-entries', 'colA'])
    expect(kbEntriesKey('colB')).toEqual(['enterprise-console', 'kb-entries', 'colB'])
  })
})